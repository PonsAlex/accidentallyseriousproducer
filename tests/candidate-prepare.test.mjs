import test from "node:test";
import assert from "node:assert/strict";
import {
  PREPARE_STATES,
  assessCandidate,
  extractJsonLdOffer,
  nameTokens,
  pageMentionsProduct,
  summarise
} from "../scripts/candidate-prepare.mjs";

function candidate(overrides = {}) {
  return {
    candidateId: "acme-widget",
    product: { name: "Acme Widget", developer: "Acme Audio" },
    links: { sourceUrl: "https://acmeaudio.com/widget" },
    confidence: { product: "low", price: "low", dates: "low", link: "low" },
    ...overrides
  };
}

const page = (overrides = {}) => ({
  ok: true,
  status: 200,
  finalUrl: "https://acmeaudio.com/widget",
  html: "<html><head><title>Acme Widget</title></head><body>Acme Widget is here</body></html>",
  ...overrides
});

test("a page that loads, mentions the product and publishes a price is verified", () => {
  const html = `<html><head><title>Acme Widget</title>
    <script type="application/ld+json">{"@type":"Product","offers":{"@type":"Offer","price":29,"priceCurrency":"USD"}}</script>
    </head><body>Acme Widget</body></html>`;

  const result = assessCandidate(candidate(), page({ html }), {
    now: new Date("2026-10-22T12:00:00Z")
  });

  assert.equal(result.state, PREPARE_STATES.VERIFIED);
  assert.equal(result.patch.primarySourceFound, true);
  assert.equal(result.patch.evidence.length, 1);
  assert.equal(result.patch.offer.promoPrice, 29);
  assert.equal(result.patch.offer.currency, "USD");
});

test("priceValidUntil is recorded as a hint and never used as the deadline", () => {
  const html = `<html><head><title>Acme Widget</title>
    <script type="application/ld+json">{"@type":"Product","offers":{"price":0,"priceCurrency":"EUR","priceValidUntil":"2028-01-01"}}</script>
    </head><body>Acme Widget</body></html>`;

  const result = assessCandidate(candidate(), page({ html }), { now: new Date("2026-10-22T12:00:00Z") });

  assert.equal(result.priceValidUntilHint, "2028-01-01");
  assert.equal(result.patch.offer.endsAtDate, undefined);
});

test("an email that never names a product cannot be prepared", () => {
  const result = assessCandidate(candidate({ product: { name: "discounts" } }), page());
  assert.equal(result.state, PREPARE_STATES.OFF_TOPIC);
  assert.match(result.reason, /não identifica um produto/);
});

test("a sentence is not a product name", () => {
  const sentence = "presets in Ostinato Seventeen scales in Chords";
  const result = assessCandidate(candidate({ product: { name: sentence } }), page());
  assert.equal(result.state, PREPARE_STATES.OFF_TOPIC);
  assert.match(result.reason, /frase/);
});

test("a page that does not mention the product is not its source", () => {
  const result = assessCandidate(
    candidate(),
    page({ finalUrl: "https://acmeaudio.com/changelog", html: "<title>Changelog</title>" })
  );
  assert.equal(result.state, PREPARE_STATES.OFF_TOPIC);
  assert.match(result.reason, /não menciona o produto/);
});

test("a store is not the vendor, even when the product is on it", () => {
  const result = assessCandidate(
    candidate(),
    page({ finalUrl: "https://www.pluginboutique.com/product/123-Acme-Widget" })
  );
  assert.equal(result.state, PREPARE_STATES.OFF_TOPIC);
  assert.match(result.reason, /loja/);
});

test("an unreachable page leaves the candidate where it was", () => {
  const result = assessCandidate(candidate(), { ok: false, status: 0, html: "", finalUrl: "" });
  assert.equal(result.state, PREPARE_STATES.UNREACHABLE);
  assert.equal(result.patch, undefined);
});

test("a lead with no vendor URL is reported as such", () => {
  const result = assessCandidate(candidate({ links: { sourceUrl: null } }), page());
  assert.equal(result.state, PREPARE_STATES.NO_URL);
});

test("the product match ignores the words every page carries", () => {
  assert.deepEqual(nameTokens("Acme Widget Plugin"), ["acme", "widget"]);
  assert.deepEqual(nameTokens("free plugin sale"), []);
  assert.equal(pageMentionsProduct("<h1>Acme Widget</h1>", "Acme Widget"), true);
  assert.equal(pageMentionsProduct("<h1>Something else</h1>", "Acme Widget"), false);
});

test("JSON-LD offers are read through @graph and arrays", () => {
  const html = `<script type="application/ld+json">
    {"@graph":[{"@type":"WebSite"},{"@type":"Product","offers":[{"price":"19.00","priceCurrency":"EUR"}]}]}
  </script>`;

  assert.deepEqual(extractJsonLdOffer(html), {
    price: 19,
    currency: "EUR",
    priceValidUntil: null
  });
  assert.equal(extractJsonLdOffer("<html></html>"), null);
});

test("the summary counts every state", () => {
  const summary = summarise([
    { state: PREPARE_STATES.VERIFIED },
    { state: PREPARE_STATES.VERIFIED },
    { state: PREPARE_STATES.OFF_TOPIC },
    { state: PREPARE_STATES.NO_URL }
  ]);
  assert.equal(summary.total, 4);
  assert.equal(summary.verified, 2);
  assert.equal(summary["off-topic"], 1);
  assert.equal(summary.unreachable, 0);
});
