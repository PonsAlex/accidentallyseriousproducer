import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validatePromotionCandidate } from "../scripts/candidate-validation.mjs";

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const example = JSON.parse(
  await readFile(path.join(rootDirectory, "data", "inbox", "promotion-candidate.example.json"), "utf8")
);

function candidate(mutate = () => {}) {
  const clone = JSON.parse(JSON.stringify(example));
  mutate(clone);
  return clone;
}

function warnings(report) {
  return report.warnings.map((issue) => issue.code);
}

test("the anonymized example carries no currency warning", () => {
  const report = validatePromotionCandidate(example);
  assert.deepEqual(report.errors, []);
  assert.equal(warnings(report).includes("CANDIDATE_PRICE_WITHOUT_CURRENCY"), false);
  assert.equal(warnings(report).includes("CANDIDATE_CURRENCY_WITHOUT_PRICE"), false);
});

test("a free offer does not demand a currency", () => {
  // `promoPrice: 0` is how a free offer is expressed. Zero is not a monetary
  // amount, so demanding "USD 0" would ask for a fact that states nothing.
  const report = validatePromotionCandidate(
    candidate((c) => {
      c.offer.promoPrice = 0;
      c.offer.regularPrice = null;
      c.offer.currency = null;
    })
  );
  assert.equal(warnings(report).includes("CANDIDATE_PRICE_WITHOUT_CURRENCY"), false);
});

test("a non-zero amount demands a currency", () => {
  const report = validatePromotionCandidate(
    candidate((c) => {
      c.offer.promoPrice = 19;
      c.offer.currency = null;
    })
  );
  assert.ok(warnings(report).includes("CANDIDATE_PRICE_WITHOUT_CURRENCY"));
});

test("a non-zero regular price alone also demands a currency", () => {
  const report = validatePromotionCandidate(
    candidate((c) => {
      c.offer.promoPrice = null;
      c.offer.regularPrice = 149;
      c.offer.currency = null;
    })
  );
  assert.ok(warnings(report).includes("CANDIDATE_PRICE_WITHOUT_CURRENCY"));
});

test("a malformed currency is reported when an amount exists", () => {
  const report = validatePromotionCandidate(
    candidate((c) => {
      c.offer.promoPrice = 19;
      c.offer.currency = "usd";
    })
  );
  assert.ok(warnings(report).includes("CANDIDATE_PRICE_WITHOUT_CURRENCY"));
});

test("a currency with no non-zero amount is reported", () => {
  const report = validatePromotionCandidate(
    candidate((c) => {
      c.offer.promoPrice = 0;
      c.offer.regularPrice = null;
      c.offer.currency = "USD";
    })
  );
  assert.ok(warnings(report).includes("CANDIDATE_CURRENCY_WITHOUT_PRICE"));
});
