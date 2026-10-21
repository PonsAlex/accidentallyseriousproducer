import test from "node:test";
import assert from "node:assert/strict";
import {
  OFFER_PHASES,
  formatOfferDate,
  offerPhase,
  offerWindowLabel,
  todayIso
} from "../scripts/offer-phase.mjs";
import {
  MISMATCH_KINDS,
  checkFreshness,
  detectMismatch,
  formatFreshnessReport,
  parseArgs
} from "../scripts/freshness.mjs";

const at = (date) => new Date(`${date}T12:00:00Z`);

test("an offer with no dates has no phase at all", () => {
  assert.equal(offerPhase({}, at("2026-10-21")), null);
  assert.equal(offerPhase({ startsAtDate: null, endsAtDate: null }, at("2026-10-21")), null);
});

test("the phase follows the calendar, not the clock inside the day", () => {
  const window = { startsAtDate: "2026-11-27", endsAtDate: "2026-12-06" };

  assert.equal(offerPhase(window, at("2026-11-26")), OFFER_PHASES.UPCOMING);
  assert.equal(offerPhase(window, at("2026-11-27")), OFFER_PHASES.LIVE, "opens on its start day");
  assert.equal(offerPhase(window, at("2026-12-06")), OFFER_PHASES.LIVE, "still open on its last day");
  assert.equal(offerPhase(window, at("2026-12-07")), OFFER_PHASES.ENDED);
});

test("an open-ended offer is live from its start and never ends", () => {
  assert.equal(offerPhase({ startsAtDate: "2026-10-01" }, at("2027-01-01")), OFFER_PHASES.LIVE);
  assert.equal(offerPhase({ endsAtDate: "2026-10-01" }, at("2026-09-01")), OFFER_PHASES.LIVE);
});

test("dates format in UTC so a machine timezone cannot shift the day", () => {
  assert.equal(formatOfferDate("2026-11-27"), "27 November 2026");
  assert.equal(formatOfferDate("2026-12-06"), "6 December 2026");
});

test("the label says what the reader needs for that phase", () => {
  const window = { startsAtDate: "2026-11-27", endsAtDate: "2026-12-06" };

  assert.equal(offerWindowLabel(window, at("2026-10-21")), "Opens 27 November 2026");
  assert.equal(offerWindowLabel(window, at("2026-11-30")), "Ends 6 December 2026");
  assert.equal(offerWindowLabel(window, at("2026-12-10")), "Ended 6 December 2026");
});

test("a live offer with no deadline shows no line", () => {
  assert.equal(offerWindowLabel({ startsAtDate: "2026-10-01" }, at("2026-10-21")), null);
  assert.equal(offerWindowLabel({}, at("2026-10-21")), null);
});

test("todayIso is the UTC calendar day", () => {
  assert.equal(todayIso(new Date("2026-10-21T23:30:00Z")), "2026-10-21");
  assert.equal(todayIso(new Date("2026-10-21T23:30:00-03:00")), "2026-10-22");
});

function review({ status = "Free", startsAtDate = null, endsAtDate = null, id = "product-review-x" } = {}) {
  return {
    id,
    type: "product-review",
    content: { startsAtDate, endsAtDate, reviewLabel: status },
    metadata: {}
  };
}

test("an offer that opened while the page still says Breaking is reported", () => {
  const block = review({ status: "Breaking", startsAtDate: "2026-11-27", endsAtDate: "2026-12-06" });
  const mismatch = detectMismatch(block, at("2026-11-28"));

  assert.equal(mismatch.kind, MISMATCH_KINDS.OPENED);
  assert.match(mismatch.message, /opened on 2026-11-27/);
});

test("an offer that ended while the page still says Free is reported", () => {
  const block = review({ status: "Free", endsAtDate: "2026-11-18" });
  const mismatch = detectMismatch(block, at("2026-11-19"));

  assert.equal(mismatch.kind, MISMATCH_KINDS.ENDED);
  assert.match(mismatch.message, /ended on 2026-11-18/);
});

test("Free on something that has not opened yet is reported", () => {
  const block = review({ status: "Free", startsAtDate: "2026-11-27" });
  const mismatch = detectMismatch(block, at("2026-10-21"));

  assert.equal(mismatch.kind, MISMATCH_KINDS.NOT_YET_LIVE);
  assert.match(mismatch.message, /only opens on 2026-11-27/);
});

test("agreement, missing dates and a missing status all stay quiet", () => {
  assert.equal(detectMismatch(review({ status: "Free", endsAtDate: "2026-12-06" }), at("2026-10-21")), null);
  assert.equal(detectMismatch(review({ status: "Free" }), at("2026-10-21")), null);
  assert.equal(
    detectMismatch(review({ status: "", endsAtDate: "2026-11-18" }), at("2026-12-01")),
    null
  );
});

test("the status falls back to editorialStatus when no review label is set", () => {
  const block = {
    id: "product-review-x",
    type: "product-review",
    content: { endsAtDate: "2026-11-18" },
    metadata: { editorialStatus: "Last Chance" }
  };
  assert.equal(detectMismatch(block, at("2026-12-01")).kind, MISMATCH_KINDS.ENDED);
});

test("the freshness check ignores everything that is not a product review", () => {
  const state = {
    blocks: [
      { id: "home-hero", type: "hero", content: {}, metadata: {} },
      review({ id: "product-review-a", status: "Free", endsAtDate: "2026-11-18" })
    ]
  };
  const report = checkFreshness(state, at("2026-12-01"));

  assert.equal(report.findings.length, 1);
  assert.equal(report.findings[0].blockId, "product-review-a");
  assert.equal(report.today, "2026-12-01");
});

test("the report reads as a list of things to look at", () => {
  const clean = formatFreshnessReport({ today: "2026-10-21", findings: [] });
  assert.match(clean, /Nenhuma divergência em 2026-10-21/);

  const dirty = formatFreshnessReport({
    today: "2026-11-28",
    findings: [
      {
        blockId: "product-review-air",
        status: "Breaking",
        kind: MISMATCH_KINDS.OPENED,
        message: 'Status "Breaking" but the offer opened on 2026-11-27.'
      }
    ]
  });
  assert.match(dirty, /1 bloco\(s\)/);
  assert.match(dirty, /product-review-air/);
  assert.match(dirty, /opened on 2026-11-27/);
});

test("freshness arguments are validated rather than guessed", () => {
  assert.equal(parseArgs(["--state", "s.json"]).fail, false);
  assert.equal(parseArgs(["--state", "s.json", "--fail"]).fail, true);
  assert.equal(parseArgs(["--state", "s.json", "--now", "2027-01-01"]).now, "2027-01-01");
  assert.throws(() => parseArgs(["--state", "s.json", "--now", "tomorrow"]), /YYYY-MM-DD/);
  assert.throws(() => parseArgs(["--state"]), /requires a path/);
  assert.throws(() => parseArgs(["--bogus"]), /Unrecognized argument/);
});
