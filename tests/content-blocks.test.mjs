import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  EDITORIAL_STATUSES,
  EDITORIAL_VERDICTS,
  advanceEditorialBlock,
  createInitialEditorialState,
  invalidateEditorialAdvance,
  migrateEditorialState,
  moveEditorialBlock,
  normalizeBlockPositions,
  validateEditorialState
} from "../assets/content-blocks.mjs";

const products = [
  { id: "published-product", name: "Published Product", description: "Existing product." },
  { id: "draft-product", name: "Draft Product", description: "Unpublished product." }
];

const promotions = [
  { id: "published-promotion", productId: "published-product", publicationStatus: "published", requiresReview: false },
  { id: "draft-promotion", productId: "draft-product", publicationStatus: "draft", requiresReview: true }
];

test("initial blocks use the public ASP catalog and never seed the review-required Waves offer", async () => {
  const [publicProducts, publicPromotions] = await Promise.all([
    readFile(new URL("../data/products.json", import.meta.url), "utf8"),
    readFile(new URL("../data/promotions.json", import.meta.url), "utf8")
  ]);
  const state = createInitialEditorialState({
    products: JSON.parse(publicProducts),
    promotions: JSON.parse(publicPromotions)
  });
  const dealIds = state.blocks
    .filter((block) => block.type === "deal")
    .map((block) => block.content.promotionId)
    .sort();

  assert.deepEqual(dealIds, ["promo-acustica-sep26", "promo-dawjunkie-sep26"]);
});

test("initial content blocks represent existing ASP component types and omit unapproved promotions", () => {
  const publicComponents = {
    "home-hero": {
      content: { eyebrow: "Public eyebrow", title: "Public headline" },
      metadata: {}
    },
    "radar-waves-review": {
      content: { title: "Public review", body: "Public body" },
      metadata: { editorialStage: "PREPARAÇÃO" }
    }
  };
  const state = createInitialEditorialState(
    { products, promotions },
    publicComponents
  );
  validateEditorialState(state);

  assert.ok(state.blocks.some((block) => block.type === "hero"));
  assert.ok(state.blocks.some((block) => block.type === "article"));
  assert.ok(state.blocks.some((block) => block.type === "product-review"));
  assert.ok(state.blocks.some((block) => block.type === "project"));
  assert.deepEqual(
    state.blocks.filter((block) => block.type === "deal").map((block) => block.content.promotionId),
    ["published-promotion"]
  );
  const pendingReview = state.blocks.find((block) => block.id === "radar-waves-review");
  assert.equal(pendingReview.status, "review");
  assert.equal(pendingReview.metadata.editorialStage, "PREPARAÇÃO");
  assert.equal(pendingReview.metadata.editorialStatus, "");
  assert.equal(state.blocks[0].content.title, "Public headline");
  assert.equal(state.blocks[0].content.eyebrow, "Public eyebrow");
});

test("editorial metadata preserves evidence, source, verdict, validation and future advance fields", () => {
  const state = createInitialEditorialState({ products, promotions });
  const block = state.blocks[0];

  assert.ok(Array.isArray(block.metadata.sources));
  assert.equal(typeof block.metadata.evidence, "object");
  assert.equal(typeof block.metadata.selection, "string");
  assert.equal(typeof block.metadata.verdict, "string");
  assert.equal(typeof block.metadata.validation, "object");
  assert.equal(typeof block.metadata.publication, "object");
  assert.equal(typeof block.metadata.advance.ready, "boolean");
});

test("Verdict and Status keep the README taxonomies and remain independent of advancement", () => {
  assert.deepEqual(EDITORIAL_VERDICTS, ["Fire", "Stash", "Digital Furniture", "Nah"]);
  assert.deepEqual(
    EDITORIAL_STATUSES.filter(Boolean),
    ["Breaking", "New Release", "Free", "Call an Ambulance", "Last Chance", "Updated"]
  );
  const state = createInitialEditorialState({ products, promotions });
  const block = state.blocks.find((item) => item.type === "product-review");
  const originalVerdict = block.metadata.verdict;
  const originalStatus = block.metadata.editorialStatus;
  assert.throws(() => advanceEditorialBlock(block, { confirmed: false }), /explicit human confirmation/);
  assert.equal(block.metadata.editorialStage, "RADAR");
  assert.equal(block.metadata.advance.ready, false);

  const advanced = advanceEditorialBlock(block, {
    confirmed: true,
    requestedAt: "2026-10-01T12:00:00Z"
  });
  assert.equal(advanced.fromStage, "RADAR");
  assert.equal(advanced.toStage, "PREPARAÇÃO");
  assert.equal(block.id, "radar-gold-6-review");
  assert.equal(block.metadata.verdict, originalVerdict);
  assert.equal(block.metadata.editorialStatus, originalStatus);
  assert.equal(block.metadata.advance.ready, true);
  assert.equal(block.metadata.advance.requestedAt, "2026-10-01T12:00:00Z");
  assert.throws(() => advanceEditorialBlock(block, { confirmed: true, requestedAt: "invalid" }), /timestamp/);
  block.metadata.editorialStage = "PUBLICATION GATE";
  assert.throws(() => advanceEditorialBlock(block, { confirmed: true }), /no recognized next/);
  invalidateEditorialAdvance(block);
  assert.equal(block.metadata.advance.selected, false);
  assert.equal(block.metadata.advance.ready, false);
  assert.equal(block.metadata.advance.requestedAt, "2026-10-01T12:00:00Z");
});

test("moving components changes section and order without replacing content or editorial metadata", () => {
  const state = createInitialEditorialState({ products, promotions });
  const selected = state.blocks.find((block) => block.id === "home-plugin-audit");
  selected.metadata.sources.push("https://example.com/source");
  selected.metadata.verdict = "Fire";
  const moved = moveEditorialBlock(state.blocks, {
    id: selected.id,
    section: "articles",
    beforeId: "radar-gold-6-review"
  });
  const relocated = moved.find((block) => block.id === selected.id);

  assert.equal(relocated.section, "articles");
  assert.ok(relocated.position < moved.find((block) => block.id === "radar-gold-6-review").position);
  assert.deepEqual(relocated.content, selected.content);
  assert.deepEqual(relocated.metadata, selected.metadata);
  assert.equal(state.blocks.find((block) => block.id === selected.id).section, "home");
});

test("schema v1 local state migrates without discarding verdict, status, or editorial progress", () => {
  const state = createInitialEditorialState({ products, promotions });
  const legacy = structuredClone(state);
  legacy.schemaVersion = 1;
  for (const block of legacy.blocks) {
    delete block.metadata.enabled;
    if (block.type === "product-review") {
      block.content.verdictType = "Fire";
      block.content.editorialStatus = "New Release";
      block.metadata.editorialStage = "PREPARAÇÃO";
      break;
    }
  }
  const migrated = migrateEditorialState(legacy);
  const review = migrated.blocks.find((block) => block.type === "product-review");

  assert.equal(migrated.schemaVersion, 2);
  assert.equal(review.metadata.enabled, true);
  assert.equal(review.metadata.verdict, "Fire");
  assert.equal(review.metadata.editorialStatus, "New Release");
  assert.equal(review.metadata.editorialStage, "PREPARAÇÃO");
  assert.equal(Object.hasOwn(review.content, "verdictType"), false);
  assert.equal(validateEditorialState(migrated), migrated);
});

test("console component templates map to markup present on the actual public pages", async () => {
  const [home, radar, lab, templates, redirects, dealsPage] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../articles/radar-setembro-22.html", import.meta.url), "utf8"),
    readFile(new URL("../lab.html", import.meta.url), "utf8"),
    readFile(new URL("../assets/public-component-templates.mjs", import.meta.url), "utf8"),
    readFile(new URL("../_redirects", import.meta.url), "utf8"),
    readFile(new URL("../assets/deals-page.mjs", import.meta.url), "utf8")
  ]);
  assert.match(home, /<section class="hero">/);
  assert.ok((home.match(/class="featured-card"/g) ?? []).length >= 2);
  assert.ok((radar.match(/class="product-review"/g) ?? []).length >= 2);
  assert.match(lab, /class="project-card"/);
  assert.match(templates, /add\("home-hero", "hero", documents\.home, "main > \.hero"\)/);
  assert.match(templates, /add\("home-radar-article", "article", documents\.home, "\.featured-card", 0\)/);
  assert.match(templates, /add\("radar-gold-6-review", "product-review", documents\.radar, "\.product-review", 0\)/);
  assert.match(templates, /readInitialContent/);
  assert.match(templates, /PUBLIC_COMPONENT_BLOCK_IDS/);
  assert.match(templates, /createElement\("affiliate-offer"\)/);
  assert.match(dealsPage, /document\.createElement\("affiliate-offer"\)/);
  assert.match(redirects, /^\/console \/console\.html 200$/m);
});

test("state validation rejects unknown types, duplicate IDs and unsupported schema versions", () => {
  const state = createInitialEditorialState({ products, promotions });
  assert.throws(() => validateEditorialState({ ...state, schemaVersion: 1 }), /schema version/);
  assert.throws(
    () => validateEditorialState({ ...state, blocks: [{ ...state.blocks[0], type: "fake-card" }] }),
    /Unsupported content block type/
  );
  assert.throws(
    () => validateEditorialState({ ...state, blocks: [state.blocks[0], state.blocks[0]] }),
    /unique/
  );
  assert.throws(
    () => validateEditorialState({
      ...state,
      blocks: [{ ...state.blocks[0], content: { ...state.blocks[0].content, href: "javascript:alert(1)" } }]
    }),
    /unsafe link/
  );
  assert.throws(
    () => validateEditorialState({
      ...state,
      blocks: [{ ...state.blocks[1], content: { ...state.blocks[1].content, date: "2026-02-31" } }]
    }),
    /invalid publication date/
  );
});

test("block ordering is stable and positions are normalized per section", () => {
  const state = createInitialEditorialState({ products, promotions });
  const home = state.blocks.filter((block) => block.section === "home").reverse();
  const normalized = normalizeBlockPositions(home);

  assert.deepEqual(normalized.map((block) => block.position), [0, 10, 20]);
  assert.deepEqual(
    normalized.map((block) => block.id),
    [...home].sort((left, right) => left.position - right.position).map((block) => block.id)
  );
});
