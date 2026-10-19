import {
	JEV_MODEL,
	buildRelatedRequest,
	parseRelatedBody,
	rankAnswers,
	type JevResponse,
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
 */

export interface Env {
	AI: Ai;
	/** Optional. Without it the endpoint is same-origin only, which needs no CORS. */
	ALLOWED_ORIGIN?: string;
}

const MAX_BODY_BYTES = 16_384;

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
 * here would let any site spend the account's Workers AI quota, so there isn't
 * one: with no `ALLOWED_ORIGIN`, only same-origin requests are answered.
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
			return jsonResponse({ ok: true, model: JEV_MODEL }, 200, cors);
		}

		if (url.pathname !== "/api/related") {
			return jsonResponse({ error: "not_found" }, 404, cors);
		}
		if (request.method !== "POST") {
			return jsonResponse({ error: "method_not_allowed" }, 405, cors);
		}
		if (!env.AI) {
			return jsonResponse({ error: "ai_binding_missing" }, 503, cors);
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
			response = (await env.AI.run(JEV_MODEL, {
				state: related.state,
				questions: related.questions,
			})) as JevResponse;
		} catch (error) {
			// The detail goes to the log, not to the visitor.
			console.error("jev_call_failed", error instanceof Error ? error.message : String(error));
			return jsonResponse({ error: "model_unavailable" }, 502, cors);
		}

		return jsonResponse(
			{
				model: response.model ?? JEV_MODEL,
				rankings: rankAnswers(related, response),
			},
			200,
			cors,
		);
	},
};
