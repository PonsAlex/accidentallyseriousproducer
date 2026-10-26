import test from "node:test";
import assert from "node:assert/strict";
import {
  describeShare,
  nextDeadline,
  renderAuditPage,
  summariseMonth
} from "../scripts/audit-generate.mjs";

function review(overrides = {}) {
  return {
    recordId: "acme-widget",
    blockId: "product-review-acme-widget",
    publishedAt: "2026-10-17",
    verdict: "Fire",
    status: "Free",
    productName: "Acme - Widget",
    startsAtDate: null,
    endsAtDate: null,
    href: "/go/link-acme-widget",
    updatedAt: "2026-10-17T00:00:00.000Z",
    ...overrides
  };
}

const ledger = [
  review({ recordId: "a", publishedAt: "2026-10-17", verdict: "Fire" }),
  review({ recordId: "b", publishedAt: "2026-10-18", verdict: "Fire" }),
  review({ recordId: "c", publishedAt: "2026-10-19", verdict: "Stash" }),
  review({ recordId: "d", publishedAt: "2026-10-20", verdict: "Digital Furniture" }),
  review({ recordId: "e", publishedAt: "2026-10-21", verdict: "Stash", endsAtDate: "2026-11-18" }),
  review({ recordId: "f", publishedAt: "2026-10-22", verdict: "Stash", startsAtDate: "2026-11-27" }),
  review({ recordId: "old", publishedAt: "2026-09-30", verdict: "Fire" })
];

test("the audit counts only the month it is auditing", () => {
  const summary = summariseMonth(ledger, { month: "2026-10", auditDate: "2026-10-25" });
  assert.equal(summary.total, 6);
  assert.equal(summary.counts.Fire, 2);
  assert.equal(summary.counts.Stash, 3);
  assert.equal(summary.counts["Digital Furniture"], 1);
  assert.equal(summary.counts.Nah, 0);
});

test("expiry, liveness and the future are decided against the audit date", () => {
  const summary = summariseMonth(ledger, { month: "2026-10", auditDate: "2026-10-25" });
  assert.deepEqual(summary.expired.map((r) => r.recordId), []);
  assert.deepEqual(summary.live.map((r) => r.recordId), ["e"]);
  assert.deepEqual(summary.upcoming.map((r) => r.recordId), ["f"]);
  // Everything without an end date, including the one that only has a start.
  assert.equal(summary.undated.length, 5);

  // The same ledger, read a month later, reports the deadline as passed.
  const later = summariseMonth(ledger, { month: "2026-10", auditDate: "2026-11-19" });
  assert.deepEqual(later.expired.map((r) => r.recordId), ["e"]);
  assert.deepEqual(later.live, []);
});

test("a month with no reviews does not invent one", () => {
  const summary = summariseMonth(ledger, { month: "2026-11", auditDate: "2026-11-30" });
  assert.equal(summary.total, 0);
  assert.equal(summary.fireShare, 0);
  assert.equal(describeShare(summary), "No reviews this month.");
});

test("exactly half Fire is stated as half, not buried", () => {
  const summary = summariseMonth(ledger, { month: "2026-10", auditDate: "2026-10-25" });
  assert.equal(describeShare(summary), "2 of 6.");

  const half = summariseMonth(
    [
      review({ recordId: "x", verdict: "Fire" }),
      review({ recordId: "y", verdict: "Stash" })
    ],
    { month: "2026-10", auditDate: "2026-10-25" }
  );
  assert.equal(describeShare(half), "1 of 2 — half.");
});

test("the page carries every section and the numbers it computed", () => {
  const summary = summariseMonth(ledger, { month: "2026-10", auditDate: "2026-10-25" });
  const html = renderAuditPage(
    summary,
    {
      slug: "audit-outubro-26",
      date: "2026-10-25",
      title: "Plugin Audit: October 2026",
      deck: "Twelve finds.",
      opening: ["Twelve things landed."],
      defended: { a: "Worth defending." },
      demoted: { c: "Not worth it." },
      mistakes: ["The link went to a home page."],
      closing: ["Next audit next month."]
    },
    { header: "<header>h</header>", footer: "<footer>f</footer>" }
  );

  assert.match(html, /<h1>Plugin Audit: October 2026<\/h1>/);
  assert.match(html, /The month in numbers/);
  assert.match(html, /The ones we would defend/);
  assert.match(html, /The ones we put down/);
  assert.match(html, /What expired/);
  assert.match(html, /What we got wrong/);
  assert.match(html, /Worth defending\./);
  assert.match(html, /The link went to a home page\./);
  assert.match(html, /audit-outubro-26\.html/);
  assert.match(html, /<header>h<\/header>/);
});

test("the next deadline is the earliest one, not the first published", () => {
  const summary = summariseMonth(ledger, { month: "2026-10", auditDate: "2026-10-25" });
  // "e" is the only live offer in this ledger, so it is also the earliest.
  assert.equal(nextDeadline(summary).recordId, "e");

  const twoLive = summariseMonth(
    [
      review({ recordId: "late", publishedAt: "2026-10-17", endsAtDate: "2026-12-06" }),
      review({ recordId: "soon", publishedAt: "2026-10-18", endsAtDate: "2026-11-18" })
    ],
    { month: "2026-10", auditDate: "2026-10-25" }
  );
  assert.equal(nextDeadline(twoLive).recordId, "soon", "earlier date wins over earlier publication");
  assert.equal(nextDeadline(summariseMonth([], { month: "2026-10", auditDate: "2026-10-25" })), null);
});

test("the page does not let a product name inject markup", () => {
  const summary = summariseMonth(
    [review({ recordId: "x", productName: "<script>alert(1)</script>" })],
    { month: "2026-10", auditDate: "2026-10-25" }
  );
  const html = renderAuditPage(summary, {
    slug: "audit-x",
    date: "2026-10-25",
    title: "Audit",
    deck: "Deck",
    opening: [],
    defended: {},
    demoted: {},
    mistakes: [],
    closing: []
  });

  assert.equal(html.includes("<script>alert(1)</script>"), false);
  assert.match(html, /&lt;script&gt;/);
});
