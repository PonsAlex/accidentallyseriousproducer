import { describe, it, expect, vi } from "vitest";
import worker, { type Env } from "../src/index";
import {
	JEV_MODEL,
	buildRelatedRequest,
	parseRelatedBody,
	rankAnswers,
} from "../src/questions";

const article = {
	title: "Five freeware plugins",
	summary: "Glitch 2, Zebralette 3 and three more.",
	category: "plugin",
};

const candidates = [
	{ id: "link-a", title: "Glitch 2", developer: "illformed", category: "plugin" },
	{ id: "link-b", title: "Supreme Compressor", developer: "Other", category: "plugin" },
];

function stubEnv(overrides: Partial<Env> = {}) {
	const run = vi.fn(async () => ({
		model: "jev-1.13.0",
		answers: {
			related_c0: { type: "noul", noul: 0.91 },
			related_c1: { type: "noul", noul: 0.12 },
		},
	}));
	const env = { AI: { run }, ...overrides } as unknown as Env;
	return { env, run };
}

function post(body: unknown, headers: Record<string, string> = {}) {
	return new Request("https://asp.example/api/related", {
		method: "POST",
		headers: { "Content-Type": "application/json", ...headers },
		body: typeof body === "string" ? body : JSON.stringify(body),
	});
}

describe("related request shape", () => {
	it("keys candidates by index and maps every question back to an id", () => {
		const related = buildRelatedRequest(article, candidates);

		expect(Object.keys(related.state.candidates)).toEqual(["c0", "c1"]);
		expect(related.state.candidates.c0.title).toBe("Glitch 2");
		expect(Object.keys(related.questions)).toEqual(["related_c0", "related_c1"]);
		expect(related.questions.related_c0.type).toBe("noul");
		// The instruction must reference the state path Jev actually receives.
		expect(related.questions.related_c0.instructions).toContain("candidates.c0");
		expect(related.idsByKey).toEqual({ related_c0: "link-a", related_c1: "link-b" });
	});

	it("caps the candidate list rather than growing the prompt", () => {
		const many = Array.from({ length: 50 }, (_, index) => ({
			id: `id-${index}`,
			title: `Candidate ${index}`,
		}));
		const related = buildRelatedRequest(article, many);
		expect(Object.keys(related.state.candidates)).toHaveLength(20);
	});

	it("ranks by relevance and keeps the id mapping", () => {
		const related = buildRelatedRequest(article, candidates);
		const rankings = rankAnswers(related, {
			answers: { related_c0: { noul: 0.91 }, related_c1: { noul: 0.12 } },
		});

		expect(rankings).toEqual([
			{ id: "link-a", relevance: 0.91 },
			{ id: "link-b", relevance: 0.12 },
		]);
	});

	it("treats a missing answer as zero instead of dropping the candidate", () => {
		const related = buildRelatedRequest(article, candidates);
		const rankings = rankAnswers(related, { answers: { related_c0: { noul: 0.4 } } });
		expect(rankings.map((entry) => entry.id)).toEqual(["link-a", "link-b"]);
		expect(rankings[1].relevance).toBe(0);
	});
});

describe("input validation", () => {
	it("rejects a body with no article or no candidates", () => {
		expect(parseRelatedBody(null).ok).toBe(false);
		expect(parseRelatedBody({ candidates }).ok).toBe(false);
		expect(parseRelatedBody({ article }).ok).toBe(false);
		expect(parseRelatedBody({ article, candidates: [] }).ok).toBe(false);
	});

	it("rejects a candidate without an id or title", () => {
		expect(parseRelatedBody({ article, candidates: [{ title: "x" }] }).ok).toBe(false);
		expect(parseRelatedBody({ article, candidates: [{ id: "x" }] }).ok).toBe(false);
	});

	it("rejects more candidates than the cap", () => {
		const many = Array.from({ length: 21 }, (_, index) => ({ id: `i${index}`, title: `t${index}` }));
		const parsed = parseRelatedBody({ article, candidates: many });
		expect(parsed.ok).toBe(false);
	});

	it("trims and truncates text instead of trusting its length", () => {
		const parsed = parseRelatedBody({
			article: { title: `  ${"a".repeat(1000)}  ` },
			candidates,
		});
		expect(parsed.ok).toBe(true);
		if (parsed.ok) expect(parsed.article.title.length).toBe(240);
	});
});

describe("worker routes", () => {
	it("answers /api/health without spending a model call", async () => {
		const { env, run } = stubEnv();
		const response = await worker.fetch(new Request("https://asp.example/api/health"), env);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true, model: JEV_MODEL });
		expect(run).not.toHaveBeenCalled();
	});

	it("answers an unknown path with 404", async () => {
		const { env } = stubEnv();
		const response = await worker.fetch(new Request("https://asp.example/nope"), env);
		expect(response.status).toBe(404);
	});

	it("rejects a non-POST on the endpoint", async () => {
		const { env } = stubEnv();
		const response = await worker.fetch(new Request("https://asp.example/api/related"), env);
		expect(response.status).toBe(405);
	});

	it("rejects malformed JSON and invalid bodies before calling the model", async () => {
		const { env, run } = stubEnv();

		const malformed = await worker.fetch(post("{not json"), env);
		expect(malformed.status).toBe(400);
		expect(await malformed.json()).toEqual({ error: "invalid_json" });

		const missing = await worker.fetch(post({ article }), env);
		expect(missing.status).toBe(400);

		expect(run).not.toHaveBeenCalled();
	});

	it("fails closed when the AI binding is absent", async () => {
		const env = {} as unknown as Env;
		const response = await worker.fetch(post({ article, candidates }), env);
		expect(response.status).toBe(503);
	});

	it("returns ranked ids from a successful call", async () => {
		const { env, run } = stubEnv();
		const response = await worker.fetch(post({ article, candidates }), env);

		expect(response.status).toBe(200);
		const body = (await response.json()) as { model: string; rankings: { id: string; relevance: number }[] };
		expect(body.model).toBe("jev-1.13.0");
		expect(body.rankings).toEqual([
			{ id: "link-a", relevance: 0.91 },
			{ id: "link-b", relevance: 0.12 },
		]);

		// The model id and payload shape are the contract that was wrong before.
		expect(run).toHaveBeenCalledOnce();
		const [model, payload] = run.mock.calls[0] as unknown as [string, { state: unknown; questions: unknown }];
		expect(model).toBe("typesafe/jev");
		expect(payload).toHaveProperty("state");
		expect(payload).toHaveProperty("questions");
		expect(payload).not.toHaveProperty("text");
	});

	it("does not leak the model error to the caller", async () => {
		const env = {
			AI: {
				run: async () => {
					throw new Error("upstream secret detail");
				},
			},
		} as unknown as Env;
		const response = await worker.fetch(post({ article, candidates }), env);

		expect(response.status).toBe(502);
		expect(JSON.stringify(await response.json())).not.toContain("upstream secret detail");
	});
});

describe("CORS", () => {
	it("sends no wildcard and nothing without a configured origin", async () => {
		const { env } = stubEnv();
		const response = await worker.fetch(
			new Request("https://asp.example/api/health", { headers: { Origin: "https://evil.example" } }),
			env,
		);
		expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
	});

	it("echoes the allowed origin and nothing else", async () => {
		const { env } = stubEnv({ ALLOWED_ORIGIN: "https://accidentallyseriousproducer.com" });

		const allowed = await worker.fetch(
			new Request("https://asp.example/api/health", {
				headers: { Origin: "https://accidentallyseriousproducer.com" },
			}),
			env,
		);
		expect(allowed.headers.get("Access-Control-Allow-Origin")).toBe(
			"https://accidentallyseriousproducer.com",
		);

		const denied = await worker.fetch(
			new Request("https://asp.example/api/health", { headers: { Origin: "https://evil.example" } }),
			env,
		);
		expect(denied.headers.get("Access-Control-Allow-Origin")).toBeNull();
	});
});
