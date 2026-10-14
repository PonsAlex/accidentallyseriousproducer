import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  CONSOLE_EXPORT_APPLICATION,
  CONSOLE_EXPORT_FORMAT,
  CONSOLE_EXPORT_FORMAT_VERSION,
  createConsoleExportEnvelope,
  importConsoleState,
  validateConsoleEditorialState
} from "../assets/console-export.mjs";
import {
  createInitialEditorialState,
  migrateEditorialState
} from "../assets/content-blocks.mjs";
import { PUBLIC_COMPONENT_BLOCK_IDS } from "../assets/public-component-templates.mjs";

const affiliateData = {
  products: [
    { id: "public-product", name: "Public Product" },
    { id: "draft-product", name: "Draft Product" }
  ],
  promotions: [
    {
      id: "public-promotion",
      productId: "public-product",
      publicationStatus: "published",
      requiresReview: false
    },
    {
      id: "draft-promotion",
      productId: "draft-product",
      publicationStatus: "draft",
      requiresReview: true
    }
  ]
};

const publicPromotions = new Map(affiliateData.promotions.map((promotion) => [promotion.id, promotion]));
const validateState = (state) => validateConsoleEditorialState(state, {
  promotionsById: publicPromotions,
  hasTemplate: (id) => PUBLIC_COMPONENT_BLOCK_IDS.includes(id)
});

function makeState() {
  const state = createInitialEditorialState(affiliateData);
  state.revision = 8;
  state.updatedAt = "2026-10-14T17:30:00.000Z";
  const article = state.blocks.find((block) => block.id === "home-radar-article");
  article.status = "draft";
  article.content = {
    tag: "Synthetic",
    title: "Fictional article",
    deck: "An example only",
    body: "Fictional body",
    href: "https://example.invalid/article",
    linkLabel: "Read example",
    date: "2026-10-14"
  };
  article.metadata.sources = ["https://example.invalid/source"];
  article.metadata.evidence.sourceConfirmed = true;
  article.metadata.validation.claims = true;
  article.metadata.publication = {
    state: "unpublished",
    approvedAt: null,
    publishedAt: null,
    note: "retained"
  };
  article.metadata.advance = {
    selected: true,
    ready: true,
    requestedAt: "2026-10-14T17:25:00.000Z",
    fromStage: "RADAR",
    toStage: "PREPARAÇÃO"
  };
  return state;
}

function makeEnvelope(state = makeState()) {
  return createConsoleExportEnvelope(state, "2026-10-14T17:31:00.000Z");
}

function runImportAgainstExisting(json, priorState, validation = validateState) {
  let currentState = structuredClone(priorState);
  let storedState = JSON.stringify(priorState);
  importConsoleState(json, {
    validateState: validation,
    persist: (candidate) => {
      storedState = JSON.stringify(candidate);
    },
    apply: (candidate) => {
      currentState = candidate;
    }
  });
  return { currentState, storedState };
}

test("envelope export and import round-trip complete state and metadata", () => {
  const state = makeState();
  const envelope = makeEnvelope(state);
  assert.equal(envelope.format, CONSOLE_EXPORT_FORMAT);
  assert.equal(envelope.formatVersion, CONSOLE_EXPORT_FORMAT_VERSION);
  assert.equal(envelope.exportedAt, "2026-10-14T17:31:00.000Z");
  assert.equal(envelope.source.application, CONSOLE_EXPORT_APPLICATION);
  assert.equal(envelope.source.contentSchemaVersion, envelope.state.schemaVersion);
  assert.equal(envelope.source.revision, envelope.state.revision);
  assert.equal(envelope.source.updatedAt, envelope.state.updatedAt);

  const result = runImportAgainstExisting(JSON.stringify(envelope), makeState());
  assert.deepEqual(result.currentState, state);
  assert.deepEqual(JSON.parse(result.storedState), state);
  const article = result.currentState.blocks.find((block) => block.id === "home-radar-article");
  assert.deepEqual(article.metadata.sources, ["https://example.invalid/source"]);
  assert.equal(article.metadata.evidence.sourceConfirmed, true);
  assert.equal(article.metadata.validation.claims, true);
  assert.equal(article.metadata.publication.note, "retained");
  assert.equal(article.metadata.advance.toStage, "PREPARAÇÃO");
});

test("export rejects non-UTC or invalid timestamps", () => {
  const state = makeState();
  for (const timestamp of [
    "2026-10-14T17:31:00-03:00",
    "2026-02-30T17:31:00.000Z",
    "not-a-timestamp"
  ]) {
    assert.throws(() => createConsoleExportEnvelope(state, timestamp), /ISO 8601 UTC/);
  }
});

test("console export and import controls use the envelope implementation", async () => {
  const consoleSource = await readFile(new URL("../assets/editorial-console.mjs", import.meta.url), "utf8");
  assert.match(consoleSource, /createConsoleExportEnvelope\(state\)/);
  assert.match(consoleSource, /link\.download = "asp-console-export\.json"/);
  assert.match(consoleSource, /importConsoleState\(await file\.text\(\)/);
  assert.match(consoleSource, /statusMessage\(`Could not import editorial state: \$\{error\.message\}`/);
});

test("legacy schema-v2 state files remain importable", () => {
  const legacy = makeState();
  const result = runImportAgainstExisting(JSON.stringify(legacy), makeState());
  assert.deepEqual(result.currentState, legacy);
  assert.deepEqual(JSON.parse(result.storedState), legacy);
});

test("legacy schema-v1 state import retains the supported migration", () => {
  const legacy = makeState();
  legacy.schemaVersion = 1;
  const article = legacy.blocks.find((block) => block.id === "home-radar-article");
  delete article.metadata.enabled;
  article.content.verdictType = "Fire";
  article.content.editorialStatus = "New Release";

  const migrated = migrateEditorialState(legacy);
  const result = runImportAgainstExisting(JSON.stringify(legacy), makeState());
  assert.deepEqual(result.currentState, migrated);
  assert.equal(result.currentState.schemaVersion, 2);
  const importedArticle = result.currentState.blocks.find((block) => block.id === article.id);
  assert.equal(importedArticle.metadata.enabled, true);
  assert.equal(importedArticle.metadata.verdict, "Fire");
  assert.equal(importedArticle.metadata.editorialStatus, "New Release");
  assert.equal(Object.hasOwn(importedArticle.content, "verdictType"), false);
});

test("malformed JSON is rejected without changing stored or in-memory state", () => {
  const original = makeState();
  let current = structuredClone(original);
  let stored = JSON.stringify(original);
  assert.throws(() => importConsoleState("{", {
    validateState,
    persist: (candidate) => { stored = JSON.stringify(candidate); },
    apply: (candidate) => { current = candidate; }
  }), SyntaxError);
  assert.deepEqual(current, original);
  assert.equal(stored, JSON.stringify(original));
});

test("unknown envelope format and version are rejected", () => {
  const unknownFormat = makeEnvelope();
  unknownFormat.format = "other-console";
  assert.throws(() => runImportAgainstExisting(JSON.stringify(unknownFormat), makeState()), /Unsupported export format/);

  const unknownVersion = makeEnvelope();
  unknownVersion.formatVersion = 2;
  assert.throws(() => runImportAgainstExisting(JSON.stringify(unknownVersion), makeState()), /Unsupported export format version/);
});

test("inconsistent envelope source metadata is rejected", () => {
  for (const mutate of [
    (envelope) => { envelope.source.application = "other-app"; },
    (envelope) => { envelope.source.contentSchemaVersion = 1; },
    (envelope) => { envelope.source.revision += 1; },
    (envelope) => { envelope.source.updatedAt = null; }
  ]) {
    const envelope = makeEnvelope();
    mutate(envelope);
    assert.throws(() => runImportAgainstExisting(JSON.stringify(envelope), makeState()));
  }
});

test("unsupported state schema versions are rejected in envelopes and legacy files", () => {
  const envelope = makeEnvelope();
  envelope.state.schemaVersion = 99;
  envelope.source.contentSchemaVersion = 99;
  assert.throws(
    () => runImportAgainstExisting(JSON.stringify(envelope), makeState()),
    /Unsupported envelope content schema version/
  );

  const legacy = makeState();
  legacy.schemaVersion = 99;
  assert.throws(
    () => runImportAgainstExisting(JSON.stringify(legacy), makeState()),
    /schema version/
  );
});

test("invalid blocks and unapproved or missing promotions are rejected", () => {
  const invalidType = makeEnvelope();
  invalidType.state.blocks[0].type = "unknown";
  assert.throws(() => runImportAgainstExisting(JSON.stringify(invalidType), makeState()), /Unsupported content block type/);

  const unsafeLink = makeEnvelope();
  unsafeLink.state.blocks.find((block) => block.id === "home-radar-article").content.href = "javascript:alert(1)";
  assert.throws(() => runImportAgainstExisting(JSON.stringify(unsafeLink), makeState()), /unsafe link/);

  const unapprovedPromotion = makeEnvelope();
  const deal = unapprovedPromotion.state.blocks.find((block) => block.type === "deal");
  deal.content.promotionId = "draft-promotion";
  assert.throws(
    () => runImportAgainstExisting(JSON.stringify(unapprovedPromotion), makeState()),
    /approved public promotion/
  );

  const missingPromotion = makeEnvelope();
  missingPromotion.state.blocks.find((block) => block.type === "deal").content.promotionId = "missing-promotion";
  assert.throws(
    () => runImportAgainstExisting(JSON.stringify(missingPromotion), makeState()),
    /approved public promotion/
  );
});

test("rejected candidate validation leaves prior state and storage unchanged", () => {
  const previous = makeState();
  const invalid = makeEnvelope();
  invalid.state.blocks[0].id = "";
  let currentState = structuredClone(previous);
  let storedState = JSON.stringify(previous);
  let persistCalls = 0;
  let applyCalls = 0;

  assert.throws(() => importConsoleState(JSON.stringify(invalid), {
    validateState,
    persist: (candidate) => {
      persistCalls += 1;
      storedState = JSON.stringify(candidate);
    },
    apply: (candidate) => {
      applyCalls += 1;
      currentState = candidate;
    }
  }), /IDs must be non-empty and unique/);

  assert.equal(persistCalls, 0);
  assert.equal(applyCalls, 0);
  assert.deepEqual(currentState, previous);
  assert.equal(storedState, JSON.stringify(previous));
});

test("failed persistence does not update the in-memory state", () => {
  const previous = makeState();
  let currentState = structuredClone(previous);
  assert.throws(() => importConsoleState(JSON.stringify(makeEnvelope()), {
    validateState,
    persist: () => { throw new Error("storage unavailable"); },
    apply: (candidate) => { currentState = candidate; }
  }), /storage unavailable/);
  assert.deepEqual(currentState, previous);
});
