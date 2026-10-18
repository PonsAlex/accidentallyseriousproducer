import { isPromotionPublic, AFFILIATE_ID_PATTERN } from "../assets/affiliate-core.mjs";
import {
  CONTENT_SECTIONS,
  CONTENT_TYPE_SECTIONS,
  CONTENT_TYPES,
  EDITORIAL_STAGE_ORDER,
  EDITORIAL_STATUSES,
  EDITORIAL_VERDICTS,
  createEditorialBlock,
  validateEditorialState
} from "../assets/content-blocks.mjs";
import { PRODUCT_CATEGORIES } from "./affiliate-validation.mjs";

/**
 * Deterministic fill of ASP content blocks from an already-validated editorial
 * record.
 *
 * The mapping itself is code, on purpose: an administrative fill must be exact
 * and repeatable. Every reader-facing value is copied verbatim from the record;
 * nothing is generated. When a value is absent the field is left empty and the
 * gap is reported, so a public claim can never rest on an invented fact.
 *
 * Values that a human already assigned upstream (`editorial.verdict`,
 * `editorial.editorialStatus`, `editorial.selection`) are carried into the
 * Console fields and recorded as carried, not decided.
 */

export const EDITORIAL_INPUT_VERSION = "1.0";

export const EDITORIAL_EVIDENCE_KEYS = Object.freeze([
  "sourceConfirmed",
  "productConfirmed",
  "priceConfirmed",
  "datesConfirmed",
  "termsConfirmed",
  "sufficient"
]);

export const EDITORIAL_BLOCK_STATUSES = Object.freeze(["draft", "review", "approved", "published", "archived"]);

const PRODUCT_REVIEW_COPY_KEYS = Object.freeze([
  "title",
  "body",
  "verdict",
  "reviewLabel",
  "linkLabel",
  "href"
]);

const ARTICLE_COPY_KEYS = Object.freeze(["tag", "title", "deck", "body", "linkLabel", "href", "date"]);

const ALLOWED_COPY_KEYS = Object.freeze({
  "product-review": PRODUCT_REVIEW_COPY_KEYS,
  article: ARTICLE_COPY_KEYS,
  deal: Object.freeze([])
});

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function isPlainString(value) {
  return typeof value === "string";
}

/**
 * Validate one editorial input record. Returns a report instead of throwing so
 * the CLI can list every problem in one pass.
 */
export function validateEditorialInputRecord(record, { knownPromotionIds = new Set() } = {}) {
  const errors = [];
  const warnings = [];
  const fail = (code, location, message) => errors.push({ code, location, message });
  const warn = (code, location, message) => warnings.push({ code, location, message });

  if (!isRecord(record)) {
    fail("INVALID_RECORD", "$", "An editorial input record must be a JSON object.");
    return { errors, warnings };
  }

  if (record.inputVersion !== EDITORIAL_INPUT_VERSION) {
    fail(
      "UNSUPPORTED_INPUT_VERSION",
      "$.inputVersion",
      `This fill accepts inputVersion ${EDITORIAL_INPUT_VERSION}.`
    );
  }

  if (typeof record.recordId !== "string" || !AFFILIATE_ID_PATTERN.test(record.recordId)) {
    fail("INVALID_RECORD_ID", "$.recordId", "recordId must use lowercase letters, numbers and hyphens.");
  }

  if (record.type !== undefined && !CONTENT_TYPES.includes(record.type)) {
    fail("INVALID_RECORD_TYPE", "$.type", `Unsupported content block type: ${record.type}.`);
  }

  if (record.blockId !== undefined && !isNonEmptyString(record.blockId)) {
    fail("INVALID_BLOCK_ID", "$.blockId", "blockId must be a non-empty string when present.");
  }

  if (record.position !== undefined && (!Number.isInteger(record.position) || record.position < 0)) {
    fail("INVALID_POSITION", "$.position", "position must be a non-negative integer when present.");
  }

  const declaredType = CONTENT_TYPES.includes(record.type) ? record.type : null;

  if (record.section !== undefined) {
    if (!Object.hasOwn(CONTENT_SECTIONS, record.section)) {
      fail("INVALID_SECTION", "$.section", `Unsupported content section: ${record.section}.`);
    } else if (declaredType && !CONTENT_TYPE_SECTIONS[declaredType].includes(record.section)) {
      fail(
        "INCOMPATIBLE_SECTION",
        "$.section",
        `Content type ${declaredType} is not supported in section ${record.section}.`
      );
    }
  }

  const facts = record.facts;
  if (!isRecord(facts)) {
    fail("MISSING_FACTS", "$.facts", "A validated record must supply a facts object.");
  } else {
    if (!isRecord(facts.product)) {
      fail("MISSING_FACTS_PRODUCT", "$.facts.product", "facts.product must be an object.");
    } else if (!isNonEmptyString(facts.product.name)) {
      fail("MISSING_PRODUCT_NAME", "$.facts.product.name", "The product name is required to fill a block.");
    } else if (
      facts.product.category !== undefined &&
      facts.product.category !== null &&
      !PRODUCT_CATEGORIES.includes(facts.product.category)
    ) {
      fail("INVALID_PRODUCT_CATEGORY", "$.facts.product.category", `Unknown product category: ${facts.product.category}.`);
    }

    if (facts.sources !== undefined) {
      if (!Array.isArray(facts.sources) || facts.sources.some((source) => !isPlainString(source))) {
        fail("INVALID_SOURCES", "$.facts.sources", "facts.sources must be an array of strings.");
      } else if (facts.sources.length === 0) {
        warn("EMPTY_SOURCES", "$.facts.sources", "No source was supplied; the block cannot cite its evidence.");
      }
    }

    if (facts.restrictions !== undefined && !Array.isArray(facts.restrictions)) {
      fail("INVALID_RESTRICTIONS", "$.facts.restrictions", "facts.restrictions must be an array.");
    }

    if (isRecord(facts.offer) && facts.offer.promotionId !== undefined) {
      const promotionId = facts.offer.promotionId;
      if (typeof promotionId !== "string" || !AFFILIATE_ID_PATTERN.test(promotionId)) {
        fail("INVALID_PROMOTION_ID", "$.facts.offer.promotionId", "promotionId must use lowercase letters, numbers and hyphens.");
      } else if (knownPromotionIds.size > 0 && !knownPromotionIds.has(promotionId)) {
        fail(
          "UNKNOWN_PROMOTION",
          "$.facts.offer.promotionId",
          `No promotion record exists for ${promotionId}; a deal cannot be filled from a missing record.`
        );
      }
    }
  }

  if (declaredType === "deal" && !isRecord(facts?.offer)) {
    fail("MISSING_DEAL_OFFER", "$.facts.offer", "A deal record must reference a promotion through facts.offer.");
  }

  const draftCopy = record.draftCopy;
  if (draftCopy !== undefined && !isRecord(draftCopy)) {
    fail("INVALID_DRAFT_COPY", "$.draftCopy", "draftCopy must be an object when present.");
  } else if (isRecord(draftCopy) && declaredType) {
    const allowed = ALLOWED_COPY_KEYS[declaredType];
    for (const key of Object.keys(draftCopy)) {
      if (!allowed.includes(key)) {
        fail(
          "UNKNOWN_COPY_FIELD",
          `$.draftCopy.${key}`,
          `Field ${key} does not exist on a ${declaredType} block. Allowed: ${allowed.join(", ") || "(none)"}.`
        );
      }
    }
  }

  if (record.editorial !== undefined) {
    if (!isRecord(record.editorial)) {
      fail("INVALID_EDITORIAL", "$.editorial", "editorial must be an object when present.");
    } else {
      const { verdict, editorialStatus, editorialStage, blockStatus, selection } = record.editorial;
      if (verdict !== undefined && !["", ...EDITORIAL_VERDICTS].includes(verdict)) {
        fail("INVALID_EDITORIAL_VERDICT", "$.editorial.verdict", `Unsupported Verdict: ${verdict}.`);
      }
      if (editorialStatus !== undefined && !EDITORIAL_STATUSES.includes(editorialStatus)) {
        fail("INVALID_EDITORIAL_STATUS", "$.editorial.editorialStatus", `Unsupported Status: ${editorialStatus}.`);
      }
      if (editorialStage !== undefined && !EDITORIAL_STAGE_ORDER.includes(editorialStage)) {
        fail("INVALID_EDITORIAL_STAGE", "$.editorial.editorialStage", `Unsupported editorial stage: ${editorialStage}.`);
      }
      if (blockStatus !== undefined && !EDITORIAL_BLOCK_STATUSES.includes(blockStatus)) {
        fail("INVALID_BLOCK_STATUS", "$.editorial.blockStatus", `Unsupported block status: ${blockStatus}.`);
      }
      if (selection !== undefined && !isPlainString(selection)) {
        fail("INVALID_SELECTION", "$.editorial.selection", "selection must be a string when present.");
      }
    }
  }

  if (record.notApplicable !== undefined) {
    if (
      !Array.isArray(record.notApplicable) ||
      record.notApplicable.some((item) => !isNonEmptyString(item))
    ) {
      fail(
        "INVALID_NOT_APPLICABLE",
        "$.notApplicable",
        "notApplicable must be an array of fact names that do not apply to this offer."
      );
    }
  }

  if (record.evidence !== undefined) {
    if (!isRecord(record.evidence)) {
      fail("INVALID_EVIDENCE", "$.evidence", "evidence must be an object when present.");
    } else {
      for (const [key, value] of Object.entries(record.evidence)) {
        if (!EDITORIAL_EVIDENCE_KEYS.includes(key)) {
          fail(
            "UNKNOWN_EVIDENCE_KEY",
            `$.evidence.${key}`,
            `Unknown evidence flag. Allowed: ${EDITORIAL_EVIDENCE_KEYS.join(", ")}.`
          );
        } else if (typeof value !== "boolean") {
          fail("INVALID_EVIDENCE_VALUE", `$.evidence.${key}`, "Evidence flags must be booleans.");
        }
      }
    }
  }

  return { errors, warnings };
}

/**
 * Resolve the block type for a record.
 *
 * A declared type always wins. Otherwise the decision is deterministic code, not
 * a model guess: `offer_kind` names a *product category* (plugin, bundle,
 * sample-pack...), which is not a block type. A record that references a
 * promotion becomes a `deal`; any other product offer becomes a
 * `product-review`. Jev only gates the one judgment code cannot make: whether
 * the record describes a claimable offer at all.
 */
export function resolveRecordType(record, jev = {}) {
  if (CONTENT_TYPES.includes(record.type)) {
    return { type: record.type, source: "record" };
  }
  if (jev.offerKind === "not-a-product-offer") {
    return { type: null, source: "jev" };
  }
  const type = record.facts?.offer?.promotionId ? "deal" : "product-review";
  return { type, source: jev.offerKind ? "facts" : "default" };
}

function pickCopy(record, type) {
  const copy = isRecord(record.draftCopy) ? record.draftCopy : {};
  const allowed = ALLOWED_COPY_KEYS[type] ?? [];
  const picked = {};
  for (const key of allowed) {
    const value = copy[key];
    if (isPlainString(value) && value.trim() !== "") {
      picked[key] = value.trim();
    }
  }
  return picked;
}

/**
 * Build the content-block patch for one record. `block` is either the existing
 * block being updated or a freshly created default block.
 */
export function buildBlockFromRecord(record, block, { type } = {}) {
  const section = record.section ?? CONTENT_TYPE_SECTIONS[type][0];
  const copy = pickCopy(record, type);

  block.type = type;
  block.section = section;
  block.position = record.position ?? block.position;

  if (type === "deal") {
    block.content = { promotionId: record.facts.offer.promotionId ?? null };
  } else {
    block.content = { ...block.content, ...copy };
  }

  const sources = Array.isArray(record.facts?.sources)
    ? record.facts.sources.filter((source) => isPlainString(source) && source.trim() !== "").map((source) => source.trim())
    : [];
  block.metadata.sources = sources;

  if (isRecord(record.evidence)) {
    block.metadata.evidence = { ...block.metadata.evidence, ...record.evidence };
  }

  const editorial = isRecord(record.editorial) ? record.editorial : {};
  const carried = {};

  if (isPlainString(editorial.verdict) && editorial.verdict !== "") {
    block.metadata.verdict = editorial.verdict;
    carried.verdict = true;
  }
  if (isPlainString(editorial.editorialStatus) && editorial.editorialStatus !== "") {
    block.metadata.editorialStatus = editorial.editorialStatus;
    carried.editorialStatus = true;
  }
  if (isPlainString(editorial.selection) && editorial.selection !== "") {
    block.metadata.selection = editorial.selection;
    carried.selection = true;
  }
  if (EDITORIAL_STAGE_ORDER.includes(editorial.editorialStage)) {
    block.metadata.editorialStage = editorial.editorialStage;
  }

  // A filled or updated block is new editorial content awaiting review: it may
  // never keep a previous "published" status, which would imply the new copy is
  // already live.
  block.status = EDITORIAL_BLOCK_STATUSES.includes(editorial.blockStatus) ? editorial.blockStatus : "draft";

  // A filled block is a new editorial object: any prior confirmation is stale.
  block.metadata.advance = { ...block.metadata.advance, selected: false, ready: false };

  return { block, carried, copy };
}

/**
 * Map each reportable gap to the concept name an evidence package uses, so a
 * fact declared `notApplicable` is not reported as a gap. A permanent freeware
 * has no end date by design; demanding one creates false work.
 */
const MISSING_PATH_CONCEPTS = Object.freeze({
  "draftCopy.title": "title",
  "draftCopy.body": "body",
  "facts.offer.promoPrice": "promoPrice",
  "facts.offer.endsAt": "endsAt",
  "facts.sources": "sources"
});

export function computeMissingRecordValues(record, type) {
  const missing = [];
  const copy = isRecord(record.draftCopy) ? record.draftCopy : {};

  if (type !== "deal") {
    if (!isNonEmptyString(copy.title)) missing.push("draftCopy.title");
    if (!isNonEmptyString(copy.body)) missing.push("draftCopy.body");
    const offer = isRecord(record.facts?.offer) ? record.facts.offer : {};
    if (offer.promoPrice === undefined || offer.promoPrice === null) missing.push("facts.offer.promoPrice");
    // A date-only deadline is a known deadline. Only report the gap when no
    // deadline information exists at all.
    if (!offer.endsAt && !offer.endsAtDate) missing.push("facts.offer.endsAt");
  }
  if (!Array.isArray(record.facts?.sources) || record.facts.sources.length === 0) {
    missing.push("facts.sources");
  }
  return missing;
}

export function missingRecordValues(record, type) {
  const notApplicable = Array.isArray(record?.notApplicable) ? record.notApplicable : [];
  return computeMissingRecordValues(record, type).filter((path) => {
    const concept = MISSING_PATH_CONCEPTS[path] ?? path;
    return !notApplicable.includes(concept);
  });
}

export function hasUsableCopy(record, type) {
  if (type === "deal") return false;
  const copy = isRecord(record.draftCopy) ? record.draftCopy : {};
  return Object.values(copy).some((value) => isPlainString(value) && value.trim() !== "");
}

function normalizeKeyPart(value) {
  return typeof value === "string" ? value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() : "";
}

/**
 * Identity of the offer a record describes, independent of the `recordId` a
 * source chose. Two sources that name the same developer and product reach the
 * same key even when their slugs differ, which is what makes duplicate detection
 * possible across sources.
 */
export function buildProductKey(record) {
  const developer = normalizeKeyPart(record?.facts?.product?.developer);
  const name = normalizeKeyPart(record?.facts?.product?.name);
  if (name === "") return null;
  return `${developer}|${name}`;
}

/**
 * Apply validated records to a copy of the editorial state. Only the listed
 * records are touched; every other block must survive byte for byte.
 *
 * Identity is `type-recordId`. Re-delivering a source therefore merges into the
 * blocks it created before, instead of failing, and a block this pipeline did
 * not create is never overwritten by accident.
 */
export function applyEditorialRecords(
  state,
  entries,
  { updatedAt = new Date().toISOString(), promotionsById = new Map(), idFactory } = {}
) {
  validateEditorialState(state);
  if (!Number.isFinite(Date.parse(updatedAt))) {
    throw new TypeError("The fill timestamp must be valid.");
  }

  const next = { ...state, blocks: state.blocks.map((block) => JSON.parse(JSON.stringify(block))) };
  const byId = new Map(next.blocks.map((block) => [block.id, block]));
  const results = [];
  const duplicateWarnings = [];

  // Seed the product index from blocks this pipeline already filled, so a
  // duplicate arriving under a different recordId is still noticed.
  const productIndex = new Map();
  for (const block of next.blocks) {
    const priorRecordId = block.metadata?.jev?.recordId;
    const priorKey = block.metadata?.jev?.productKey;
    if (typeof priorRecordId === "string" && typeof priorKey === "string" && priorKey !== "") {
      productIndex.set(priorKey, priorRecordId);
    }
  }

  for (const entry of entries) {
    const { record, type, jev = {} } = entry;
    if (!CONTENT_TYPES.includes(type)) {
      throw new Error(
        `Record ${record?.recordId ?? "(unknown)"} has no resolvable content block type; it cannot be filled.`
      );
    }
    const report = validateEditorialInputRecord(record, { knownPromotionIds: promotionsById });
    if (report.errors.length > 0) {
      throw new Error(
        `Record ${record?.recordId ?? "(unknown)"} is not valid input: ${report.errors
          .map((issue) => `${issue.location} ${issue.message}`)
          .join("; ")}`
      );
    }

    if (type === "deal") {
      const promotionId = record.facts.offer.promotionId;
      const promotion = promotionsById.get(promotionId);
      if (!promotion || !isPromotionPublic(promotion)) {
        throw new Error(
          `Record ${record.recordId} references promotion ${promotionId}, which is not an approved public promotion.`
        );
      }
    }

    const derivedId = `${type}-${record.recordId}`;
    const productKey = buildProductKey(record);

    let block;
    let matchedBy;
    if (record.blockId) {
      block = byId.get(record.blockId);
      if (!block) {
        throw new Error(`Record ${record.recordId} targets unknown block ${record.blockId}.`);
      }
      matchedBy = "blockId";
    } else {
      block = byId.get(derivedId);
      if (block) {
        if (typeof block.metadata?.jev?.recordId !== "string") {
          throw new Error(
            `Block ${derivedId} already exists but was not created by this pipeline. Refusing to overwrite it; pass an explicit blockId in the record to target it deliberately.`
          );
        }
        matchedBy = "recordId";
      } else {
        const generated = createEditorialBlock({
          type,
          section: record.section ?? CONTENT_TYPE_SECTIONS[type][0],
          existingBlocks: next.blocks
        });
        block = { ...generated, id: derivedId };
        next.blocks.push(block);
        byId.set(block.id, block);
        matchedBy = "created";
      }
    }

    // Only a newly created block can introduce a duplicate. Merging into a block
    // this pipeline already owns is the intended path and must not warn.
    if (matchedBy === "created" && productKey) {
      const priorRecordId = productIndex.get(productKey);
      if (priorRecordId && priorRecordId !== record.recordId) {
        duplicateWarnings.push({
          productKey,
          existingRecordId: priorRecordId,
          incomingRecordId: record.recordId
        });
      }
    }
    if (productKey) productIndex.set(productKey, record.recordId);

    const { carried, copy } = buildBlockFromRecord(record, block, { type });

    const missing = missingRecordValues(record, type);
    const notApplicable = Array.isArray(record.notApplicable) ? record.notApplicable : [];

    block.metadata.jev = {
      advisory: true,
      requiresHumanReview: true,
      source: "validated-editorial-record",
      filledBy: "code",
      recordId: record.recordId,
      productKey,
      model: jev.model ?? null,
      route: jev.route ?? null,
      evaluatedAt: jev.evaluatedAt ?? null,
      carriedEditorial: carried,
      copyFields: Object.keys(copy),
      missing,
      notApplicable,
      advisories: jev.advisories ?? null,
      note: "Filled from an already-validated editorial record. Verdict and Status were carried from that record, not decided here."
    };

    results.push({
      recordId: record.recordId,
      blockId: block.id,
      type,
      action: matchedBy === "created" ? "created" : "updated",
      matchedBy,
      copiedFields: Object.keys(copy),
      carried,
      missing: block.metadata.jev.missing
    });
  }

  const merged = { ...next, revision: state.revision + 1, updatedAt };
  validateEditorialState(merged);

  return { state: merged, results, duplicateWarnings };
}
