import test from "node:test";
import assert from "node:assert/strict";
import {
  expiredRecords,
  patchArticleHtml,
  patchSection
} from "../scripts/expire-offers.mjs";

function review(overrides = {}) {
  return {
    recordId: "acme-widget",
    productName: "Acme - Widget",
    status: "Free",
    startsAtDate: null,
    endsAtDate: null,
    href: "/go/link-acme-widget",
    ...overrides
  };
}

function section({ name = "Acme - Widget", status = "Free", badge = "free", window = "Ends 31 October 2026", cta = true } = {}) {
  return `        <section class="product-review">
          <div class="verdict-badge fire">Fire</div>
          <div class="status-badge ${badge}">${status}</div>
          <h2>${name}</h2>
          <p>Copy.</p>
          <p class="offer-window">${window}</p>
          ${cta ? `<a href="/go/link-acme-widget" class="cta-button">Get it free</a>` : "<!-- Offer expired: no call to action is emitted. -->"}
        </section>`;
}

test("only offers whose end date has passed are counted as ended", () => {
  const reviews = [
    review({ recordId: "ended", endsAtDate: "2026-10-31" }),
    review({ recordId: "today", endsAtDate: "2026-11-01" }),
    review({ recordId: "future", endsAtDate: "2026-11-18" }),
    review({ recordId: "permanent" })
  ];

  const ended = expiredRecords(reviews, new Date("2026-11-01T12:00:00"));

  assert.deepEqual(ended.map((entry) => entry.recordId), ["ended"]);
});

test("an offer that ends today is still live", () => {
  const reviews = [review({ endsAtDate: "2026-11-01" })];
  assert.equal(expiredRecords(reviews, new Date("2026-11-01T23:59:00Z")).length, 0);
  assert.equal(expiredRecords(reviews, new Date("2026-11-02T00:01:00Z")).length, 1);
});

test("the phase turns over at UTC midnight, not at the reader's", () => {
  // The ledger stores calendar dates with no timezone, so the comparison is made
  // against the UTC date. For a reader in UTC-3 that is 21:00 the evening before:
  // the badge flips while their Saturday is still going.
  const reviews = [review({ endsAtDate: "2026-10-31" })];
  assert.equal(expiredRecords(reviews, new Date("2026-10-31T20:00:00-03:00")).length, 0);
  assert.equal(expiredRecords(reviews, new Date("2026-10-31T22:00:00-03:00")).length, 1);
});

test("the section loses its Status, its window and its button", () => {
  const now = new Date("2026-11-01T12:00:00");
  const patched = patchSection(section(), review({ endsAtDate: "2026-10-31" }), now);

  assert.match(patched, /<div class="status-badge expired">Offer ended<\/div>/);
  assert.match(patched, /<p class="offer-window">Ended 31 October 2026<\/p>/);
  assert.equal(patched.includes('class="cta-button"'), false);
  assert.match(patched, /<!-- Offer expired: no call to action is emitted\. -->/);
  // The Verdict is editorial and must not be touched by a calendar.
  assert.match(patched, /<div class="verdict-badge fire">Fire<\/div>/);
});

test("a live offer in the same article is left alone", () => {
  const now = new Date("2026-11-01T12:00:00");
  const html = [section({ name: "Acme - Widget" }), section({ name: "Other - Thing" })].join("\n");
  const result = patchArticleHtml(
    html,
    [
      review({ recordId: "acme", productName: "Acme - Widget", endsAtDate: "2026-10-31" }),
      review({ recordId: "other", productName: "Other - Thing", endsAtDate: "2026-11-18" })
    ],
    now
  );

  assert.deepEqual(result.patched, ["acme"]);
  const other = /<section[\s\S]*?Other - Thing[\s\S]*?<\/section>/.exec(result.html)[0];
  assert.match(other, /class="status-badge free">Free</);
  assert.match(other, /class="cta-button"/);
});

test("patching twice changes nothing the second time", () => {
  const now = new Date("2026-11-01T12:00:00");
  const reviews = [review({ endsAtDate: "2026-10-31" })];
  const once = patchArticleHtml(section(), reviews, now).html;
  const twice = patchArticleHtml(once, reviews, now);

  assert.equal(twice.html, once);
  assert.deepEqual(twice.patched, [], "nothing left to patch");
  assert.deepEqual(twice.already, ["acme-widget"], "reported as already correct");
});

test("an offer that never appeared in an article is not silently ignored", () => {
  const now = new Date("2026-11-01T12:00:00");
  const result = patchArticleHtml(
    section({ name: "Some - Other" }),
    [review({ recordId: "ghost", productName: "Ghost - Product", endsAtDate: "2026-10-31" })],
    now
  );

  assert.deepEqual(result.patched, []);
  // The caller decides what to do; this function simply reports nothing matched.
  assert.equal(result.html.includes("Offer ended"), false);
});

test("a product name with an ampersand still matches its escaped heading", () => {
  const now = new Date("2026-11-01T12:00:00");
  const html = section({ name: "Acme &amp; Co - Widget" });
  const result = patchArticleHtml(
    html,
    [review({ productName: "Acme & Co - Widget", endsAtDate: "2026-10-31" })],
    now
  );

  assert.deepEqual(result.patched, ["acme-widget"]);
});
