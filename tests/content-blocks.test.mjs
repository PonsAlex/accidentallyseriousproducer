import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  EDITORIAL_STATUSES,
  EDITORIAL_VERDICTS,
  CONTENT_TYPE_SECTIONS,
  addEditorialBlockToState,
  advanceEditorialBlock,
  createEditorialBlock,
  createInitialEditorialState,
  invalidateEditorialAdvance,
  migrateEditorialState,
  moveEditorialBlock,
  normalizeBlockPositions,
  validateEditorialState
} from "../assets/content-blocks.mjs";
import {
  loadPublicComponentTemplates,
  PUBLIC_COMPONENT_BLOCK_IDS
} from "../assets/public-component-templates.mjs";

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

test("new blocks use only compatible component types and start as unapproved RADAR drafts", () => {
  const state = createInitialEditorialState({ products, promotions });
  let id = 0;

  for (const [type, sections] of Object.entries(CONTENT_TYPE_SECTIONS)) {
    for (const section of sections) {
      const block = createEditorialBlock({
        type,
        section,
        existingBlocks: state.blocks,
        idFactory: () => `test-${++id}`
      });
      validateEditorialState({
        schemaVersion: 2,
        revision: 1,
        updatedAt: null,
        blocks: [block]
      });
      assert.equal(block.type, type);
      assert.equal(block.section, section);
      assert.equal(block.status, "draft");
      assert.equal(block.metadata.editorialStage, "RADAR");
      assert.equal(block.metadata.enabled, true);
      assert.equal(block.metadata.verdict, "");
      assert.equal(block.metadata.editorialStatus, "");
      assert.equal(block.metadata.publication.state, "unpublished");
      assert.equal(block.metadata.advance.selected, false);
      assert.equal(block.metadata.advance.ready, false);
      assert.ok(Object.values(block.content).every((value) => value === "" || value === null || value === undefined));
      if (type === "deal") {
        assert.deepEqual(block.content, { promotionId: null });
      }
    }
  }

  assert.throws(
    () => createEditorialBlock({ type: "deal", section: "home", idFactory: () => "invalid" }),
    /not supported in section/
  );
});

test("adding a block creates a unique persisted-ready state without mutating the prior state", () => {
  const original = createInitialEditorialState({ products, promotions });
  const originalCopy = structuredClone(original);
  let id = 0;
  const added = addEditorialBlockToState(original, {
    type: "article",
    section: "home",
    idFactory: () => `article-${++id}`,
    updatedAt: "2026-10-04T12:00:00Z"
  });
  const addedAgain = addEditorialBlockToState(added, {
    type: "article",
    section: "home",
    idFactory: () => `article-${++id}`,
    updatedAt: "2026-10-04T12:01:00Z"
  });
  const storage = new Map();
  storage.set("asp-editorial-console-v1", JSON.stringify(addedAgain));
  const restored = JSON.parse(storage.get("asp-editorial-console-v1"));

  assert.deepEqual(original, originalCopy);
  assert.equal(added.revision, original.revision + 1);
  assert.equal(addedAgain.revision, added.revision + 1);
  assert.notEqual(added.blocks.at(-1).id, addedAgain.blocks.at(-1).id);
  assert.equal(restored.blocks.at(-1).id, addedAgain.blocks.at(-1).id);
  assert.equal(restored.blocks.at(-1).metadata.advance.ready, false);
  assert.throws(
    () => addEditorialBlockToState(addedAgain, {
      type: "article",
      section: "home",
      idFactory: () => "article-1"
    }),
    /IDs must be unique/
  );
});

test("Add Block cancel closes the dialog without invoking block creation", async () => {
  const [markup, consoleScript] = await Promise.all([
    readFile(new URL("../console.html", import.meta.url), "utf8"),
    readFile(new URL("../assets/editorial-console.mjs", import.meta.url), "utf8")
  ]);

  assert.match(
    markup,
    /<button(?=[^>]*id="cancel-add-block")(?=[^>]*type="button")[^>]*>Cancel/
  );
  assert.match(
    consoleScript,
    /document\.querySelector\("#cancel-add-block"\)\.addEventListener\("click", \(\) => \{\s*addBlockDialog\.close\(\);\s*\}\);/
  );
});

test("an incomplete deal contains no invented offer facts and remains unpublished", () => {
  const block = createEditorialBlock({
    type: "deal",
    section: "deals",
    idFactory: () => "incomplete-deal"
  });
  const serialized = JSON.stringify(block);

  assert.equal(block.content.promotionId, null);
  assert.equal(block.status, "draft");
  assert.equal(block.metadata.publication.state, "unpublished");
  assert.equal(Object.hasOwn(block.content, "price"), false);
  assert.equal(Object.hasOwn(block.content, "url"), false);
  assert.equal(Object.hasOwn(block.content, "evidence"), false);
  assert.equal(block.metadata.sources.length, 0);
  assert.equal(block.metadata.evidence.priceConfirmed, false);
  assert.doesNotMatch(serialized, /"verdict":"(?:Fire|Stash|Digital Furniture|Nah)"/);
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
  const [home, radar, lab, templates, dealsPage] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../articles/radar-setembro-22.html", import.meta.url), "utf8"),
    readFile(new URL("../lab.html", import.meta.url), "utf8"),
    readFile(new URL("../assets/public-component-templates.mjs", import.meta.url), "utf8"),
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
});

test("public template loader builds every initial ASP content block from the public pages", async () => {
  const pageFiles = new Map([
    ["/index.html", new URL("../index.html", import.meta.url)],
    ["/articles/radar-setembro-22.html", new URL("../articles/radar-setembro-22.html", import.meta.url)],
    ["/lab.html", new URL("../lab.html", import.meta.url)]
  ]);
  const requested = [];
  const fetcher = async (url) => {
    requested.push(url);
    const file = pageFiles.get(url);
    if (!file) throw new Error(`Unexpected public template URL: ${url}`);
    return { ok: true, text: () => readFile(file, "utf8") };
  };
  const makeComponent = () => ({
    querySelector: () => null,
    querySelectorAll: () => [],
    cloneNode: () => makeComponent()
  });
  const parseDocument = (html) => ({
    querySelectorAll(selector) {
      const patterns = {
        "main > .hero": /<main\b[^>]*>\s*<section class="hero">/,
        ".featured-card": /class="featured-card"/g,
        ".product-review": /class="product-review"/g,
        ".project-card": /class="project-card"/g
      };
      const pattern = patterns[selector];
      assert.ok(pattern, `unexpected public component selector: ${selector}`);
      return Array.from(html.match(pattern) ?? [], makeComponent);
    }
  });
  const offers = [];
  const templates = await loadPublicComponentTemplates({
    fetcher,
    parseDocument,
    createOfferElement: (promotionId) => {
      const offer = { promotionId };
      offers.push(offer);
      return offer;
    }
  });
  const publicComponents = Object.fromEntries(
    PUBLIC_COMPONENT_BLOCK_IDS.map((id) => [id, templates.readInitialContent(id)])
  );
  const state = createInitialEditorialState({ products, promotions }, publicComponents);
  const actualIds = state.blocks
    .filter((block) => block.type !== "deal")
    .map((block) => block.id);

  assert.deepEqual(requested.sort(), [...pageFiles.keys()].sort());
  assert.deepEqual(actualIds, [
    "home-hero",
    "home-radar-article",
    "home-plugin-audit",
    "radar-gold-6-review",
    "radar-big-bottom-review",
    "radar-waves-review",
    "lab-jack-in-the-box"
  ]);
  assert.deepEqual(actualIds, [...PUBLIC_COMPONENT_BLOCK_IDS]);
  assert.equal(state.blocks.length, 8);
  for (const block of state.blocks) {
    const rendered = templates.renderPublicComponent(block);
    assert.ok(rendered, `expected a renderable public component for ${block.id}`);
  }
  assert.deepEqual(offers.map((offer) => offer.promotionId).sort(), ["published-promotion"]);

  for (const [type, sections] of Object.entries(CONTENT_TYPE_SECTIONS)) {
    for (const section of sections) {
      const block = createEditorialBlock({ type, section, idFactory: () => `new-${type}` });
      if (type !== "deal") {
        assert.equal(templates.renderPublicComponent.hasTemplate(block.id, type), true);
      }
      assert.ok(templates.renderPublicComponent(block), `expected a public type template for ${type}`);
    }
  }
  assert.deepEqual(offers.at(-1).promotionId, null);
});

test("public template loader reports the failing page URL", async () => {
  await assert.rejects(
    loadPublicComponentTemplates({
      fetcher: async (url) => {
        if (url === "/index.html") throw new Error("network unavailable");
        return { ok: true, text: async () => "" };
      },
      parseDocument: () => ({ querySelectorAll: () => [] })
    }),
    /Could not load public component templates from \/index\.html: network unavailable/
  );
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
