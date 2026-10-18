import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BRIDGE_REFUSAL_REASONS,
  bridgeCandidates,
  deriveFreeQualification,
  deriveLimitedBy,
  deriveOfferNature,
  normalizeCandidates
} from "../scripts/candidate-to-package.mjs";
import { validateEvidencePackage } from "../scripts/evidence-package-validation.mjs";
import { adaptEvidencePackage } from "../scripts/jev-adapt.mjs";

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXAMPLES = path.join(rootDirectory, "docs", "examples");
const CANDIDATE_FIXTURE = path.join(EXAMPLES, "odysseus-candidate.example.json");
const PACKAGE_FIXTURE = path.join(EXAMPLES, "evidence-package.example.json");

const candidates = JSON.parse(await readFile(CANDIDATE_FIXTURE, "utf8"));
const packageFixture = JSON.parse(await readFile(PACKAGE_FIXTURE, "utf8"));

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function validCandidate(mutate = () => {}) {
  const candidate = clone(candidates[0]);
  delete candidate._comment;
  mutate(candidate);
  return candidate;
}

function refusalReason(candidate) {
  const { report } = bridgeCandidates([candidate]);
  return report.refused[0]?.reason ?? null;
}

test("the example bridges the confirmed candidate and refuses the one without a citable source", () => {
  const { package: pkg, report } = bridgeCandidates(candidates);

  assert.equal(pkg.records.length, 1);
  assert.equal(pkg.records[0].recordId, "unitedplugins-firemaximizer");
  assert.deepEqual(report.refused, [
    {
      candidateId: "sonic-labs-audio-the-josie-td3",
      reason: BRIDGE_REFUSAL_REASONS.noEvidence,
      detail: report.refused[0].detail
    }
  ]);
  assert.equal(pkg.candidatesAccepted, 1);
  assert.equal(pkg.candidatesRejected, 1);
  assert.equal(pkg.rejectedSummary.length, 1);

  // Channels are vendor names, never private sender identities.
  assert.deepEqual(pkg.channelsMonitored, ["UnitedPlugins"]);
  // Scan date comes from the latest source receivedAt.
  assert.equal(pkg.scanDate, "2026-10-10");
});

test("the bridged package carries no private email metadata and no affiliate URL", () => {
  const { package: pkg, report } = bridgeCandidates(candidates);
  const serialized = JSON.stringify(pkg);

  for (const leak of ["promo@unitedplugins.invalid", "deals@freepluginwala.invalid", "opaque-message-identifier"]) {
    assert.equal(serialized.includes(leak), false, `private value leaked: ${leak}`);
  }
  assert.equal(Object.hasOwn(pkg.records[0], "source"), false);
  assert.equal(Object.hasOwn(pkg.records[0], "links"), false);
  assert.equal(Object.hasOwn(pkg.records[0], "affiliateUrl"), false);
  assert.equal(serialized.includes("affiliate/tracking-link"), false);

  // The drop is reported, never silent.
  assert.ok(report.notes.some((note) => /affiliateUrl/.test(note)));

  const validation = validateEvidencePackage(pkg);
  assert.deepEqual(validation.errors, []);
});

test("the bridge refuses rather than guessing", () => {
  assert.equal(
    refusalReason(validCandidate((c) => { c.product.category = null; })),
    BRIDGE_REFUSAL_REASONS.unknownCategory
  );
  assert.equal(
    refusalReason(validCandidate((c) => { delete c.evidence; })),
    BRIDGE_REFUSAL_REASONS.noEvidence
  );
  assert.equal(
    refusalReason(validCandidate((c) => {
      delete c.offerNature;
      c.offer.promoPrice = null;
      c.offer.endsAtDate = null;
      c.offer.dateOnly = false;
      delete c.freeQualification;
    })),
    BRIDGE_REFUSAL_REASONS.unknownOfferNature
  );
  assert.equal(
    refusalReason(validCandidate((c) => { delete c.offer.regularPriceSource; })),
    BRIDGE_REFUSAL_REASONS.missingPriceSource
  );
  assert.equal(
    refusalReason(validCandidate((c) => { c.offer.endsAt = "2026-10-18T23:59:59Z"; })),
    BRIDGE_REFUSAL_REASONS.contradictoryDate
  );
});

test("the bridge refuses a limited offer that declares no limit", () => {
  const limitedFreeWithoutLimit = validCandidate((c) => {
    c.offerNature = "limited-free";
    c.offer.promoPrice = 0;
    c.offer.permanent = false;
    c.offer.endsAt = null;
    c.offer.endsAtDate = null;
    c.offer.dateOnly = false;
    delete c.limitedBy;
    delete c.freeQualification;
  });

  // `none` here would make a time-bounded offer look unbounded.
  assert.equal(deriveLimitedBy(limitedFreeWithoutLimit, "limited-free"), null);
  assert.equal(
    refusalReason(limitedFreeWithoutLimit),
    BRIDGE_REFUSAL_REASONS.limitedFreeWithoutLimit
  );

  // Declaring the limit is enough to bridge it again.
  const withLimit = validCandidate((c) => {
    c.offerNature = "limited-free";
    c.limitedBy = "quantity";
    c.offer.endsAt = null;
    c.offer.endsAtDate = null;
    c.offer.dateOnly = false;
  });
  assert.equal(deriveLimitedBy(withLimit, "limited-free"), "quantity");
  assert.equal(refusalReason(withLimit), null);
});

test("derivations follow the extracted facts and the board vocabulary", () => {
  const permanentFree = validCandidate((c) => {
    delete c.offerNature;
    c.offer.permanent = true;
    c.offer.endsAtDate = null;
    c.offer.dateOnly = false;
    delete c.freeQualification;
    delete c.offer.couponCode;
  });
  assert.equal(deriveOfferNature(permanentFree), "permanent-free");
  assert.equal(deriveFreeQualification(permanentFree, "permanent-free"), "Free");

  const limited = validCandidate((c) => {
    delete c.offerNature;
    c.offer.promoPrice = 0;
    delete c.freeQualification;
    delete c.offer.couponCode;
  });
  assert.equal(deriveOfferNature(limited), "limited-free");
  assert.equal(deriveFreeQualification(limited, "limited-free"), "Free temporário");

  const paid = validCandidate((c) => {
    delete c.offerNature;
    c.offer.promoPrice = 39;
    c.offer.permanent = false;
    c.offer.endsAtDate = null;
    c.offer.dateOnly = false;
    c.offer.couponCode = null;
    delete c.freeQualification;
  });
  assert.equal(deriveOfferNature(paid), "paid-promo");
  assert.equal(deriveFreeQualification(paid, "paid-promo"), "Não é Free");

  // A coupon always wins the free qualification, whatever the price does.
  assert.equal(deriveFreeQualification(validCandidate(), "limited-free"), "Requer código");

  // An end date means a time limit; nothing else is asserted.
  assert.equal(deriveLimitedBy({ offer: { endsAt: "2026-10-18T23:59:59Z" } }, "limited-free"), "time");
  assert.equal(deriveLimitedBy({ offer: {} }, "permanent-free"), "none");
});

test("the bridged package flows all the way to adapted editorial records", () => {
  const { package: pkg } = bridgeCandidates(candidates);
  const { records, checklist } = adaptEvidencePackage(pkg);

  assert.equal(records.length, 1);
  const record = records[0];

  // Extraction produced facts and no copy: draftCopy is omitted entirely.
  assert.equal(Object.hasOwn(record, "draftCopy"), false);
  assert.equal(Object.hasOwn(record, "editorial"), false);
  assert.equal(record.facts.product.name, "FireMaximizer");
  assert.equal(record.facts.offer.currency, "USD");
  assert.deepEqual(record.notApplicable, []);

  const entry = checklist[0];
  assert.equal(entry.copyStatus, "missing");
  assert.equal(entry.freeQualification, "Requer código");
  assert.deepEqual(entry.sourceConfidence, { product: "high", price: "high", dates: "medium", link: "high" });
  assert.ok(
    entry.humanDecisionsRequired.some((decision) => /Write the reader-facing copy/.test(decision))
  );
});

test("copyStatus governs whether reader-facing copy is required", () => {
  const base = clone(packageFixture);

  const missingCopy = clone(base);
  missingCopy.records = [missingCopy.records[0]];
  missingCopy.candidatesAccepted = 1;
  missingCopy.records[0].copyStatus = "missing";
  delete missingCopy.records[0].readerFacingCopy;
  missingCopy.records[0].missingFacts = [...missingCopy.records[0].missingFacts, "readerFacingCopy"];

  const accepted = validateEvidencePackage(missingCopy);
  assert.deepEqual(accepted.errors, [], "facts-only records must be acceptable");

  // Copy present while declared missing is a contradiction.
  const contradictory = clone(missingCopy);
  contradictory.records[0].readerFacingCopy = { title: "x", summary: "y", body: "z" };
  assert.ok(
    validateEvidencePackage(contradictory).errors.some((issue) => issue.code === "COPY_PRESENT_WHEN_MISSING")
  );

  // An undeclared copy gap is rejected.
  const undeclared = clone(missingCopy);
  undeclared.records[0].missingFacts = undeclared.records[0].missingFacts.filter(
    (fact) => fact !== "readerFacingCopy"
  );
  assert.ok(validateEvidencePackage(undeclared).errors.some((issue) => issue.code === "UNDECLARED_COPY_GAP"));

  // An unknown status is rejected.
  const unknownStatus = clone(base);
  unknownStatus.records[0].copyStatus = "almost";
  assert.ok(validateEvidencePackage(unknownStatus).errors.some((issue) => issue.code === "INVALID_COPY_STATUS"));

  // Free qualification uses the board vocabulary only.
  const badQualification = clone(base);
  badQualification.records[0].freeQualification = "Basically free";
  assert.ok(
    validateEvidencePackage(badQualification).errors.some((issue) => issue.code === "INVALID_FREE_QUALIFICATION")
  );
});

test("an email address anywhere in a package is rejected as private material", () => {
  const base = clone(packageFixture);
  base.channelsMonitored = ["promo@unitedplugins.invalid"];
  const report = validateEvidencePackage(base);
  assert.ok(report.errors.some((issue) => issue.code === "PRIVATE_EMAIL_ADDRESS"));
});

test("normalizeCandidates accepts a single object, an array, or a wrapper", () => {
  assert.equal(normalizeCandidates({ candidateId: "a" }).length, 1);
  assert.equal(normalizeCandidates([{ candidateId: "a" }, { candidateId: "b" }]).length, 2);
  assert.equal(normalizeCandidates({ candidates: [{ candidateId: "a" }] }).length, 1);
});

async function writeTempJson(value) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "asp-bridge-"));
  const file = path.join(directory, "input.json");
  await writeFile(file, JSON.stringify(value), "utf8");
  return { directory, file };
}

test("the bridge CLI writes both artifacts and reports the refusal", async () => {
  const { directory, file } = await writeTempJson(candidates);
  const outputPath = path.join(directory, "package.json");
  const reportPath = path.join(directory, "report.json");

  const result = spawnSync(
    process.execPath,
    [
      "scripts/candidate-to-package.mjs",
      "--input", file,
      "--output", outputPath,
      "--report", reportPath
    ],
    { cwd: rootDirectory, encoding: "utf8" }
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Bridged 1 candidate\(s\), refused 1\./);
  assert.match(result.stderr, /no-citable-evidence/);

  const pkg = JSON.parse(await readFile(outputPath, "utf8"));
  assert.deepEqual(validateEvidencePackage(pkg).errors, []);
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  assert.equal(report.bridgeVersion, "1.0");
  assert.equal(report.converted.length, 1);
});

test("the bridge CLI fails with a contextual message when nothing can be bridged", async () => {
  const { file } = await writeTempJson([validCandidate((c) => { delete c.evidence; })]);
  const result = spawnSync(
    process.execPath,
    ["scripts/candidate-to-package.mjs", "--input", file],
    { cwd: rootDirectory, encoding: "utf8" }
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /No candidate could be bridged/);
  assert.match(result.stderr, /no-citable-evidence/);
});
