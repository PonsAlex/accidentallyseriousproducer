/**
 * Shape the "related content" question for Jev.
 *
 * Jev is not a text analyser: it evaluates one `state` against typed questions
 * and returns calibrated answers. So the state carries the article and the
 * candidate items, and one `noul` question asks whether each candidate belongs
 * beside the article.
 *
 * This module is pure on purpose. It never touches `env.AI`, so the prompt shape
 * and the ranking can be tested without a network call.
 */

export const JEV_MODEL = "typesafe/jev";

export const MAX_CANDIDATES = 20;
export const MAX_TEXT = 240;

export interface RelatedArticle {
	title: string;
	summary?: string;
	developer?: string;
	category?: string;
	kind?: string;
}

export interface RelatedCandidate {
	id: string;
	title: string;
	developer?: string;
	category?: string;
	kind?: string;
}

export interface NoulQuestion {
	type: "noul";
	instructions: string;
	criteria?: { true: string; false: string };
}

export interface RelatedRequest {
	state: {
		article: RelatedArticle;
		candidates: Record<string, Omit<RelatedCandidate, "id">>;
	};
	questions: Record<string, NoulQuestion>;
	/** Question key -> candidate id, so the answer can be mapped back. */
	idsByKey: Record<string, string>;
}

function clean(value: unknown): string {
	return typeof value === "string" ? value.trim().slice(0, MAX_TEXT) : "";
}

/**
 * Build the request Jev will answer. Candidates are keyed `c0`, `c1`, ... so the
 * instructions can reference `candidates.c0` without depending on the ids having
 * path-safe characters.
 */
export function buildRelatedRequest(
	article: RelatedArticle,
	candidates: RelatedCandidate[],
): RelatedRequest {
	const state: RelatedRequest["state"] = {
		article: {
			title: clean(article.title),
			...(article.summary ? { summary: clean(article.summary) } : {}),
			...(article.developer ? { developer: clean(article.developer) } : {}),
			...(article.category ? { category: clean(article.category) } : {}),
			...(article.kind ? { kind: clean(article.kind) } : {}),
		},
		candidates: {},
	};
	const questions: Record<string, NoulQuestion> = {};
	const idsByKey: Record<string, string> = {};

	candidates.slice(0, MAX_CANDIDATES).forEach((candidate, index) => {
		const key = `c${index}`;
		state.candidates[key] = {
			title: clean(candidate.title),
			...(candidate.developer ? { developer: clean(candidate.developer) } : {}),
			...(candidate.category ? { category: clean(candidate.category) } : {}),
			...(candidate.kind ? { kind: clean(candidate.kind) } : {}),
		};
		idsByKey[`related_${key}`] = candidate.id;
		questions[`related_${key}`] = {
			type: "noul",
			instructions: `Would \`candidates.${key}\` be a genuinely useful offer or related item to show beside \`article\`? Consider the same developer or category, and whether a reader of that article would act on it.`,
			criteria: {
				true: "Relevant: same developer, same category, or clearly useful to this reader",
				false: "Not relevant: unrelated product, unrelated maker, or too weak a match",
			},
		};
	});

	return { state, questions, idsByKey };
}

export interface JevAnswer {
	type?: string;
	noul?: number;
}

export interface JevResponse {
	model?: string;
	answers?: Record<string, JevAnswer>;
}

export interface Ranking {
	id: string;
	relevance: number;
}

/** Map Jev's answers back to candidate ids and order them by relevance. */
export function rankAnswers(
	request: RelatedRequest,
	response: JevResponse,
): Ranking[] {
	const answers = response.answers ?? {};
	return Object.entries(request.idsByKey)
		.map(([key, id]) => ({
			id,
			relevance: typeof answers[key]?.noul === "number" ? answers[key].noul : 0,
		}))
		.sort((left, right) => right.relevance - left.relevance);
}

export interface ParsedBody {
	ok: true;
	article: RelatedArticle;
	candidates: RelatedCandidate[];
}

export interface ParseError {
	ok: false;
	error: string;
}

/**
 * Validate the request body before it can cost a model call. Everything is
 * capped: the model's context is finite and every token is billed.
 */
export function parseRelatedBody(raw: unknown): ParsedBody | ParseError {
	if (typeof raw !== "object" || raw === null) return { ok: false, error: "body_must_be_an_object" };
	const body = raw as { article?: unknown; candidates?: unknown };

	if (typeof body.article !== "object" || body.article === null) {
		return { ok: false, error: "article_required" };
	}
	const articleValue = body.article as RelatedArticle;
	if (clean(articleValue.title) === "") return { ok: false, error: "article_title_required" };
	// Normalise at the boundary, so every caller downstream gets capped text.
	const article: RelatedArticle = {
		title: clean(articleValue.title),
		summary: clean(articleValue.summary),
		developer: clean(articleValue.developer),
		category: clean(articleValue.category),
		kind: clean(articleValue.kind),
	};

	if (!Array.isArray(body.candidates) || body.candidates.length === 0) {
		return { ok: false, error: "candidates_required" };
	}
	if (body.candidates.length > MAX_CANDIDATES) {
		return { ok: false, error: `too_many_candidates (max ${MAX_CANDIDATES})` };
	}

	const candidates: RelatedCandidate[] = [];
	for (const entry of body.candidates) {
		if (typeof entry !== "object" || entry === null) return { ok: false, error: "candidate_must_be_an_object" };
		const candidate = entry as RelatedCandidate;
		if (typeof candidate.id !== "string" || candidate.id.trim() === "") {
			return { ok: false, error: "candidate_id_required" };
		}
		if (clean(candidate.title) === "") return { ok: false, error: "candidate_title_required" };
		candidates.push({
			id: candidate.id.trim(),
			title: clean(candidate.title),
			developer: clean(candidate.developer),
			category: clean(candidate.category),
			kind: clean(candidate.kind),
		});
	}

	return { ok: true, article, candidates };
}
