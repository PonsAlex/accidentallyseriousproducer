import { describe, it, expect, vi, afterEach } from "vitest";
import worker, { type Env, activeRoute } from "../src/index";
import { buildRelatedRequest, parseRelatedBody, rankAnswers } from "../src/questions";

const article = {
	title: "Five freeware plugins",
	summary: "Glitch 2, Zebralette 3 and three more.",
	category: "plugin",
};

const candidates = [
	{ id: "link-a", title: "Glitch 2", developer: "illformed", category: "plugin" },
	{ id: "link-b", title: "Supreme Compressor", developer: "Other", category: "plugin" },
];

const answers = {
	model: "jev-1.13.0",
	answers: {
		related_c0: { type: "noul", noul: 0.91 },
		related_c1: { type: "noul", noul: 0.12 },
	},
};

function stubAi(overrides: Partial<Env> = {}) {
	const run = vi.fn(async () => answers);
	const env = { AI: { run }, ...overrides } as unknown as Env;
	return { env, run };
}

function stubTypesafe() {
	const fetchMock = vi.fn(async () => new Response(JSON.stringify(answers), { status: 200 }));
	vi.stubGlobal("fetch", fetchMock);
	const env = { TYPESAFE_API_KEY: "test-key" } as unknown as Env;
	return { env, fetchMock };
}

function post(body: unknown, headers: Record<string, string> = {}) {
	return new Request("https://asp.example/api/related", {
		method: "POST",
		headers: { "Content-Type": "application/json", ...headers },
		body: typeof body === "string" ? body : JSON.stringify(body),
	});
}

afterEach(() => {
	vi.unstubAllGlobals();
});

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
		expect(Object.keys(buildRelatedRequest(article, many).state.candidates)).toHaveLength(20);
	});

	it("ranks by relevance and keeps the id mapping", () => {
		const rankings = rankAnswers(buildRelatedRequest(article, candidates), {
			answers: { related_c0: { noul: 0.91 }, related_c1: { noul: 0.12 } },
		});

		expect(rankings).toEqual([
			{ id: "link-a", relevance: 0.91 },
			{ id: "link-b", relevance: 0.12 },
		]);
	});

	it("treats a missing answer as zero instead of dropping the candidate", () => {
		const rankings = rankAnswers(buildRelatedRequest(article, candidates), {
			answers: { related_c0: { noul: 0.4 } },
		});
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
		expect(parseRelatedBody({ article, candidates: many }).ok).toBe(false);
	});

	it("normalises and truncates text at the boundary", () => {
		const parsed = parseRelatedBody({
			article: { title: `  ${"a".repeat(1000)}  ` },
			candidates,
		});
		expect(parsed.ok).toBe(true);
		if (parsed.ok) expect(parsed.article.title.length).toBe(240);
	});
});

describe("route selection", () => {
	it("prefers the TypeSafe key over the Workers AI binding", () => {
		expect(activeRoute({ TYPESAFE_API_KEY: "k", AI: { run: vi.fn() } } as unknown as Env)).toBe("typesafe");
		expect(activeRoute({ AI: { run: vi.fn() } } as unknown as Env)).toBe("workers-ai");
		expect(activeRoute({} as unknown as Env)).toBe(null);
		// An empty secret must not count as configured.
		expect(activeRoute({ TYPESAFE_API_KEY: "" } as unknown as Env)).toBe(null);
	});
});

describe("worker routes", () => {
	it("answers /api/health with the active route and no model call", async () => {
		const { env, run } = stubAi();
		const response = await worker.fetch(new Request("https://asp.example/api/health"), env);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true, route: "workers-ai" });
		expect(run).not.toHaveBeenCalled();
	});

	it("answers an unknown path with 404", async () => {
		const { env } = stubAi();
		expect((await worker.fetch(new Request("https://asp.example/nope"), env)).status).toBe(404);
	});

	it("rejects a non-POST on the endpoint", async () => {
		const { env } = stubAi();
		expect((await worker.fetch(new Request("https://asp.example/api/related"), env)).status).toBe(405);
	});

	it("rejects malformed JSON and invalid bodies before calling the model", async () => {
		const { env, run } = stubAi();

		const malformed = await worker.fetch(post("{not json"), env);
		expect(malformed.status).toBe(400);
		expect(await malformed.json()).toEqual({ error: "invalid_json" });

		expect((await worker.fetch(post({ article }), env)).status).toBe(400);
		expect(run).not.toHaveBeenCalled();
	});

	it("fails closed when no route is configured", async () => {
		const response = await worker.fetch(post({ article, candidates }), {} as unknown as Env);
		expect(response.status).toBe(503);
		expect(await response.json()).toEqual({ error: "no_jev_route_configured" });
	});

	it("uses Workers AI when only the binding is present", async () => {
		const { env, run } = stubAi();
		const response = await worker.fetch(post({ article, candidates }), env);

		expect(response.status).toBe(200);
		expect(run).toHaveBeenCalledOnce();
		const [model, payload] = run.mock.calls[0] as unknown as [string, Record<string, unknown>];
		expect(model).toBe("typesafe/jev");
		expect(payload).toHaveProperty("state");
		expect(payload).toHaveProperty("questions");
		expect(payload).not.toHaveProperty("model");
	});
});

describe("TypeSafe direct route", () => {
	it("calls api.typesafe.ai with the model in the body and the key in the header", async () => {
		const { env, fetchMock } = stubTypesafe();
		const response = await worker.fetch(post({ article, candidates }), env);

		expect(response.status).toBe(200);
		expect(fetchMock).toHaveBeenCalledOnce();

		const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe("https://api.typesafe.ai/v1/systemone");
		expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-key");

		const body = JSON.parse(init.body as string);
		expect(body.model).toBe("jev-latest");
		expect(body).toHaveProperty("state");
		expect(body).toHaveProperty("questions");
		expect(body).not.toHaveProperty("text");
	});

	it("returns the same ranking shape as the Workers AI route", async () => {
		const { env } = stubTypesafe();
		const body = (await (await worker.fetch(post({ article, candidates }), env)).json()) as {
			model: string;
			rankings: unknown;
		};

		expect(body.model).toBe("jev-1.13.0");
		expect(body.rankings).toEqual([
			{ id: "link-a", relevance: 0.91 },
			{ id: "link-b", relevance: 0.12 },
		]);
	});

	it("retries an overload status and then succeeds", async () => {
		let calls = 0;
		const fetchMock = vi.fn(async () => {
			calls += 1;
			if (calls === 1) return new Response("busy", { status: 429 });
			return new Response(JSON.stringify(answers), { status: 200 });
		});
		vi.stubGlobal("fetch", fetchMock);

		const response = await worker.fetch(post({ article, candidates }), {
			TYPESAFE_API_KEY: "test-key",
		} as unknown as Env);

		expect(response.status).toBe(200);
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it("gives up after the retry budget and leaks nothing", async () => {
		const fetchMock = vi.fn(async () => new Response("secret upstream detail", { status: 500 }));
		vi.stubGlobal("fetch", fetchMock);

		const response = await worker.fetch(post({ article, candidates }), {
			TYPESAFE_API_KEY: "super-secret-key",
		} as unknown as Env);

		expect(response.status).toBe(502);
		const text = JSON.stringify(await response.json());
		expect(text).not.toContain("super-secret-key");
		expect(text).not.toContain("secret upstream detail");
	});
});

describe("CORS", () => {
	it("sends no wildcard and nothing without a configured origin", async () => {
		const { env } = stubAi();
		const response = await worker.fetch(
			new Request("https://asp.example/api/health", { headers: { Origin: "https://evil.example" } }),
			env,
		);
		expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
	});

	it("echoes the allowed origin and nothing else", async () => {
		const { env } = stubAi({ ALLOWED_ORIGIN: "https://accidentallyseriousproducer.com" });

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
