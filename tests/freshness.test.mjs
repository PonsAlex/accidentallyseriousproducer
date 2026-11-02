import test from "node:test";
import assert from "node:assert/strict";
import { MISMATCH_KINDS, checkLedgerFreshness } from "../scripts/freshness.mjs";

function row(overrides = {}) {
  return {
    recordId: "acme-widget",
    blockId: "product-review-acme-widget",
    status: "Free",
    startsAtDate: null,
    endsAtDate: null,
    ...overrides
  };
}

test("an ended offer is not a finding, because the build handles it", () => {
  const report = checkLedgerFreshness(
    [row({ status: "Last Chance", endsAtDate: "2026-10-31" })],
    new Date("2026-11-02T12:00:00Z")
  );

  assert.deepEqual(report.findings, []);
  assert.equal(report.ended, 1, "still counted, so it is visible");
});

test("an offer that opened while its Status says Breaking is a finding", () => {
  const report = checkLedgerFreshness(
    [row({ status: "Breaking", startsAtDate: "2026-11-27", endsAtDate: "2026-12-06" })],
    new Date("2026-11-28T12:00:00Z")
  );

  assert.equal(report.findings.length, 1);
  assert.equal(report.findings[0].kind, MISMATCH_KINDS.OPENED);
  assert.match(report.findings[0].message, /opened on 2026-11-27/);
  assert.equal(report.ended, 0);
});

test("an offer that has not opened yet is left alone when the Status agrees", () => {
  const report = checkLedgerFreshness(
    [row({ status: "Breaking", startsAtDate: "2026-11-27" })],
    new Date("2026-11-02T12:00:00Z")
  );

  assert.deepEqual(report.findings, []);
});

test("a Status claiming it is coming, after it opened, is the same finding", () => {
  const report = checkLedgerFreshness(
    [row({ status: "Breaking", startsAtDate: "2026-11-27" })],
    new Date("2026-11-28T12:00:00Z")
  );

  assert.equal(report.findings[0].kind, MISMATCH_KINDS.OPENED);
});

test("an offer with no dates never produces a finding", () => {
  const report = checkLedgerFreshness(
    [row({ status: "Breaking" }), row({ recordId: "other", status: "Free" })],
    new Date("2026-11-02T12:00:00Z")
  );

  assert.deepEqual(report.findings, []);
  assert.equal(report.ended, 0);
});

test("permanent freeware stays quiet forever", () => {
  const report = checkLedgerFreshness(
    [row({ status: "Free" })],
    new Date("2030-01-01T12:00:00Z")
  );

  assert.deepEqual(report.findings, []);
  assert.equal(report.ended, 0);
});
