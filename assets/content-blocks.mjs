import { isPromotionPublic } from "./affiliate-core.mjs";

export const CONTENT_BLOCK_SCHEMA_VERSION = 2;

export const CONTENT_TYPES = Object.freeze([
  "hero",
  "article",
  "product-review",
  "deal",
  "project"
]);

export const CONTENT_SECTIONS = Object.freeze({
  home: "Home",
  articles: "Articles",
  deals: "Deals",
  lab: "ASP Lab"
});

export const EDITORIAL_STATUSES = Object.freeze([
  "",
  "Breaking",
  "New Release",
  "Free",
  "Call an Ambulance",
  "Last Chance",
  "Updated"
]);

export const EDITORIAL_VERDICTS = Object.freeze([
  "Fire",
  "Stash",
  "Digital Furniture",
  "Nah"
]);

export const EDITORIAL_STAGE_ORDER = Object.freeze([
  "RADAR",
  "PREPARAÇÃO",
  "SELEÇÃO EDITORIAL",
  "BRANCH EDITORIAL",
  "PREVIEW / HUMAN REVIEW",
  "PUBLICATION GATE"
]);

const BLOCK_STATUSES = new Set([
  "draft",
  "review",
  "approved",
  "published",
  "archived"
]);

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isSafeContentHref(value) {
  if (typeof value !== "string" || value.trim() !== value || value === "") {
    return false;
  }
  if (value.startsWith("/") && !value.startsWith("//") && !value.includes("\\")) {
    return true;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname !== "" && url.username === "" && url.password === "";
  } catch {
    return false;
  }
}

function createMetadata() {
  return {
    enabled: true,
    editorialStage: "RADAR",
    sources: [],
    evidence: {
      sourceConfirmed: false,
      productConfirmed: false,
      priceConfirmed: false,
      datesConfirmed: false,
      termsConfirmed: false,
      sufficient: false
    },
    selection: "",
    verdict: "",
    editorialStatus: "",
    validation: {
      claims: false,
      price: false,
      dates: false,
      terms: false,
      status: false,
      recut: false,
      verdict: false,
      links: false,
      previewApproved: false
    },
    publication: {
      state: "unpublished",
      approvedAt: null,
      publishedAt: null
    },
    advance: {
      selected: false,
      ready: false,
      requestedAt: null
    }
  };
}

function createBlock({ id, type, section, position, status, content }) {
  return {
    id,
    type,
    content,
    section,
    position,
    status,
    metadata: createMetadata()
  };
}

export function createInitialEditorialState(data, publicComponents = {}) {
  if (!data || !Array.isArray(data.products) || !Array.isArray(data.promotions)) {
    throw new TypeError("Editorial console requires product and promotion data.");
  }
  const getInitialComponent = (id) => publicComponents[id] ?? { content: {}, metadata: {} };
  const createPublicBlock = (block) => {
    const initial = getInitialComponent(block.id);
    const result = createBlock({
      ...block,
      content: initial.content
    });
    Object.assign(result.metadata, initial.metadata);
    return result;
  };

  const blocks = [
    createPublicBlock({
      id: "home-hero",
      type: "hero",
      section: "home",
      position: 10,
      status: "published",
      content: {}
    }),
    createPublicBlock({
      id: "home-radar-article",
      type: "article",
      section: "home",
      position: 20,
      status: "published",
      content: {}
    }),
    createPublicBlock({
      id: "home-plugin-audit",
      type: "article",
      section: "home",
      position: 30,
      status: "published",
      content: {}
    }),
    createPublicBlock({
      id: "radar-gold-6-review",
      type: "product-review",
      section: "articles",
      position: 10,
      status: "published",
      content: {}
    }),
    createPublicBlock({
      id: "radar-big-bottom-review",
      type: "product-review",
      section: "articles",
      position: 20,
      status: "published",
      content: {}
    }),
    createPublicBlock({
      id: "radar-waves-review",
      type: "product-review",
      section: "articles",
      position: 30,
      status: "review",
      content: {}
    }),
    createPublicBlock({
      id: "lab-jack-in-the-box",
      type: "project",
      section: "lab",
      position: 10,
      status: "published",
      content: {}
    })
  ];

  const productsById = new Map(data.products.map((product) => [product.id, product]));
  const publicPromotions = data.promotions
    .filter(isPromotionPublic)
    .sort((left, right) => left.id.localeCompare(right.id));

  for (const promotion of publicPromotions) {
    const product = productsById.get(promotion.productId);
    if (!product) continue;

    const position = 10 + blocks.filter((block) => block.section === "deals").length * 10;
    const block = createBlock({
      id: `deal-${promotion.id}`,
      type: "deal",
      section: "deals",
      position,
      status: promotion.publicationStatus,
      content: {
        promotionId: promotion.id
      }
    });
    block.metadata.editorialStatus = promotion.status ?? "";
    block.metadata.verdict = promotion.verdict ?? "";
    block.metadata.publication.state = promotion.publicationStatus;
    blocks.push(block);
  }

  return {
    schemaVersion: CONTENT_BLOCK_SCHEMA_VERSION,
    revision: 1,
    updatedAt: null,
    blocks
  };
}

export function validateEditorialState(state) {
  if (
    !state ||
    state.schemaVersion !== CONTENT_BLOCK_SCHEMA_VERSION ||
    !Array.isArray(state.blocks) ||
    !Number.isInteger(state.revision) ||
    state.revision < 1 ||
    (state.updatedAt !== null && (
      typeof state.updatedAt !== "string" || !Number.isFinite(Date.parse(state.updatedAt))
    ))
  ) {
    throw new TypeError(`Editorial state must use schema version ${CONTENT_BLOCK_SCHEMA_VERSION} and contain blocks.`);
  }

  const ids = new Set();
  for (const block of state.blocks) {
    if (!block || typeof block !== "object" || Array.isArray(block)) {
      throw new TypeError("Each content block must be an object.");
    }
    if (typeof block.id !== "string" || block.id.trim() === "" || ids.has(block.id)) {
      throw new TypeError("Content block IDs must be non-empty and unique.");
    }
    ids.add(block.id);

    if (!CONTENT_TYPES.includes(block.type)) {
      throw new TypeError(`Unsupported content block type: ${block.type ?? "(missing)"}.`);
    }
    if (!Object.hasOwn(CONTENT_SECTIONS, block.section)) {
      throw new TypeError(`Unsupported content section: ${block.section ?? "(missing)"}.`);
    }
    if (!Number.isInteger(block.position) || block.position < 0) {
      throw new TypeError(`Content block ${block.id} must have a non-negative integer position.`);
    }
    if (!BLOCK_STATUSES.has(block.status)) {
      throw new TypeError(`Content block ${block.id} has an unsupported status.`);
    }
    if (!block.content || typeof block.content !== "object" || Array.isArray(block.content)) {
      throw new TypeError(`Content block ${block.id} must have a content object.`);
    }
    if (block.content.href !== undefined && !isSafeContentHref(block.content.href)) {
      throw new TypeError(`Content block ${block.id} has an unsafe link URL.`);
    }
    if (
      block.content.date !== undefined &&
      (
        !/^\d{4}-\d{2}-\d{2}$/.test(block.content.date) ||
        !Number.isFinite(Date.parse(`${block.content.date}T00:00:00Z`)) ||
        new Date(`${block.content.date}T00:00:00Z`).toISOString().slice(0, 10) !== block.content.date
      )
    ) {
      throw new TypeError(`Content block ${block.id} has an invalid publication date.`);
    }
    if (!block.metadata || typeof block.metadata !== "object" || Array.isArray(block.metadata)) {
      throw new TypeError(`Content block ${block.id} must preserve editorial metadata.`);
    }
    if (
      !Array.isArray(block.metadata.sources) ||
      block.metadata.sources.some((source) => typeof source !== "string") ||
      typeof block.metadata.enabled !== "boolean" ||
      !EDITORIAL_STAGE_ORDER.includes(block.metadata.editorialStage) ||
      !["", ...EDITORIAL_VERDICTS].includes(block.metadata.verdict) ||
      !EDITORIAL_STATUSES.includes(block.metadata.editorialStatus) ||
      !isRecord(block.metadata.evidence) ||
      !isRecord(block.metadata.validation) ||
      !isRecord(block.metadata.publication) ||
      !isRecord(block.metadata.advance) ||
      typeof block.metadata.advance.selected !== "boolean" ||
      typeof block.metadata.advance.ready !== "boolean" ||
      typeof block.metadata.publication.state !== "string"
    ) {
      throw new TypeError(`Content block ${block.id} has incomplete editorial metadata.`);
    }
  }

  return state;
}

export function advanceEditorialBlock(block, { confirmed = false, requestedAt = new Date().toISOString() } = {}) {
  if (!block || !block.metadata || !block.metadata.advance) {
    throw new TypeError("A valid editorial content block is required.");
  }
  if (confirmed !== true) {
    throw new Error("Editorial advancement requires explicit human confirmation.");
  }
  const stageIndex = EDITORIAL_STAGE_ORDER.indexOf(block.metadata.editorialStage);
  if (stageIndex < 0 || stageIndex === EDITORIAL_STAGE_ORDER.length - 1) {
    throw new Error("This content block has no recognized next editorial stage.");
  }
  if (!Number.isFinite(Date.parse(requestedAt))) {
    throw new TypeError("The /advance request timestamp must be valid.");
  }

  const fromStage = EDITORIAL_STAGE_ORDER[stageIndex];
  const toStage = EDITORIAL_STAGE_ORDER[stageIndex + 1];
  block.metadata.editorialStage = toStage;
  block.metadata.advance = {
    selected: true,
    ready: true,
    requestedAt,
    fromStage,
    toStage
  };
  return { block, fromStage, toStage };
}

export function invalidateEditorialAdvance(block) {
  if (!block?.metadata?.advance) {
    throw new TypeError("A valid editorial content block is required.");
  }
  block.metadata.advance.selected = false;
  block.metadata.advance.ready = false;
  return block;
}

export function migrateEditorialState(state) {
  if (!state || state.schemaVersion !== 1 || !Array.isArray(state.blocks)) {
    return state;
  }
  const migrated = {
    ...state,
    schemaVersion: CONTENT_BLOCK_SCHEMA_VERSION,
    blocks: state.blocks.map((block) => {
      const { verdictType, editorialStatus, ...content } = block.content ?? {};
      const metadata = block.metadata ?? {};
      return {
        ...block,
        content,
        metadata: {
          ...metadata,
          enabled: metadata.enabled ?? true,
          editorialStage: metadata.editorialStage ?? "RADAR",
          sources: metadata.sources ?? [],
          evidence: metadata.evidence ?? createMetadata().evidence,
          selection: metadata.selection ?? "",
          verdict: metadata.verdict || verdictType || "",
          editorialStatus: metadata.editorialStatus || editorialStatus || "",
          validation: metadata.validation ?? createMetadata().validation,
          publication: metadata.publication ?? createMetadata().publication,
          advance: {
            ...metadata.advance,
            selected: metadata.advance?.selected ?? false,
            ready: metadata.advance?.ready ?? false,
            requestedAt: metadata.advance?.requestedAt ?? null
          }
        }
      };
    })
  };
  return migrated;
}

export function moveEditorialBlock(blocks, { id, section, beforeId = null }) {
  if (!Object.hasOwn(CONTENT_SECTIONS, section)) {
    throw new TypeError(`Unsupported content section: ${section}.`);
  }
  const nextBlocks = blocks.map((block) => ({ ...block }));
  const moved = nextBlocks.find((block) => block.id === id);
  if (!moved) throw new Error(`Content block ${id} was not found.`);

  const target = nextBlocks
    .filter((block) => block.section === section && block.id !== id)
    .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id));
  const beforeIndex = beforeId ? target.findIndex((block) => block.id === beforeId) : -1;
  moved.section = section;
  const insertionIndex = beforeIndex < 0 ? target.length : beforeIndex;
  target.splice(insertionIndex, 0, moved);

  const positions = new Map(target.map((block, index) => [block.id, (index + 1) * 10]));
  for (const block of nextBlocks) {
    if (positions.has(block.id)) block.position = positions.get(block.id);
  }
  return nextBlocks;
}

export function normalizeBlockPositions(blocks) {
  const sectionPositions = new Map();
  return [...blocks]
    .sort((left, right) =>
      left.section.localeCompare(right.section) ||
      left.position - right.position ||
      left.id.localeCompare(right.id)
    )
    .map((block) => {
      const position = sectionPositions.get(block.section) ?? 0;
      sectionPositions.set(block.section, position + 10);
      return { ...block, position };
    });
}
