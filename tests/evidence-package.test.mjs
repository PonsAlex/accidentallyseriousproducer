import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  formatEvidencePackageReport,
  validateEvidencePackage
} from "../scripts/evidence-package-validation.mjs";
import { adaptEvidencePackage, renderChecklistMarkdown } from "../scripts/jev-adapt.mjs";
import { missingRecordValues, validateEditorialInputRecord } from "../scripts/content-fill.mjs";

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = path.join(rootDirectory, "docs", "examples", "evidence-package.example.json");

const fixture = JSON.parse(await readFile(FIXTURE, "utf8"));

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function makePackage(mutate = () => {}) {
  const pkg = clone(fixture);
  mutate(pkg);
  return pkg;
}

function makePackageWithRecord(mutate = () => {}) {
  return makePackage((pkg) => {
    pkg.records = [pkg.records[0]];
    pkg.candidatesAccepted = 1;
    mutate(pkg.records[0], pkg);
  });
}

function codes(report, collection = "errors") {
  return report[collection].map((issue) => issue.code);
}

test("the canonical example package validates cleanly", () => {
  const report = validateEvidencePackage(fixture);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.warnings, []);
  assert.match(formatEvidencePackageReport(report), /Pacote de evidências válido/);
});

test("a redaction marker is rejected wherever it appears", () => {
  const report = validateEvidencePackage(
    makePackageWithRecord((record) => {
      record.acquisitionUrl = "[suspicious link removed]";
    })
  );
  assert.ok(codes(report).includes("REDACTED_URL"));
  assert.ok(codes(report).includes("UNSAFE_URL"));

  const inNestedEvidence = validateEvidencePackage(
    makePackageWithRecord((record) => {
      record.evidence[0].url = "[suspicious link removed]";
    })
  );
  assert.ok(codes(inNestedEvidence).includes("REDACTED_URL"));
});

test("a date-only source must not grow an invented timestamp", () => {
  const report = validateEvidencePackage(
    makePackageWithRecord((record) => {
      record.offer.endsAt = "2026-10-18T23:59:59Z";
      record.offer.endsAtDate = "2026-10-18";
      record.offer.dateOnly = true;
    })
  );
  assert.ok(codes(report).includes("FABRICATED_TIMESTAMP"));
});

test("currency is required for a non-zero amount and rejected without one", () => {
  const missing = validateEvidencePackage(
    makePackageWithRecord((record) => {
      record.offer.currency = null;
    })
  );
  assert.ok(codes(missing).includes("MISSING_CURRENCY"));

  // `promoPrice: 0` plus no regular price carries no monetary amount at all.
  const gratuitous = validateEvidencePackage(
    makePackageWithRecord((record) => {
      record.offer.regularPrice = null;
      record.offer.regularPriceSource = null;
      record.offer.currency = "USD";
    })
  );
  assert.ok(codes(gratuitous).includes("CURRENCY_WITHOUT_PRICE"));

  const zeroIsNotAnAmount = validateEvidencePackage(
    makePackageWithRecord((record) => {
      record.offer.regularPrice = null;
      record.offer.regularPriceSource = null;
      record.offer.currency = null;
    })
  );
  assert.equal(codes(zeroIsNotAnAmount).includes("MISSING_CURRENCY"), false);
});

test("a regular price must name its source", () => {
  const report = validateEvidencePackage(
    makePackageWithRecord((record) => {
      record.offer.regularPriceSource = null;
    })
  );
  assert.ok(codes(report).includes("MISSING_PRICE_SOURCE"));
});

test("a permanently free offer cannot carry a historical price as its regular price", () => {
  // "$59, now free" on permanent freeware is a discount nobody can claim: there
  // is no current list price to discount from.
  const report = validateEvidencePackage(
    makePackageWithRecord((record) => {
      record.offerNature = "permanent-free";
      record.limitedBy = "none";
      record.missingFacts = [];
      record.offer.permanent = true;
      record.offer.endsAtDate = null;
      record.offer.dateOnly = false;
      record.offer.regularPrice = 59;
      record.offer.currency = "USD";
      record.offer.regularPriceSource =
        "Historical commercial retail price prior to permanent freeware conversion";
    })
  );

  assert.ok(codes(report).includes("PERMANENT_FREE_WITH_REGULAR_PRICE"));
});

test("a limited free offer may still name the price it is discounted from", () => {
  // The canonical fixture is exactly this shape: a timed freebie off a paid list
  // price, where the "was" price is real and current.
  const report = validateEvidencePackage(clone(fixture));

  assert.equal(codes(report).includes("PERMANENT_FREE_WITH_REGULAR_PRICE"), false);
  assert.equal(fixture.records[0].offerNature, "limited-free");
  assert.ok(fixture.records[0].offer.regularPrice > 0);
});

test("a fact cannot be both missing and not applicable", () => {
  const report = validateEvidencePackage(
    makePackageWithRecord((record) => {
      record.missingFacts = ["regularPrice"];
      record.notApplicable = ["regularPrice", "endsAt"];
    })
  );
  assert.ok(codes(report).includes("FACT_IN_BOTH_LISTS"));
});

test("a creator coupon that is not cleared for publication must stay out of the copy", () => {
  const leaked = validateEvidencePackage(
    makePackageWithRecord((record) => {
      record.readerFacingCopy.body = `${record.readerFacingCopy.body} Use SiyuFMX100 at checkout.`;
    })
  );
  assert.ok(codes(leaked).includes("COUPON_LEAKED_INTO_COPY"));

  const cleared = validateEvidencePackage(
    makePackageWithRecord((record) => {
      record.offer.couponPublishable = true;
      record.readerFacingCopy.body = `${record.readerFacingCopy.body} Use SiyuFMX100 at checkout.`;
    })
  );
  assert.equal(codes(cleared).includes("COUPON_LEAKED_INTO_COPY"), false);
});

test("a creator-affiliated coupon must name its owner", () => {
  const report = validateEvidencePackage(
    makePackageWithRecord((record) => {
      record.offer.couponOwner = null;
    })
  );
  assert.ok(codes(report).includes("MISSING_COUPON_OWNER"));
});

test("editorial authority fields are rejected anywhere in a record", () => {
  for (const [key, value] of [
    ["verdict", "confirmed"],
    ["editorialStatus", "VALIDATED"],
    ["editorialStage", "SELECTION"],
    ["validation", "validated"],
    ["publication", "ready"],
    ["selection", "urgent"]
  ]) {
    const report = validateEvidencePackage(
      makePackageWithRecord((record) => {
        record[key] = value;
      })
    );
    assert.ok(
      codes(report).includes("EDITORIAL_AUTHORITY_LEAK"),
      `expected ${key} to be rejected as an authority leak`
    );
  }

  // The original failure shape: nested under an editorialMetadata key.
  const nested = validateEvidencePackage(
    makePackageWithRecord((record) => {
      record.editorialMetadata = { verdict: "confirmed", validation: "validated" };
    })
  );
  assert.equal(codes(nested).filter((code) => code === "EDITORIAL_AUTHORITY_LEAK").length, 2);
});

test("the envelope must list channels and report a real accepted count", () => {
  const countedChannels = validateEvidencePackage(
    makePackage((pkg) => {
      pkg.channelsMonitored = 46;
    })
  );
  assert.ok(codes(countedChannels).includes("INVALID_CHANNELS"));

  const mismatched = validateEvidencePackage(
    makePackage((pkg) => {
      pkg.candidatesAccepted = 99;
    })
  );
  assert.ok(codes(mismatched).includes("ACCEPTED_COUNT_MISMATCH"));

  const zeroRejected = validateEvidencePackage(
    makePackage((pkg) => {
      pkg.candidatesRejected = 0;
      pkg.rejectedSummary = [];
    })
  );
  assert.ok(codes(zeroRejected, "warnings").includes("UNVERIFIED_REJECTED_COUNT"));
  assert.deepEqual(zeroRejected.errors, []);
});

test("primary source presence is declared and must match the evidence list", () => {
  const missingFlag = validateEvidencePackage(
    makePackageWithRecord((record) => {
      delete record.primarySourceFound;
    })
  );
  assert.ok(codes(missingFlag).includes("MISSING_PRIMARY_SOURCE_FLAG"));

  const declaredButAbsent = validateEvidencePackage(
    makePackageWithRecord((record) => {
      record.primarySourceFound = true;
      record.evidence = record.evidence.map((entry) => ({ ...entry, role: "secondary" }));
    })
  );
  assert.ok(codes(declaredButAbsent).includes("PRIMARY_SOURCE_MISMATCH"));

  const undeclaredButPresent = validateEvidencePackage(
    makePackageWithRecord((record) => {
      record.primarySourceFound = false;
    })
  );
  assert.ok(codes(undeclaredButPresent).includes("PRIMARY_SOURCE_MISMATCH"));
});

test("permanent offers cannot carry an end date and time limits must declare one", () => {
  const permanentWithEnd = validateEvidencePackage(
    makePackageWithRecord((record) => {
      record.offer.permanent = true;
      record.offer.endsAtDate = "2026-10-18";
    })
  );
  assert.ok(codes(permanentWithEnd).includes("PERMANENT_WITH_END"));

  const timeLimitWithoutEnd = validateEvidencePackage(
    makePackageWithRecord((record) => {
      record.offer.endsAtDate = null;
      record.offer.dateOnly = false;
      record.missingFacts = ["endsAt"];
      // duplicated deliberately: remove the declaration to trigger the rule
      record.missingFacts = [];
    })
  );
  assert.ok(codes(timeLimitWithoutEnd).includes("TIME_LIMIT_WITHOUT_END"));
});

test("duplicate record IDs and duplicated question/action text are reported", () => {
  const duplicatedIds = validateEvidencePackage(
    makePackage((pkg) => {
      pkg.records[1].recordId = pkg.records[0].recordId;
    })
  );
  assert.ok(codes(duplicatedIds).includes("DUPLICATE_RECORD_ID"));

  const duplicatedText = validateEvidencePackage(
    makePackageWithRecord((record) => {
      record.toValidate = [...record.openQuestions];
    })
  );
  assert.ok(codes(duplicatedText, "warnings").includes("DUPLICATE_QUESTION_AND_ACTION"));
});

test("an incomplete package is rejected before anything is read from it", () => {
  assert.equal(validateEvidencePackage(null).errors[0].code, "INVALID_PACKAGE");
  assert.ok(codes(validateEvidencePackage({ packageVersion: "2.0" })).includes("UNSUPPORTED_PACKAGE_VERSION"));
  assert.ok(
    codes(validateEvidencePackage({ packageVersion: "1.0", scanDate: "2026-02-30", records: [] })).includes(
      "INVALID_SCAN_DATE"
    )
  );
});

test("the adapter emits records that satisfy the editorial input contract", () => {
  const { records } = adaptEvidencePackage(fixture);
  assert.equal(records.length, fixture.records.length);

  for (const record of records) {
    const report = validateEditorialInputRecord(record, {
      knownPromotionIds: new Map([["promo-acustica-sep26", {}], ["promo-dawjunkie-sep26", {}]])
    });
    assert.deepEqual(report.errors, [], `record ${record.recordId} must satisfy the fill contract`);
  }
});

test("the adapter copies supplied values and decides nothing editorial", () => {
  const { records } = adaptEvidencePackage(fixture);
  const first = records[0];

  assert.equal(first.inputVersion, "1.0");
  assert.equal(first.type, "product-review");
  assert.equal(first.draftCopy.title, fixture.records[0].readerFacingCopy.title);
  assert.equal(first.draftCopy.body, fixture.records[0].readerFacingCopy.body);

  // Nothing invented, nothing decided.
  assert.equal(Object.hasOwn(first, "editorial"), false);
  assert.equal(Object.hasOwn(first, "evidence"), false);
  assert.equal(Object.hasOwn(first.draftCopy, "href"), false);
  assert.equal(Object.hasOwn(first.draftCopy, "verdict"), false);
  assert.equal(Object.hasOwn(first.facts.offer, "promotionId"), false);
  assert.deepEqual(first.facts.sources, [
    "https://example.invalid/unitedplugins/firemaximizer",
    "https://example.invalid/youtube/greg-kocis-firemaximizer"
  ]);
});

test("the adapter carries a date-only deadline instead of dropping it", () => {
  const { records } = adaptEvidencePackage(fixture);

  // Regression: endsAtDate used to be dropped, which lost the deadline and then
  // made the fill report a gap that did not exist.
  const firemaximizer = records.find((record) => record.recordId === "unitedplugins-firemaximizer");
  assert.equal(firemaximizer.facts.offer.endsAt, null);
  assert.equal(firemaximizer.facts.offer.endsAtDate, "2026-10-18");
  assert.equal(firemaximizer.facts.offer.dateOnly, true);
  assert.equal(firemaximizer.facts.offer.permanent, false);

  const pigments = records.find((record) => record.recordId === "arturia-pigments-play");
  assert.equal(pigments.facts.offer.permanent, true);
  assert.equal(pigments.facts.offer.endsAtDate, null);
});

test("the checklist blocks a record with no primary source and lists the catalog work", () => {
  const { checklist } = adaptEvidencePackage(fixture);
  const josie = checklist.find((entry) => entry.recordId === "sonic-labs-audio-the-josie-td3");

  assert.equal(josie.blocked, true);
  assert.ok(josie.blockedReasons.some((reason) => /cannot leave RADAR/.test(reason)));
  assert.equal(josie.primarySourceFound, false);
  assert.equal(josie.catalogTasks.find((task) => task.area === "data/affiliate-links.json").subject, "(no acquisition URL captured)");

  const firemaximizer = checklist.find((entry) => entry.recordId === "unitedplugins-firemaximizer");
  assert.equal(firemaximizer.blocked, false);
  assert.equal(firemaximizer.coupon.publishable, "unknown");
  assert.match(firemaximizer.coupon.decision, /NOT cleared for publication/);
  assert.equal(firemaximizer.regularPriceSource, "UnitedPlugins Official Store");

  const markdown = renderChecklistMarkdown(fixture, checklist);
  assert.match(markdown, /Nothing here is approved/);
  assert.match(markdown, /BLOCKED/);
  assert.match(markdown, /Provide the reviewed `\/go\/<linkId>` destination/);
});

test("a fact name must be one the validator actually reads", () => {
  // Free-text labels silently satisfy nothing: "expiryDate" is never compared to
  // endsAt, so the declaration would not suppress the gap it was meant to declare.
  const labels = validateEvidencePackage(
    makePackageWithRecord((record) => {
      record.missingFacts = ["official URL", "expiryDate"];
    })
  );
  assert.equal(codes(labels, "warnings").filter((code) => code === "UNKNOWN_FACT_NAME").length, 2);

  const fieldNames = validateEvidencePackage(
    makePackageWithRecord((record) => {
      record.missingFacts = ["developerOfficialUrl", "endsAt"];
    })
  );
  assert.equal(codes(fieldNames, "warnings").includes("UNKNOWN_FACT_NAME"), false);

  // notApplicable is checked the same way.
  const notApplicableLabel = validateEvidencePackage(
    makePackageWithRecord((record) => {
      record.notApplicable = ["no deadline"];
      record.missingFacts = [];
    })
  );
  assert.ok(codes(notApplicableLabel, "warnings").includes("UNKNOWN_FACT_NAME"));
});

test("an unknown fact name does not suppress the gap it was meant to declare", () => {
  // The point of the warning: "expiryDate" reads as a declaration to a human, but
  // TIME_LIMIT_WITHOUT_END still fires because endsAt is what the rule checks.
  const report = validateEvidencePackage(
    makePackageWithRecord((record) => {
      record.offerNature = "paid-promo";
      record.limitedBy = "time";
      record.offer.endsAt = null;
      record.offer.endsAtDate = null;
      record.offer.dateOnly = false;
      record.offer.permanent = false;
      record.missingFacts = ["expiryDate"];
      record.notApplicable = [];
    })
  );
  assert.ok(codes(report).includes("TIME_LIMIT_WITHOUT_END"));
  assert.ok(codes(report, "warnings").includes("UNKNOWN_FACT_NAME"));

  const withFieldName = validateEvidencePackage(
    makePackageWithRecord((record) => {
      record.offerNature = "paid-promo";
      record.limitedBy = "time";
      record.offer.endsAt = null;
      record.offer.endsAtDate = null;
      record.offer.dateOnly = false;
      record.offer.permanent = false;
      record.missingFacts = ["endsAt"];
      record.notApplicable = [];
    })
  );
  assert.equal(codes(withFieldName).includes("TIME_LIMIT_WITHOUT_END"), false);
});

test("the offer nature must agree with the declared limit", () => {
  // A time-bounded offer recorded as having no limit would look unbounded, and
  // the Status logic would have no deadline to work from.
  const limitedFreeWithoutLimit = validateEvidencePackage(
    makePackageWithRecord((record) => {
      record.offerNature = "limited-free";
      record.limitedBy = "none";
      record.offer.permanent = false;
      record.offer.endsAt = null;
      record.offer.endsAtDate = null;
      record.offer.dateOnly = false;
      record.missingFacts = [];
      record.notApplicable = [];
    })
  );
  assert.ok(codes(limitedFreeWithoutLimit).includes("LIMITED_FREE_WITHOUT_LIMIT"));

  // The inverse: a permanent offer cannot be limited.
  const permanentWithLimit = validateEvidencePackage(
    makePackageWithRecord((record) => {
      record.offerNature = "permanent-free";
      record.offer.permanent = true;
      record.limitedBy = "catalog";
      record.offer.endsAt = null;
      record.offer.endsAtDate = null;
      record.missingFacts = [];
    })
  );
  assert.ok(codes(permanentWithLimit).includes("PERMANENT_FREE_WITH_LIMIT"));

  // The canonical shapes stay clean.
  const consistent = validateEvidencePackage(
    makePackageWithRecord((record) => {
      record.offerNature = "limited-free";
      record.limitedBy = "time";
      record.offer.endsAtDate = "2026-10-18";
      record.offer.dateOnly = true;
    })
  );
  assert.equal(codes(consistent).includes("LIMITED_FREE_WITHOUT_LIMIT"), false);
  assert.deepEqual(consistent.errors, []);
});

test("copyStatus and category consistency are enforced", () => {
  const missingCopyStatus = validateEvidencePackage(
    makePackageWithRecord((record) => {
      delete record.copyStatus;
    })
  );
  assert.ok(codes(missingCopyStatus).includes("INVALID_COPY_STATUS"));

  const mismatchedCategory = validateEvidencePackage(
    makePackageWithRecord((record) => {
      record.productKind = "bundle";
    })
  );
  assert.ok(codes(mismatchedCategory).includes("CATEGORY_KIND_MISMATCH"));

  const matchingCategory = validateEvidencePackage(
    makePackageWithRecord((record) => {
      record.productKind = "bundle";
      record.product.category = "bundle";
    })
  );
  assert.equal(codes(matchingCategory).includes("CATEGORY_KIND_MISMATCH"), false);
});

test("a dateOnly flag with no deadline is a warning, not a false error", () => {
  // A permanent freeware has no end date by design, so dateOnly is meaningless
  // rather than a fabricated fact. The real risk — a time-limited offer with no
  // deadline — is covered by TIME_LIMIT_WITHOUT_END.
  const report = validateEvidencePackage(
    makePackageWithRecord((record) => {
      record.offer.dateOnly = true;
      record.offer.endsAtDate = null;
      record.offer.endsAt = null;
      record.offer.permanent = true;
      record.offerNature = "permanent-free";
      record.limitedBy = "none";
      record.missingFacts = [];
      // A permanent freeware has no list price either; keeping the fixture's $137
      // would make this record invalid for an unrelated reason.
      record.offer.regularPrice = null;
      record.offer.regularPriceSource = null;
      record.offer.currency = null;
      record.notApplicable = ["regularPrice", "currency", "endsAt", "endsAtDate"];
    })
  );
  assert.deepEqual(report.errors, []);
  assert.ok(codes(report, "warnings").includes("MEANINGLESS_DATE_ONLY"));
});

test("an adapted record keeps notApplicable so the fill reports only real gaps", () => {
  const { records } = adaptEvidencePackage(fixture);
  const byId = new Map(records.map((record) => [record.recordId, record]));

  // Permanent freeware: no end date by design, so no gap is reported.
  const pigments = byId.get("arturia-pigments-play");
  assert.ok(pigments.notApplicable.includes("endsAt"));
  assert.deepEqual(missingRecordValues(pigments, "product-review"), []);

  // Time-limited with only a date: the deadline is known, so it is not a gap.
  const firemaximizer = byId.get("unitedplugins-firemaximizer");
  assert.deepEqual(firemaximizer.notApplicable, []);
  assert.equal(firemaximizer.facts.offer.endsAtDate, "2026-10-18");
  assert.equal(firemaximizer.facts.offer.endsAt, null);
  assert.deepEqual(missingRecordValues(firemaximizer, "product-review"), []);

  // Quantity-limited: no time limit applies.
  const kaset = byId.get("subverselab-kaset");
  assert.ok(kaset.notApplicable.includes("endsAt"));
  assert.equal(missingRecordValues(kaset, "product-review").includes("facts.offer.endsAt"), false);
});

test("private source material and credentials are rejected", () => {
  for (const key of ["emailBody", "headers", "sender", "subject", "messageId", "accessToken", "password"]) {
    const report = validateEvidencePackage(
      makePackageWithRecord((record) => {
        record[key] = "private material";
      })
    );
    assert.ok(
      codes(report).includes("FORBIDDEN_PRIVATE_FIELD"),
      `expected ${key} to be rejected as private material`
    );
  }

  // `readerFacingCopy.body` is legitimate published copy, not an email body.
  const clean = validateEvidencePackage(fixture);
  assert.equal(codes(clean).includes("FORBIDDEN_PRIVATE_FIELD"), false);
});

test("the adapter refuses an invalid package instead of guessing", () => {
  const invalid = makePackageWithRecord((record) => {
    record.evidence[0].url = "[suspicious link removed]";
  });
  assert.throws(() => adaptEvidencePackage(invalid), /Evidence package is not valid/);
});

async function writeTempPackage(pkg) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "asp-evidence-"));
  const file = path.join(directory, "package.json");
  await writeFile(file, JSON.stringify(pkg), "utf8");
  return { directory, file };
}

test("the validation CLI accepts the canonical example and rejects a broken package", async () => {
  const ok = spawnSync(
    process.execPath,
    ["scripts/validate-evidence-package.mjs", "--input", "docs/examples/evidence-package.example.json"],
    { cwd: rootDirectory, encoding: "utf8" }
  );
  assert.equal(ok.status, 0, ok.stdout);
  assert.match(ok.stdout, /0 erro\(s\) crítico\(s\)/);

  const { file } = await writeTempPackage(
    makePackageWithRecord((record) => {
      record.verdict = "confirmed";
      record.acquisitionUrl = "[suspicious link removed]";
    })
  );
  const bad = spawnSync(
    process.execPath,
    ["scripts/validate-evidence-package.mjs", "--input", file],
    { cwd: rootDirectory, encoding: "utf8" }
  );
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /EDITORIAL_AUTHORITY_LEAK/);
  assert.match(bad.stdout, /REDACTED_URL/);
});

test("the adapt CLI writes both artifacts and reports the blocked record", async () => {
  const { directory, file } = await writeTempPackage(fixture);
  const recordsPath = path.join(directory, "records.json");
  const checklistPath = path.join(directory, "checklist.md");

  const result = spawnSync(
    process.execPath,
    [
      "scripts/jev-adapt.mjs",
      "--input", file,
      "--records", recordsPath,
      "--checklist", checklistPath
    ],
    { cwd: rootDirectory, encoding: "utf8" }
  );

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Adapted 6 record\(s\)/);
  assert.match(result.stderr, /cannot leave RADAR: sonic-labs-audio-the-josie-td3/);

  const records = JSON.parse(await readFile(recordsPath, "utf8"));
  assert.equal(records.length, 6);
  assert.equal(records.every((record) => record.type === "product-review"), true);

  const checklist = await readFile(checklistPath, "utf8");
  assert.match(checklist, /# ASP editorial checklist/);
  assert.match(checklist, /unitedplugins-firemaximizer/);
});
