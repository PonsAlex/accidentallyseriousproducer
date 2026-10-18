import {
  CONTENT_BLOCK_SCHEMA_VERSION,
  EDITORIAL_STATUSES,
  EDITORIAL_VERDICTS,
  validateEditorialState
} from "../assets/content-blocks.mjs";
import { PRODUCT_CATEGORIES } from "./affiliate-validation.mjs";

/**
 * JEV advisory layer for the ASP Editorial Console.
 *
 * Jev produces typed judgments about material the editor already supplied. It
 * classifies and detects missing evidence; it never assigns the editorial
 * Verdict, the editorial Status, the selection, the evidence confirmations or
 * the publication/advance gates. `metadata.jev` is a separate advisory record so
 * a reader of the export can always tell a machine suggestion from a human
 * decision.
 */

export const JEV_EVALUATED_BLOCK_TYPES = Object.freeze(["product-review", "deal"]);

export const JEV_NOUL_THRESHOLD = 0.5;
export const JEV_ADVISORY_KEY = "jev";
export const JEV_SUGGESTIONS_FORMAT = "asp-jev-suggestions";
export const JEV_SUGGESTIONS_FORMAT_VERSION = 1;

export const JEV_SYSTEM_ONE_PATH = "/v1/systemone";
export const JEV_TYPESAFE_BASE_URL = "https://api.typesafe.ai";
export const JEV_TYPESAFE_MODEL = "jev-latest";
export const JEV_AI_GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh/typesafe";
export const JEV_AI_GATEWAY_MODEL = "typesafe-ai/jev";

export const JEV_NOT_A_PRODUCT_OFFER = "not-a-product-offer";
export const JEV_UNDETERMINED = "Undetermined";

export const JEV_SKIP_REASONS = Object.freeze({
  unsupportedType: "unsupported-block-type",
  missingPromotion: "missing-promotion-record"
});

const READER_FACING_KEYS = Object.freeze([
  "title",
  "deck",
  "body",
  "tag",
  "verdict",
  "reviewLabel",
  "linkLabel"
]);

const PRODUCT_CATEGORY_CRITERIA = Object.freeze({
  plugin: "A single audio plugin, instrument or effect.",
  bundle: "A packaged group of products sold together.",
  "sample-pack": "A collection of audio samples or loops.",
  "preset-pack": "A collection of presets, patches or MIDI files.",
  subscription: "An ongoing paid plan or membership.",
  "dj-service": "A DJ-oriented service or platform.",
  "music-download": "Recorded music offered for download.",
  course: "Structured educational material.",
  other: "A music-production product that fits none of the named kinds."
});

const VERDICT_CRITERIA = Object.freeze({
  Fire: "Install it. The tool earns a place in an active workflow.",
  Stash: "Claim it for later. Useful, but not needed right now.",
  "Digital Furniture": "Works, but mostly occupies space.",
  Nah: "Skip the hassle. Not worth the download or the money.",
  [JEV_UNDETERMINED]:
    "The supplied material is not enough to place a verdict, or placing a verdict is not the machine's decision."
});

const STATUS_CRITERIA = Object.freeze({
  Breaking: "Hard news or an urgent change readers need immediately.",
  "New Release": "A newly released product or a new major version.",
  Free: "Available at no cost, permanently or as a freebie.",
  "Call an Ambulance": "A time-critical offer that ends within hours.",
  "Last Chance": "A limited-time offer nearing its deadline.",
  Updated: "An existing product, offer or article that changed.",
  [JEV_UNDETERMINED]:
    "The supplied material does not establish a status condition, or the timing cannot be confirmed."
});

const LANGUAGE_CRITERIA = Object.freeze({
  english: "The reader-facing copy is written in English.",
  portuguese: "The reader-facing copy is written in Portuguese.",
  spanish: "The reader-facing copy is written in Spanish.",
  other: "The reader-facing copy is written in another language.",
  mixed: "The reader-facing copy mixes more than one language."
});

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function collectReaderFacingContent(block) {
  const content = isRecord(block.content) ? block.content : {};
  const readerFacing = {};

  for (const key of READER_FACING_KEYS) {
    const value = content[key];
    if (typeof value === "string" && value.trim() !== "") {
      readerFacing[key] = value.trim();
    }
  }

  return readerFacing;
}

function describeReferencedOffer({ product, promotion }) {
  if (!promotion && !product) return null;

  const offer = {};
  if (product) {
    offer.product = {
      name: product.name ?? null,
      category: product.category ?? null,
      description: product.description ?? null
    };
  }
  if (promotion) {
    offer.promotion = {
      currentPrice: promotion.promoPrice ?? null,
      regularPrice: promotion.regularPrice ?? null,
      currency: promotion.currency ?? null,
      endsAt: promotion.endsAt ?? null,
      status: promotion.status ?? null,
      verdict: promotion.verdict ?? null
    };
  }
  return offer;
}

function buildSubmission(block, { product = null, promotion = null } = {}) {
  const submission = {};

  const readerFacing = collectReaderFacingContent(block);
  if (Object.keys(readerFacing).length > 0) {
    submission.readerFacing = readerFacing;
  }

  const sources = Array.isArray(block.metadata?.sources) ? block.metadata.sources : [];
  submission.sources = sources.filter((source) => typeof source === "string");

  const referencedOffer = describeReferencedOffer({ product, promotion });
  if (referencedOffer) {
    submission.referencedOffer = referencedOffer;
  }

  return submission;
}

/**
 * Build the single System One request for one content block. Every question is
 * an independent judgment over the same supplied state, so they run together.
 */
export function buildJevRequest(block, { product = null, promotion = null, model = JEV_TYPESAFE_MODEL } = {}) {
  if (!JEV_EVALUATED_BLOCK_TYPES.includes(block?.type)) {
    throw new TypeError(`Block ${block?.id ?? "(unknown)"} is not a Jev-evaluated block type.`);
  }
  if (typeof model !== "string" || model.trim() === "") {
    throw new TypeError("A Jev model identifier is required.");
  }

  const submission = buildSubmission(block, { product, promotion });
  const hasReaderFacingCopy = isRecord(submission.readerFacing);

  const criteria = {};
  for (const category of PRODUCT_CATEGORIES) {
    criteria[category] = PRODUCT_CATEGORY_CRITERIA[category] ?? null;
  }
  criteria[JEV_NOT_A_PRODUCT_OFFER] =
    "The block is not about a purchasable or claimable music-production offer.";

  const questions = {
    offer_kind: {
      type: "choice",
      instructions: "Which kind of music-production offer does `submission` describe?",
      criteria
    },
    states_specific_price: {
      type: "noul",
      instructions: "Does `submission` state a specific price amount together with its currency?",
      criteria: {
        true: "An explicit amount and currency appear, such as EUR 99 or $1.99.",
        false: "No specific amount is stated, or the amount appears without a currency."
      }
    },
    states_specific_dates: {
      type: "noul",
      instructions: "Does `submission` state a specific calendar date or deadline for the offer?",
      criteria: {
        true: "A concrete date or deadline appears, such as 2026-09-25 or September 25.",
        false:
          "Only vague timing appears, such as 'ends soon', 'limited time', or no timing at all."
      }
    },
    states_terms: {
      type: "noul",
      instructions:
        "Does `submission` state the conditions of the offer, such as eligibility, licensing, expiry or redemption rules?",
      criteria: {
        true: "Eligibility or licensing conditions are stated.",
        false: "No conditions are stated beyond the price itself."
      }
    },
    cites_identifiable_source: {
      type: "noul",
      instructions:
        "Does `submission` point to an identifiable official source for the offer, such as the developer's own page?",
      criteria: {
        true: "A source attributable to the vendor or developer is cited.",
        false: "No source is cited, or the citation is not identifiable."
      }
    },
    evidence_sufficient: {
      type: "noul",
      instructions:
        "Is the material in `submission` sufficient to support a public editorial claim about this offer without inventing any fact?",
      criteria: {
        true: "Product, price and timing are all established by the supplied material.",
        false:
          "At least one of product, price or timing is missing or unconfirmed, so a public claim would have to invent it."
      }
    },
    suggested_status: {
      type: "choice",
      instructions:
        "Which ASP editorial Status best matches the timing and nature described in `submission`? Choose `Undetermined` when the material does not establish one.",
      criteria: STATUS_CRITERIA
    },
    suggested_verdict: {
      type: "choice",
      instructions:
        "Based only on the supplied material, which ASP editorial Verdict would this offer most plausibly receive? This is an advisory classification. Choose `Undetermined` when the material does not support a verdict.",
      criteria: VERDICT_CRITERIA
    }
  };

  if (hasReaderFacingCopy) {
    questions.reader_facing_language = {
      type: "choice",
      instructions:
        "Which language is the reader-facing copy inside `submission` written in? The public ASP site publishes in English.",
      criteria: LANGUAGE_CRITERIA
    };
  }

  if (submission.referencedOffer?.promotion) {
    questions.offer_record_consistency = {
      type: "noul",
      instructions:
        "Do the price, currency and dates described in `submission` agree with the referenced promotion record in `submission.referencedOffer.promotion`?",
      criteria: {
        true: "The described offer facts agree with the promotion record.",
        false:
          "The described offer facts contradict the promotion record, or the record does not carry them."
      }
    };
  }

  return {
    model,
    state: {
      submission,
      editorialContext: {
        blockId: block.id,
        blockType: block.type,
        section: block.section,
        currentStage: block.metadata?.editorialStage ?? null,
        currentVerdict: block.metadata?.verdict ?? "",
        currentStatus: block.metadata?.editorialStatus ?? ""
      }
    },
    questions
  };
}

/**
 * Split an editorial state into the blocks to evaluate and the blocks skipped
 * for a stated reason. Skipping is recorded, never silent.
 */
export function buildJevRequests(state, { productsById = new Map(), promotionsById = new Map(), model } = {}) {
  validateEditorialState(state);
  const requests = [];
  const skipped = [];

  for (const block of state.blocks) {
    if (!JEV_EVALUATED_BLOCK_TYPES.includes(block.type)) {
      skipped.push({ blockId: block.id, blockType: block.type, reason: JEV_SKIP_REASONS.unsupportedType });
      continue;
    }

    let promotion = null;
    let product = null;

    if (block.type === "deal") {
      const promotionId = block.content?.promotionId;
      promotion = promotionId ? promotionsById.get(promotionId) ?? null : null;
      if (!promotion) {
        skipped.push({
          blockId: block.id,
          blockType: block.type,
          reason: JEV_SKIP_REASONS.missingPromotion
        });
        continue;
      }
      product = promotionsById.get(promotionId) ? productsById.get(promotion.productId) ?? null : null;
    }

    requests.push({
      blockId: block.id,
      blockType: block.type,
      request: buildJevRequest(block, { product, promotion, ...(model ? { model } : {}) })
    });
  }

  return { requests, skipped };
}

function readNoulAnswer(answers, key) {
  const answer = answers?.[key];
  if (!isRecord(answer) || answer.type !== "noul" || typeof answer.noul !== "number") {
    return null;
  }
  return answer.noul;
}

function readChoiceAnswer(answers, key) {
  const answer = answers?.[key];
  if (!isRecord(answer) || answer.type !== "choice" || typeof answer.choice !== "string") {
    return null;
  }
  return { choice: answer.choice, confidence: typeof answer.confidence === "number" ? answer.confidence : null };
}

function flagFromNoul(value) {
  return value === null ? null : value >= JEV_NOUL_THRESHOLD;
}

function addMissingNote(notes, flag, message) {
  if (flag === false) notes.push(message);
}

/**
 * Turn one block's typed answers into an advisory record. Raw probabilities are
 * kept so a human reviewer can judge the evidence instead of a threshold.
 */
export function interpretJevAnswers(block, answers, { model, evaluatedAt, route = null } = {}) {
  if (!JEV_EVALUATED_BLOCK_TYPES.includes(block?.type)) {
    throw new TypeError(`Block ${block?.id ?? "(unknown)"} is not a Jev-evaluated block type.`);
  }
  if (!isRecord(answers)) {
    throw new TypeError("Jev answers must be an object.");
  }

  const probabilities = {
    statesSpecificPrice: readNoulAnswer(answers, "states_specific_price"),
    statesSpecificDates: readNoulAnswer(answers, "states_specific_dates"),
    statesTerms: readNoulAnswer(answers, "states_terms"),
    citesIdentifiableSource: readNoulAnswer(answers, "cites_identifiable_source"),
    evidenceSufficient: readNoulAnswer(answers, "evidence_sufficient"),
    offerRecordConsistency: readNoulAnswer(answers, "offer_record_consistency")
  };

  const signals = {
    statesSpecificPrice: flagFromNoul(probabilities.statesSpecificPrice),
    statesSpecificDates: flagFromNoul(probabilities.statesSpecificDates),
    statesTerms: flagFromNoul(probabilities.statesTerms),
    citesIdentifiableSource: flagFromNoul(probabilities.citesIdentifiableSource),
    evidenceSufficient: flagFromNoul(probabilities.evidenceSufficient),
    offerRecordConsistency: flagFromNoul(probabilities.offerRecordConsistency)
  };

  const offerKind = readChoiceAnswer(answers, "offer_kind");
  const readerFacingLanguage = readChoiceAnswer(answers, "reader_facing_language");
  const suggestedStatus = readChoiceAnswer(answers, "suggested_status");
  const suggestedVerdict = readChoiceAnswer(answers, "suggested_verdict");

  const notes = [];
  if (offerKind?.choice === JEV_NOT_A_PRODUCT_OFFER) {
    notes.push("The supplied block does not describe a claimable music-production offer.");
  }
  addMissingNote(notes, signals.statesSpecificPrice, "No specific price and currency were found in the supplied material.");
  addMissingNote(notes, signals.statesSpecificDates, "No specific calendar deadline was found in the supplied material.");
  addMissingNote(notes, signals.statesTerms, "The offer conditions are not stated in the supplied material.");
  addMissingNote(notes, signals.citesIdentifiableSource, "No identifiable official source was found in the supplied material.");
  addMissingNote(
    notes,
    signals.evidenceSufficient,
    "The supplied material is not sufficient for a public claim without inventing at least one fact."
  );
  addMissingNote(
    notes,
    signals.offerRecordConsistency,
    "The described offer facts disagree with, or are absent from, the referenced promotion record."
  );
  if (readerFacingLanguage && readerFacingLanguage.choice !== "english") {
    notes.push(
      `Reader-facing copy was classified as "${readerFacingLanguage.choice}"; the public ASP site publishes in English.`
    );
  }
  if (suggestedVerdict?.choice && suggestedVerdict.choice !== JEV_UNDETERMINED) {
    notes.push(
      `Jev proposes the Verdict "${suggestedVerdict.choice}" as an advisory only. The editorial Verdict remains a human decision.`
    );
  }
  if (suggestedStatus?.choice && suggestedStatus.choice !== JEV_UNDETERMINED) {
    notes.push(
      `Jev proposes the Status "${suggestedStatus.choice}" as an advisory only. The editorial Status remains a human decision.`
    );
  }

  return {
    blockId: block.id,
    blockType: block.type,
    type: "evaluated",
    model: model ?? null,
    route: route ?? null,
    evaluatedAt: evaluatedAt ?? null,
    advisory: true,
    requiresHumanReview: true,
    advisories: {
      offerKind: offerKind?.choice ?? null,
      offerKindConfidence: offerKind?.confidence ?? null,
      readerFacingLanguage: readerFacingLanguage?.choice ?? null,
      suggestedStatus: suggestedStatus?.choice ?? null,
      suggestedStatusConfidence: suggestedStatus?.confidence ?? null,
      suggestedVerdict: suggestedVerdict?.choice ?? null,
      suggestedVerdictConfidence: suggestedVerdict?.confidence ?? null,
      signals,
      probabilities,
      reviewNotes: notes
    }
  };
}

/**
 * The editorial fields Jev must never write. `advance` is excluded because
 * applying an advisory deliberately invalidates readiness instead of preserving
 * it; that change is asserted separately.
 */
function protectedProjection(state) {
  return state.blocks.map((block) => ({
    id: block.id,
    type: block.type,
    section: block.section,
    position: block.position,
    status: block.status,
    content: block.content,
    enabled: block.metadata.enabled,
    editorialStage: block.metadata.editorialStage,
    sources: block.metadata.sources,
    evidence: block.metadata.evidence,
    selection: block.metadata.selection,
    verdict: block.metadata.verdict,
    editorialStatus: block.metadata.editorialStatus,
    validation: block.metadata.validation,
    publication: block.metadata.publication
  }));
}

export function assertEditorialAuthorityPreserved(before, after) {
  const left = JSON.stringify(protectedProjection(before));
  const right = JSON.stringify(protectedProjection(after));
  if (left !== right) {
    throw new Error(
      "Jev advisories must not change editorial authority fields (content, evidence, verdict, status, selection, validation, publication, stage or position)."
    );
  }
  return after;
}

/**
 * Merge advisory results into a copy of the editorial state. Applies only
 * `metadata.jev`; every editorial-authority field is asserted unchanged, and an
 * outstanding /advance confirmation is invalidated because the block changed.
 */
export function applyJevSuggestions(state, report, { updatedAt = new Date().toISOString() } = {}) {
  validateEditorialState(state);
  if (!isRecord(report) || !Array.isArray(report.results)) {
    throw new TypeError("A Jev suggestions report with a results array is required.");
  }
  if (!Number.isFinite(Date.parse(updatedAt))) {
    throw new TypeError("The advisory merge timestamp must be valid.");
  }

  const next = {
    ...state,
    blocks: state.blocks.map((block) => JSON.parse(JSON.stringify(block)))
  };
  const byId = new Map(next.blocks.map((block) => [block.id, block]));
  let applied = 0;

  for (const result of report.results) {
    if (result?.type !== "evaluated") continue;
    const block = byId.get(result.blockId);
    if (!block) {
      throw new Error(`Jev report references unknown content block ${result.blockId}.`);
    }

    block.metadata[JEV_ADVISORY_KEY] = {
      advisory: true,
      requiresHumanReview: true,
      model: result.model ?? null,
      route: result.route ?? null,
      evaluatedAt: result.evaluatedAt ?? null,
      advisories: result.advisories
    };

    block.metadata.advance = {
      ...block.metadata.advance,
      selected: false,
      ready: false
    };
    applied += 1;
  }

  const merged = {
    ...next,
    revision: state.revision + 1,
    updatedAt
  };

  assertEditorialAuthorityPreserved(state, merged);
  validateEditorialState(merged);

  return { state: merged, applied };
}

export function joinSystemOneEndpoint(baseUrl) {  if (typeof baseUrl !== "string" || baseUrl.trim() === "") {
    throw new TypeError("A Jev base URL is required.");
  }
  return `${baseUrl.trim().replace(/\/+$/, "")}${JEV_SYSTEM_ONE_PATH}`;
}

/**
 * Resolve the Jev route from the environment. The Vercel AI Gateway exposes the
 * same TypeSafe System One contract, so only the base URL, key and model ID
 * change. The key is read from the environment and never written to a file.
 */
export function resolveJevEndpoint(env = {}) {
  const apiKey = env.JEV_API_KEY || env.TYPESAFE_API_KEY || env.AI_GATEWAY_API_KEY || "";
  if (apiKey.trim() === "") {
    throw new Error(
      "Jev requires a credential. Set TYPESAFE_API_KEY or AI_GATEWAY_API_KEY in the environment."
    );
  }

  const customBaseUrl = typeof env.JEV_BASE_URL === "string" ? env.JEV_BASE_URL.trim() : "";
  const requestedRoute = typeof env.JEV_ROUTE === "string" ? env.JEV_ROUTE.trim() : "";
  const route = requestedRoute || (customBaseUrl ? "custom" : env.AI_GATEWAY_API_KEY && !env.TYPESAFE_API_KEY ? "ai-gateway" : "typesafe");

  const baseUrls = {
    typesafe: JEV_TYPESAFE_BASE_URL,
    "ai-gateway": JEV_AI_GATEWAY_BASE_URL,
    custom: customBaseUrl
  };
  const models = {
    typesafe: JEV_TYPESAFE_MODEL,
    "ai-gateway": JEV_AI_GATEWAY_MODEL,
    custom: JEV_TYPESAFE_MODEL
  };

  if (!Object.hasOwn(baseUrls, route)) {
    throw new Error(`Unsupported Jev route: ${route}. Use typesafe, ai-gateway or custom.`);
  }

  const baseUrl = baseUrls[route];
  const model = typeof env.JEV_MODEL === "string" && env.JEV_MODEL.trim() !== "" ? env.JEV_MODEL.trim() : models[route];

  return { route, baseUrl, model, endpoint: joinSystemOneEndpoint(baseUrl), apiKey };
}

/**
 * Evaluate a System One request. Retries the documented overload statuses with
 * exponential backoff and never echoes the credential in an error.
 */
export async function callSystemOne(
  { endpoint, apiKey, body, fetchImpl = globalThis.fetch, maxRetries = 2, retryDelayMs = 500, sleep } = {}
) {
  if (typeof fetchImpl !== "function") {
    throw new Error("A fetch implementation is required to call Jev.");
  }

  const wait = typeof sleep === "function" ? sleep : (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  let attempt = 0;

  for (;;) {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    if (response.ok) {
      return response.json();
    }

    if ((response.status === 429 || response.status === 529) && attempt < maxRetries) {
      attempt += 1;
      await wait(retryDelayMs * 2 ** (attempt - 1));
      continue;
    }

    const text = typeof response.text === "function" ? await response.text() : "";
    let detail = text;
    try {
      const parsed = JSON.parse(text);
      detail = parsed.message || parsed.error_type || text;
    } catch {
      // Keep the raw text when the error body is not JSON.
    }
    throw new Error(`Jev request failed with HTTP ${response.status}: ${detail || "(no body)"}`);
  }
}

/**
 * Fill-pass questions. A validated editorial record already carries its facts
 * and copy, so Jev is not asked to produce text: it decides the placement
 * (`offer_kind` when the record does not declare a type) and reports whether the
 * record is internally coherent and complete.
 */
export function buildJevFillRequest(
  record,
  { model = JEV_TYPESAFE_MODEL, hasPromotionRecord = false, needsType = false, hasCopy = false } = {}
) {
  if (!isRecord(record)) {
    throw new TypeError("A validated editorial record is required.");
  }
  if (typeof model !== "string" || model.trim() === "") {
    throw new TypeError("A Jev model identifier is required.");
  }

  const questions = {};

  if (needsType) {
    const criteria = {};
    for (const category of PRODUCT_CATEGORIES) {
      criteria[category] = PRODUCT_CATEGORY_CRITERIA[category] ?? null;
    }
    criteria[JEV_NOT_A_PRODUCT_OFFER] =
      "The record is not about a purchasable or claimable music-production offer.";

    questions.offer_kind = {
      type: "choice",
      instructions: "Which kind of music-production offer does `record` describe?",
      criteria
    };
  }

  if (hasCopy) {
    questions.reader_facing_language = {
      type: "choice",
      instructions:
        "Which language is the draft copy inside `record.draftCopy` written in? The public ASP site publishes in English.",
      criteria: LANGUAGE_CRITERIA
    };
    questions.copy_matches_facts = {
      type: "noul",
      instructions:
        "Does the draft copy in `record.draftCopy` describe the same product named in `record.facts.product`?",
      criteria: {
        true: "The copy is about the product the facts name.",
        false: "The copy is about a different product, or it does not identify one."
      }
    };
  }

  questions.product_identified = {
    type: "noul",
    instructions: "Does `record` identify a specific product or service?",
    criteria: { true: "A named product or service is present.", false: "No specific product is identified." }
  };
  questions.price_stated = {
    type: "noul",
    instructions: "Does `record` state a specific price amount together with its currency?",
    criteria: {
      true: "An explicit amount and currency appear.",
      false: "No specific amount and currency are present."
    }
  };
  questions.dates_stated = {
    type: "noul",
    instructions: "Does `record` state a specific calendar deadline for the offer?",
    criteria: {
      true: "A concrete date appears.",
      false: "Only vague timing appears, or none at all."
    }
  };
  questions.source_cited = {
    type: "noul",
    instructions: "Does `record` cite an identifiable official source for the offer?",
    criteria: {
      true: "A vendor or developer source is cited.",
      false: "No identifiable source is cited."
    }
  };
  questions.facts_sufficient = {
    type: "noul",
    instructions:
      "Are the facts in `record` sufficient to fill a public ASP content block without inventing any fact?",
    criteria: {
      true: "Product, price, timing and source are all established by the record.",
      false: "At least one of those is missing, so filling the block would leave a gap or invent a fact."
    }
  };

  if (hasPromotionRecord) {
    questions.offer_record_consistency = {
      type: "noul",
      instructions:
        "Do the price, currency and dates in `record.facts.offer` agree with the referenced promotion record in `record.facts.referencedPromotion`?",
      criteria: {
        true: "The record agrees with the promotion record.",
        false: "The record contradicts the promotion record, or omits a fact the record holds."
      }
    };
  }

  return {
    model,
    state: {
      record: {
        recordId: record.recordId ?? null,
        declaredType: record.type ?? null,
        section: record.section ?? null,
        facts: record.facts ?? null,
        draftCopy: record.draftCopy ?? null
      }
    },
    questions
  };
}

export function interpretJevFillAnswers(record, answers, { model, route = null, evaluatedAt = null } = {}) {
  if (!isRecord(answers)) {
    throw new TypeError("Jev answers must be an object.");
  }

  const probabilities = {
    copyMatchesFacts: readNoulAnswer(answers, "copy_matches_facts"),
    productIdentified: readNoulAnswer(answers, "product_identified"),
    priceStated: readNoulAnswer(answers, "price_stated"),
    datesStated: readNoulAnswer(answers, "dates_stated"),
    sourceCited: readNoulAnswer(answers, "source_cited"),
    factsSufficient: readNoulAnswer(answers, "facts_sufficient"),
    offerRecordConsistency: readNoulAnswer(answers, "offer_record_consistency")
  };

  const signals = {
    copyMatchesFacts: flagFromNoul(probabilities.copyMatchesFacts),
    productIdentified: flagFromNoul(probabilities.productIdentified),
    priceStated: flagFromNoul(probabilities.priceStated),
    datesStated: flagFromNoul(probabilities.datesStated),
    sourceCited: flagFromNoul(probabilities.sourceCited),
    factsSufficient: flagFromNoul(probabilities.factsSufficient),
    offerRecordConsistency: flagFromNoul(probabilities.offerRecordConsistency)
  };

  const offerKind = readChoiceAnswer(answers, "offer_kind");
  const language = readChoiceAnswer(answers, "reader_facing_language");
  const notes = [];

  if (signals.copyMatchesFacts === false) {
    notes.push("The draft copy does not appear to describe the product named in the facts. Check placement before publishing.");
  }
  addMissingNote(notes, signals.productIdentified, "No specific product is identified in the record.");
  addMissingNote(notes, signals.priceStated, "No specific price and currency are present in the record.");
  addMissingNote(notes, signals.datesStated, "No specific calendar deadline is present in the record.");
  addMissingNote(notes, signals.sourceCited, "No identifiable official source is cited in the record.");
  addMissingNote(
    notes,
    signals.factsSufficient,
    "The record is not sufficient to fill a public block without inventing a fact."
  );
  addMissingNote(
    notes,
    signals.offerRecordConsistency,
    "The record disagrees with, or omits facts from, the referenced promotion record."
  );
  if (language && language.choice !== "english") {
    notes.push(`Draft copy was classified as "${language.choice}"; the public ASP site publishes in English.`);
  }

  return {
    recordId: record.recordId ?? null,
    model: model ?? null,
    route: route ?? null,
    evaluatedAt,
    advisory: true,
    requiresHumanReview: true,
    advisories: {
      offerKind: offerKind?.choice ?? null,
      offerKindConfidence: offerKind?.confidence ?? null,
      readerFacingLanguage: language?.choice ?? null,
      signals,
      probabilities,
      reviewNotes: notes
    }
  };
}
