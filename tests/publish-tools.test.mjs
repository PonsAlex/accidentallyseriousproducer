import test from "node:test";
import assert from "node:assert/strict";
import {
  applyDecisions,
  escapeHtml,
  publicationBlockers,
  registrationSnippet,
  renderArticlePage,
  selectArticleBlocks
} from "../scripts/article-generate.mjs";
import {
  buildScaffold,
  mergeCatalogRecord,
  proposeEditorialStatus,
  slugify
} from "../scripts/publish-scaffold.mjs";

function reviewBlock(overrides = {}) {
  return {
    id: "product-review-u-he-zebralette-3",
    type: "product-review",
    section: "articles",
    position: 10,
    status: "draft",
    content: {
      title: "Zebralette 3",
      body: "A free spectral oscillator from u-he.",
      verdict: "A genuinely free instrument with unusual depth.",
      href: "",
      linkLabel: ""
    },
    metadata: { verdict: "Fire", editorialStatus: "Free" },
    ...overrides
  };
}

function editorialRecord(overrides = {}) {
  return {
    recordId: "u-he-zebralette-3",
    type: "product-review",
    facts: {
      product: { name: "Zebralette 3", developer: "u-he", category: "plugin" },
      offer: { promoPrice: 0, regularPrice: null, currency: null, permanent: true, endsAt: null, endsAtDate: null },
      sources: ["https://u-he.com/products/plug-ins/zebralette3/"]
    },
    notApplicable: [],
    draftCopy: {},
    ...overrides
  };
}

test("slugify produces catalog ids the board accepts", () => {
  assert.equal(slugify("u-he"), "u-he");
  assert.equal(slugify("Audio Plugin Deals"), "audio-plugin-deals");
  assert.equal(slugify("  Acustica  Audio  "), "acustica-audio");
  assert.equal(slugify("KORG"), "korg");
  assert.equal(slugify("---"), "");
});

test("the Status proposal reads the adapted record shape", () => {
  // Permanent freeware: the offer lives under facts.offer and the nature is
  // inferred from `permanent`, not from an offerNature field.
  assert.deepEqual(
    proposeEditorialStatus(editorialRecord()).status,
    "Free"
  );
  assert.equal(
    proposeEditorialStatus(editorialRecord()).reason,
    "permanent freeware has no deadline"
  );

  const launch = editorialRecord({
    facts: {
      product: { name: "CROWD", developer: "Thenatan", category: "plugin" },
      offer: { promoPrice: 49, permanent: false, endsAtDate: "2026-10-25" }
    },
    offerNature: "launch-price"
  });
  assert.equal(proposeEditorialStatus(launch).status, "New Release");
});

test("the Status proposal follows the deadline, not the price alone", () => {
  const now = new Date("2026-10-17T12:00:00Z");
  const offer = (endsAtDate) => ({
    facts: {
      product: { name: "X", developer: "Y", category: "plugin" },
      offer: { promoPrice: 9, permanent: false, endsAtDate }
    }
  });

  // A date-only deadline runs to the end of that UTC day, so "today" is within
  // 24 hours and "tomorrow" is not.
  assert.equal(proposeEditorialStatus(offer("2026-10-17"), now).status, "Call an Ambulance");
  assert.equal(proposeEditorialStatus(offer("2026-10-18"), now).status, "Last Chance");
  assert.equal(proposeEditorialStatus(offer("2026-10-21"), now).status, "Last Chance");
  assert.equal(proposeEditorialStatus(offer("2026-12-01"), now).status, "");
  assert.equal(proposeEditorialStatus(offer(null), now).status, "");
});

test("the scaffold derives the three catalog ids from the record", () => {
  const scaffold = buildScaffold(editorialRecord());
  assert.equal(scaffold.program.id, "u-he");
  assert.equal(scaffold.product.id, "u-he-zebralette-3");
  assert.equal(scaffold.link.id, "link-u-he-zebralette-3");
  assert.equal(scaffold.link.productId, "u-he-zebralette-3");
  assert.equal(scaffold.link.programId, "u-he");

  // Without an affiliate URL the developer page is the destination, and the link
  // stays unverified so it cannot render by accident.
  assert.equal(scaffold.link.destinationUrl, "https://u-he.com/products/plug-ins/zebralette3/");
  assert.equal(scaffold.link.requiresReview, true);
  assert.equal(scaffold.proposedStatus, "Free");
});

test("the scaffold accepts a real affiliate URL and a verification attestation", () => {
  const scaffold = buildScaffold(editorialRecord(), {
    affiliateUrl: "https://www.waproduction.com/#abc123",
    verified: true
  });
  assert.equal(scaffold.link.destinationUrl, "https://www.waproduction.com/#abc123");
  assert.equal(scaffold.link.requiresReview, false);
});

test("the scaffold refuses a record with no usable destination", () => {
  const noSource = editorialRecord({
    facts: {
      product: { name: "X", developer: "Y", category: "plugin" },
      offer: { promoPrice: 0, permanent: true },
      sources: []
    }
  });
  assert.throws(() => buildScaffold(noSource), /No usable destination/);
});

test("the scaffold refuses an unsafe affiliate URL instead of writing it", () => {
  assert.throws(
    () => buildScaffold(editorialRecord(), { affiliateUrl: "javascript:alert(1)" }),
    /No usable destination/
  );
  assert.throws(
    () => buildScaffold(editorialRecord(), { affiliateUrl: "http://insecure.example/x" }),
    /No usable destination/
  );
});

test("merging a catalog record adds it once and replaces it after", () => {
  const existing = [{ id: "other" }];
  const first = mergeCatalogRecord(existing, { id: "u-he", name: "u-he" });
  assert.equal(first.action, "added");
  assert.equal(first.collection.length, 2);

  const second = mergeCatalogRecord(first.collection, { id: "u-he", name: "u-he renamed" });
  assert.equal(second.action, "replaced");
  assert.equal(second.collection.length, 2);
  assert.equal(second.collection[1].name, "u-he renamed");
});

test("a Verdict outside the board vocabulary is rejected", () => {
  const state = { blocks: [reviewBlock({ metadata: { verdict: "", editorialStatus: "" } })] };
  assert.throws(() => applyDecisions(state, { "product-review-u-he-zebralette-3": { verdict: "Great" } }), /is not a Verdict/);
  assert.throws(() => applyDecisions(state, { "product-review-u-he-zebralette-3": { status: "Hot" } }), /is not a Status/);
  assert.throws(() => applyDecisions(state, { "product-review-missing": { verdict: "Fire" } }), /unknown block/);

  const applied = applyDecisions(state, {
    "product-review-u-he-zebralette-3": { verdict: "fire", status: "free", note: "  A free instrument with unusual depth.  " }
  });
  assert.deepEqual(applied, [
    "product-review-u-he-zebralette-3 verdict=Fire",
    "product-review-u-he-zebralette-3 status=Free",
    "product-review-u-he-zebralette-3 note written"
  ]);
  assert.equal(state.blocks[0].metadata.verdict, "Fire");
  assert.equal(state.blocks[0].content.verdict, "A free instrument with unusual depth.");
});

test("a block without a Verdict is a publication blocker", () => {
  const blockers = publicationBlockers([
    reviewBlock({ id: "a", metadata: { verdict: "" } }),
    reviewBlock({ id: "b", content: { title: "", body: "" }, metadata: { verdict: "Fire" } }),
    reviewBlock({ id: "c" })
  ]);
  assert.deepEqual(
    blockers.map((entry) => `${entry.blockId}:${entry.reason}`),
    ["a:no Verdict — an editorial decision is required", "b:no title", "b:no body copy"]
  );
});

test("article blocks are selected by section and ordered by position", () => {
  const state = {
    blocks: [
      reviewBlock({ id: "later", position: 30 }),
      reviewBlock({ id: "home", section: "home", position: 10 }),
      reviewBlock({ id: "first", position: 10 })
    ]
  };
  assert.deepEqual(
    selectArticleBlocks(state).map((block) => block.id),
    ["first", "later"]
  );
});

test("the rendered page carries the markup the Console extracts", () => {
  const html = renderArticlePage({
    blocks: [reviewBlock()],
    slug: "freeware-radar",
    title: "Freeware Radar",
    deck: "Two free instruments.",
    eyebrow: "Editorial Radar",
    date: "2026-10-17"
  });

  // Exactly the selectors readComponent() looks for.
  assert.match(html, /<section class="product-review">/);
  assert.match(html, /<div class="verdict-badge fire">Fire<\/div>/);
  assert.match(html, /<div class="status-badge free">Free<\/div>/);
  assert.match(html, /<h2>Zebralette 3<\/h2>/);
  assert.match(html, /<p>A free spectral oscillator from u-he\.<\/p>/);
  assert.match(html, /<p class="editorial-note"><strong>Verdict:<\/strong> /);
  assert.match(html, /<link rel="canonical" href="https:\/\/accidentallyseriousproducer\.com\/articles\/freeware-radar\.html">/);
  assert.match(html, /"datePublished": "2026-10-17"/);
});

test("a block with no destination gets no call to action", () => {
  const html = renderArticlePage({
    blocks: [reviewBlock({ content: { ...reviewBlock().content, href: "/go/link-u-he-zebralette-3", linkLabel: "Get it free" } })],
    slug: "s",
    title: "T",
    date: "2026-10-17"
  });
  assert.match(html, /<a href="\/go\/link-u-he-zebralette-3" class="cta-button">Get it free<\/a>/);

  const without = renderArticlePage({ blocks: [reviewBlock()], slug: "s", title: "T", date: "2026-10-17" });
  assert.equal(without.includes('class="cta-button"'), false);
  assert.match(without, /No reviewed destination/);
});

test("copy is escaped so a record cannot inject markup", () => {
  assert.equal(escapeHtml('a "b" <c> & d'), "a &quot;b&quot; &lt;c&gt; &amp; d");
  const html = renderArticlePage({
    blocks: [reviewBlock({ content: { ...reviewBlock().content, title: "Bad <script>alert(1)</script>" } })],
    slug: "s",
    title: "T",
    date: "2026-10-17"
  });
  assert.equal(html.includes("<script>alert(1)</script>"), false);
  assert.match(html, /Bad &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test("the registration snippet names the page and every block", () => {
  const snippet = registrationSnippet([reviewBlock(), reviewBlock({ id: "second" })], {
    slug: "freeware-radar",
    pageKey: "freewareRadar"
  });
  assert.match(snippet, /freewareRadar: "\/articles\/freeware-radar\.html",/);
  assert.match(snippet, /add\("product-review-u-he-zebralette-3", "product-review", documents\.freewareRadar, "\.product-review", 0\);/);
  assert.match(snippet, /add\("second", "product-review", documents\.freewareRadar, "\.product-review", 1\);/);
});
