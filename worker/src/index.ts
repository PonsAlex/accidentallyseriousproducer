import {
	JEV_MODEL,
	buildRelatedRequest,
	parseRelatedBody,
	rankAnswers,
	type JevResponse,
	type RelatedRequest,
} from "./questions";

/**
 * ASP related-content endpoint.
 *
 * Given an article and a short list of candidates, it asks Jev which candidates
 * belong beside the article and returns ranked ids with a relevance score.
 *
 * It deliberately returns *ids and numbers*, never prose. The page renders copy
 * it already has for those ids, so no generated sentence about a price or a
 * deadline can ever reach a reader.
 *
 * Two routes reach Jev, in this order:
 *  1. `TYPESAFE_API_KEY` set  -> api.typesafe.ai directly, billed to TypeSafe.
 *  2. `AI` binding            -> Workers AI `typesafe/jev`, billed to Cloudflare.
 * The first is preferred because it does not depend on Workers AI credits.
 */

export interface Env {
	AI: Ai;
	/** Secret. When present, Jev is called directly and Workers AI is not used. */
	TYPESAFE_API_KEY?: string;
	/** Optional. Without it the endpoint is same-origin only, which needs no CORS. */
	ALLOWED_ORIGIN?: string;
}

const TYPESAFE_ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const TYPESAFE_MODEL = "jev-latest";
const MAX_BODY_BYTES = 16_384;
const MAX_RETRIES = 2;

type Route = "typesafe" | "workers-ai" | null;

export function activeRoute(env: Env): Route {
	if (typeof env.TYPESAFE_API_KEY === "string" && env.TYPESAFE_API_KEY !== "") return "typesafe";
	if (env.AI) return "workers-ai";
	return null;
}

function jsonResponse(body: unknown, status: number, extra: Record<string, string>): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			"Content-Type": "application/json; charset=utf-8",
			"Cache-Control": "no-store",
			...extra,
		},
	});
}

/**
 * Only the configured origin is allowed to call this from a browser. A wildcard
 * here would let any site spend the account's quota, so there isn't one: with no
 * `ALLOWED_ORIGIN`, only same-origin requests are answered.
 */
function corsHeaders(request: Request, env: Env): Record<string, string> {
	const origin = request.headers.get("Origin");
	if (!origin) return {};
	if (!env.ALLOWED_ORIGIN || origin !== env.ALLOWED_ORIGIN) return {};
	return {
		"Access-Control-Allow-Origin": origin,
		"Access-Control-Allow-Methods": "POST, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type",
		"Access-Control-Max-Age": "86400",
		Vary: "Origin",
	};
}

/** Direct TypeSafe call. Mirrors the retry the CLI does on overload. */
async function callTypesafe(apiKey: string, related: RelatedRequest): Promise<JevResponse> {
	let attempt = 0;
	for (;;) {
		const response = await fetch(TYPESAFE_ENDPOINT, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
			},
			// The direct contract carries the model in the body; Workers AI does not.
			body: JSON.stringify({
				state: related.state,
				model: TYPESAFE_MODEL,
				questions: related.questions,
			}),
		});

		if (response.ok) return (await response.json()) as JevResponse;

		if ((response.status === 429 || response.status === 529) && attempt < MAX_RETRIES) {
			attempt += 1;
			await new Promise((resolve) => setTimeout(resolve, 300 * 2 ** (attempt - 1)));
			continue;
		}

		// Never include the credential or the raw body in the surfaced error.
		throw new Error(`typeSafe HTTP ${response.status}`);
	}
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		const cors = corsHeaders(request, env);

		if (request.method === "OPTIONS") {
			return new Response(null, { status: 204, headers: cors });
		}

		// Free liveness check. It must never reach the model. It lives under /api so
		// the production route (`/api/*`) can reach it.
		if (url.pathname === "/api/health") {
			return jsonResponse({ ok: true, route: activeRoute(env) }, 200, cors);
		}

		if (url.pathname !== "/api/related") {
			return jsonResponse({ error: "not_found" }, 404, cors);
		}
		if (request.method !== "POST") {
			return jsonResponse({ error: "method_not_allowed" }, 405, cors);
		}

		const route = activeRoute(env);
		if (route === null) {
			return jsonResponse({ error: "no_jev_route_configured" }, 503, cors);
		}

		const raw = await request.text();
		if (raw.length > MAX_BODY_BYTES) {
			return jsonResponse({ error: "body_too_large" }, 413, cors);
		}

		let parsedBody: unknown;
		try {
			parsedBody = JSON.parse(raw);
		} catch {
			return jsonResponse({ error: "invalid_json" }, 400, cors);
		}

		// Validate before the call: every token is billed and the context is finite.
		const parsed = parseRelatedBody(parsedBody);
		if (!parsed.ok) {
			return jsonResponse({ error: parsed.error }, 400, cors);
		}

		const related = buildRelatedRequest(parsed.article, parsed.candidates);

		let response: JevResponse;
		try {
			response =
				route === "typesafe"
					? await callTypesafe(env.TYPESAFE_API_KEY as string, related)
					: ((await env.AI.run(JEV_MODEL, {
							state: related.state,
							questions: related.questions,
						})) as JevResponse);
		} catch (error) {
			// The detail goes to the log, not to the visitor.
			console.error("jev_call_failed", route, error instanceof Error ? error.message : String(error));
			return jsonResponse({ error: "model_unavailable" }, 502, cors);
		}

		return jsonResponse(
			{
				model: response.model ?? null,
				rankings: rankAnswers(related, response),
			},
			200,
			cors,
		);
	},
};
