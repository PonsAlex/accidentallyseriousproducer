import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCandidate,
  dedupeCandidates,
  extractVendorUrl,
  isTrackingUrl,
  parseReceivedAt,
  selectLeads,
  senderDomain,
  slug,
  urlsFrom
} from "../scripts/email-candidates.mjs";

function email(overrides = {}) {
  return {
    message_id: "<abc@smtp.example>",
    received_at: "quinta-feira, 22 de outubro de 2026 13:33:06",
    from_name: "Acme Audio",
    from_email: "noreply_at_acmeaudio.com_alexpons@duck.com",
    subject: "Acme Widget is 70% off",
    preview: "Get the widget.",
    body_text: "Get the widget.",
    links: [
      "https://duckduckgo.com/email/report#abc",
      "https://acmeaudio.com/widget",
      "https://acmeaudio.com/"
    ],
    detected_developer: "Acme Audio",
    detected_plugin: "Acme Widget",
    detected_price: "",
    detected_discount: "70% OFF",
    detected_deadline: "",
    relevance: "high",
    ...overrides
  };
}

test("the feed stores links as an array, and the adapter reads both shapes", () => {
  assert.deepEqual(urlsFrom({ links: ["https://a.test/x", "https://a.test/x"] }), [
    "https://a.test/x"
  ]);
  assert.deepEqual(urlsFrom({ links: "https://a.test/x https://b.test/y" }), [
    "https://a.test/x",
    "https://b.test/y"
  ]);
  assert.deepEqual(urlsFrom({ links: null }), []);
});

test("tracking and reporting hosts are not destinations", () => {
  assert.equal(isTrackingUrl("https://duckduckgo.com/email/report#x"), true);
  assert.equal(isTrackingUrl("https://d6ff534a.click.kit-mail3.com/e5u77/a"), true);
  assert.equal(isTrackingUrl("https://notifications.audio-assault.com/gp/cl/v2"), true);
  assert.equal(isTrackingUrl("https://acmeaudio.com/widget"), false);
});

test("the vendor page is the sender's own domain, deepest path first", () => {
  const url = extractVendorUrl(email());
  assert.equal(url, "https://acmeaudio.com/widget");
});

test("an email with only trackers yields no vendor page", () => {
  const url = extractVendorUrl(
    email({ links: ["https://duckduckgo.com/email/report#a", "https://x.click.kit-mail3.com/e5u/a"] })
  );
  assert.equal(url, null);
});

test("the masked sender address still names the vendor domain", () => {
  assert.equal(senderDomain("noreply_at_acmeaudio.com_x@duck.com"), "acmeaudio.com");
  assert.equal(senderDomain("promo@acmeaudio.com"), "acmeaudio.com");
  // A duck.com address alone says nothing about the vendor.
  assert.equal(senderDomain("someone@duck.com", "Acme"), null);
});

test("the feed's Portuguese dates parse", () => {
  const parsed = parseReceivedAt("quinta-feira, 22 de outubro de 2026 13:33:06");
  assert.equal(parsed.getFullYear(), 2026);
  assert.equal(parsed.getMonth(), 9);
  assert.equal(parsed.getDate(), 22);
  assert.equal(parseReceivedAt("not a date"), null);
});

test("a lead is a candidate in the bridge's own shape, with no evidence", () => {
  const candidate = buildCandidate(email(), { vendorUrl: "https://acmeaudio.com/widget" });

  assert.equal(candidate.schemaVersion, "1.0");
  assert.equal(candidate.status, "candidate");
  assert.equal(candidate.requiresReview, true);
  // "70% OFF" is a paying offer with a discount, not a freebie.
  assert.equal(candidate.offerNature, "paid-promo");
  assert.equal(candidate.offer.discountPercent, 70);
  assert.equal(candidate.links.sourceUrl, "https://acmeaudio.com/widget");
  // The boundary: an email is not a citable source.
  assert.deepEqual(candidate.evidence, []);
  assert.equal(candidate.primarySourceFound, false);
  assert.equal(candidate.product.whatItIs, null, "the email is not a description");
  assert.equal(candidate.confidence.price, "low");
});

test("the candidateId is safe for the schema even when the subject is long", () => {
  const candidate = buildCandidate(
    email({ detected_plugin: "x".repeat(200), subject: "y".repeat(200) }),
    {}
  );
  assert.match(candidate.candidateId, /^[a-z0-9]+(-[a-z0-9]+)*$/);
  assert.equal(candidate.candidateId.length <= 60, true);
});

test("a deadline becomes endsAtDate, and nothing else is invented", () => {
  const candidate = buildCandidate(
    email({ detected_deadline: "18 de outubro de 2026", detected_discount: "Free" }),
    {}
  );
  assert.equal(candidate.offer.endsAtDate, "2026-10-18");
  assert.equal(candidate.offer.dateOnly, true);
  assert.equal(candidate.offer.startsAt, null);
  assert.equal(candidate.offer.permanent, null);
});

test("leads skip the low-relevance mail and anything with no price claim", () => {
  const items = [
    email({ relevance: "low" }),
    email({ relevance: "high", detected_discount: "", detected_price: "" }),
    email({ relevance: "high", detected_discount: "30%", message_id: "<keep@x>" })
  ];

  const leads = selectLeads(items, { days: 14, now: new Date("2026-10-22T12:00:00") });
  assert.equal(leads.length, 1);
  assert.equal(leads[0].message_id, "<keep@x>");
});

test("leads older than the window are left behind", () => {
  const old = email({
    received_at: "quinta-feira, 1 de outubro de 2026 09:00:00",
    message_id: "<old@x>"
  });
  const recent = email({ message_id: "<new@x>" });

  const leads = selectLeads([old, recent], { days: 7, now: new Date("2026-10-22T12:00:00") });
  assert.deepEqual(
    leads.map((item) => item.message_id),
    ["<new@x>"]
  );
});

test("the same announcement from three senders becomes one candidate", () => {
  const base = email({ detected_plugin: "Acme Widget", detected_developer: "Acme Audio" });
  const older = { ...buildCandidate(base, {}), source: { ...buildCandidate(base, {}).source, receivedAt: "2026-10-01T10:00:00Z" } };
  const newer = { ...buildCandidate(base, {}), source: { ...buildCandidate(base, {}).source, receivedAt: "2026-10-20T10:00:00Z" } };
  const other = { ...buildCandidate(email({ detected_plugin: "Other Thing", detected_developer: "Other" }), {}) };

  const deduped = dedupeCandidates([older, newer, other]);

  assert.equal(deduped.length, 2);
  const acme = deduped.find((candidate) => candidate.candidateId === "acme-audio-acme-widget");
  assert.ok(acme, "one row for the repeated product");
  // The newest email wins, because it is the most current wording.
  assert.equal(acme.source.receivedAt, "2026-10-20T10:00:00Z");
});

test("a lead with no deadline declares the gap instead of claiming one", () => {
  const withoutDeadline = buildCandidate(email({ detected_deadline: "" }), {});
  assert.deepEqual(withoutDeadline.missingFacts, ["endsAt", "endsAtDate"]);
  // The email's own price is a hint: it rarely carries a currency.
  assert.equal(withoutDeadline.offer.promoPrice, null);
  assert.equal(withoutDeadline.lead.detectedPrice, null);

  const withDeadline = buildCandidate(email({ detected_deadline: "18 de outubro de 2026" }), {});
  assert.equal(withDeadline.offer.endsAtDate, "2026-10-18");
  assert.deepEqual(withDeadline.missingFacts, []);
});

test("slug never returns a leading or trailing hyphen", () => {
  assert.equal(slug("-- Acme: Widget! --"), "acme-widget");
  assert.equal(slug(""), "");
});
