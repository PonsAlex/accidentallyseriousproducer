import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validatePromotionCandidate } from "./candidate-validation.mjs";
import {
  FREE_QUALIFICATIONS,
  OFFER_NATURES,
  formatEvidencePackageReport,
  validateEvidencePackage
} from "./evidence-package-validation.mjs";

/**
 * Bridge a private Odysseus candidate into an evidence package record.
 *
 * This runs at the end of PREPARAÇÃO, after a human has confirmed the primary
 * source. It is deterministic code with no model call: it copies extracted
 * values, derives the fields that follow from them, and refuses to guess
 * anything else.
 *
 * Two things it deliberately never carries across:
 *
 * - `source.sender`, `source.subject` and `source.messageId` are private email
 *   metadata and stay in private storage.
 * - `links.affiliateUrl` is a URL found in an email. The data contract is explicit
 *   that it is source evidence and not an approved affiliate destination, so it
 *   must never become a public link.
 */

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const BRIDGE_VERSION = "1.0";

export const BRIDGE_REFUSAL_REASONS = Object.freeze({
  invalidCandidate: "candidate-is-not-valid",
  unknownCategory: "product-category-is-null",
  noEvidence: "no-citable-evidence",
  unknownOfferNature: "offer-nature-cannot-be-derived",
  limitedFreeWithoutLimit: "limited-free-without-declared-limit",
  missingPriceSource: "regular-price-has-no-source",
  contradictoryDate: "date-only-with-invented-timestamp"
});

const USAGE = `Bridge private Odysseus candidates into an ASP evidence package

Usage:
  node scripts/candidate-to-package.mjs --input <path> [options]

Options:
  --input <path>     Candidate JSON, or an array of candidates (required)
  --output <path>    Evidence package to write (default: asp-evidence-package.json)
  --report <path>    Bridge report (default: asp-candidate-bridge-report.json)
  --scan-date <date> Package scan date, YYYY-MM-DD
                     (default: the latest source receivedAt date, else today UTC)
  --help             Show this message

This command makes no network call, writes no repository data, and never copies
private email metadata.
`;

export function parseArgs(argv) {
  const options = {
    input: null,
    output: "asp-evidence-package.json",
    report: "asp-candidate-bridge-report.json",
    scanDate: null,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`Option ${argument} requires a value.`);
      return argv[index];
    };

    switch (argument) {
      case "--input":
        options.input = next();
        break;
      case "--output":
        options.output = next();
        break;
      case "--report":
        options.report = next();
        break;
      case "--scan-date":
        options.scanDate = next();
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      default:
        throw new Error(`Unknown option: ${argument}`);
    }
  }

  return options;
}

export function normalizeCandidates(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object" && Array.isArray(value.candidates)) return value.candidates;
  return [value];
}

/**
 * Derive the offer nature from explicit extracted fields. Returns null when the
 * facts do not determine it, so the bridge refuses instead of guessing.
 */
export function deriveOfferNature(candidate) {
  if (OFFER_NATURES.includes(candidate.offerNature)) {
    return candidate.offerNature;
  }

  const { promoPrice, endsAt, endsAtDate } = candidate.offer ?? {};
  const hasEnd = Boolean(endsAt || endsAtDate);
  const permanent = candidate.offer?.permanent === true;
  const quantityLimited = candidate.limitedBy === "quantity";

  if (promoPrice === 0 && permanent) return "permanent-free";
  if (promoPrice === 0 && (hasEnd || quantityLimited)) return "limited-free";
  if (typeof promoPrice === "number" && promoPrice > 0) return "paid-promo";
  return null;
}

export function deriveLimitedBy(candidate, offerNature) {
  if (candidate.limitedBy) return candidate.limitedBy;
  const { endsAt, endsAtDate } = candidate.offer ?? {};
  if (endsAt || endsAtDate) return "time";
  // A limited offer with no declared limit is not an unlimited offer. Returning
  // "none" would make it look unbounded, so the bridge returns null and refuses.
  if (offerNature === "limited-free") return null;
  return "none";
}

export function deriveFreeQualification(candidate, offerNature) {
  if (FREE_QUALIFICATIONS.includes(candidate.freeQualification)) return candidate.freeQualification;
  if (candidate.offer?.couponCode) return "Requer código";
  if (offerNature === "permanent-free") return "Free";
  if (offerNature === "limited-free") return "Free temporário";
  if (offerNature === "paid-promo") return "Não é Free";
  return "Inconclusivo";
}

function candidateToRecord(candidate) {
  const offerNature = deriveOfferNature(candidate);
  const evidence = Array.isArray(candidate.evidence) ? candidate.evidence : [];

  const missingFacts = [...new Set([...(candidate.missingFacts ?? []), "readerFacingCopy"])];

  return {
    recordId: candidate.candidateId,
    productKind: candidate.product.category,
    offerNature,
    limitedBy: deriveLimitedBy(candidate, offerNature),
    primarySourceFound:
      typeof candidate.primarySourceFound === "boolean"
        ? candidate.primarySourceFound
        : evidence.some((entry) => entry?.role === "primary"),
    freeQualification: deriveFreeQualification(candidate, offerNature),
    developer: {
      name: candidate.product.developer ?? candidate.developer?.name ?? null,
      developerOfficialUrl: candidate.links?.developerOfficialUrl ?? null
    },
    // `links.sourceUrl` is the email's own link: evidence, never a destination.
    acquisitionUrl: candidate.links?.sourceUrl ?? null,
    product: {
      name: candidate.product.name,
      category: candidate.product.category,
      whatItIs: candidate.product.whatItIs ?? null
    },
    offer: {
      promoPrice: candidate.offer?.promoPrice ?? null,
      regularPrice: candidate.offer?.regularPrice ?? null,
      regularPriceSource: candidate.offer?.regularPriceSource ?? null,
      currency: candidate.offer?.currency ?? null,
      startsAt: candidate.offer?.startsAt ?? null,
      endsAt: candidate.offer?.endsAt ?? null,
      endsAtDate: candidate.offer?.endsAtDate ?? null,
      dateOnly: candidate.offer?.dateOnly === true,
      permanent: offerNature === "permanent-free",
      couponCode: candidate.offer?.couponCode ?? null,
      couponScope: candidate.offer?.couponScope ?? "unknown",
      couponOwner: candidate.offer?.couponOwner ?? null,
      couponPublishable: candidate.offer?.couponPublishable ?? "unknown"
    },
    // Extraction produces facts, never published copy.
    copyStatus: "missing",
    evidence,
    restrictions: candidate.restrictions ?? [],
    openQuestions: candidate.openQuestions ?? [],
    missingFacts,
    notApplicable: candidate.notApplicable ?? [],
    toValidate: candidate.toValidate ?? [],
    pendingHumanDecision: true,
    // Preserved for the checklist; not editorial authority.
    confidence: candidate.confidence ?? null
  };
}

function refusalFor(candidate, report) {
  if (report.errors.length > 0) {
    return {
      reason: BRIDGE_REFUSAL_REASONS.invalidCandidate,
      detail: report.errors.map((issue) => `${issue.location} ${issue.message}`).join("; ")
    };
  }
  if (!candidate.product?.category) {
    return {
      reason: BRIDGE_REFUSAL_REASONS.unknownCategory,
      detail: "product.category is null. Classify the product before bridging; the category is never guessed."
    };
  }
  if (!Array.isArray(candidate.evidence) || candidate.evidence.length === 0) {
    return {
      reason: BRIDGE_REFUSAL_REASONS.noEvidence,
      detail:
        "No citable evidence. Confirm at least one https source (the vendor page) during PREPARAÇÃO; an email link alone is not a citable source."
    };
  }
  const offerNature = deriveOfferNature(candidate);
  if (!offerNature) {
    return {
      reason: BRIDGE_REFUSAL_REASONS.unknownOfferNature,
      detail: "The offer facts do not determine an offer nature. Set offerNature or freeQualification explicitly."
    };
  }
  if (deriveLimitedBy(candidate, offerNature) === null) {
    return {
      reason: BRIDGE_REFUSAL_REASONS.limitedFreeWithoutLimit,
      detail:
        'offerNature is "limited-free" but the offer declares no time, quantity or catalog limit. Record the limit or the deadline before bridging.'
    };
  }
  if (typeof candidate.offer?.regularPrice === "number" && !candidate.offer?.regularPriceSource) {
    return {
      reason: BRIDGE_REFUSAL_REASONS.missingPriceSource,
      detail: "A numeric regularPrice needs a regularPriceSource. Record where the price came from."
    };
  }
  if (candidate.offer?.dateOnly === true && candidate.offer?.endsAt) {
    return {
      reason: BRIDGE_REFUSAL_REASONS.contradictoryDate,
      detail:
        "dateOnly is true but a full endsAt timestamp is present. The time was invented: clear endsAt and keep only endsAtDate."
    };
  }
  return null;
}

export function bridgeCandidates(candidates, { knownProgramIds = [], scanDate = null } = {}) {
  const records = [];
  const refused = [];
  const notes = [];

  for (const candidate of candidates) {
    const validation = validatePromotionCandidate(candidate, { knownProgramIds });
    const refusal = refusalFor(candidate, validation);

    if (refusal) {
      refused.push({ candidateId: candidate?.candidateId ?? "(unknown)", ...refusal });
      continue;
    }

    if (candidate.links?.affiliateUrl) {
      notes.push(
        `Candidate ${candidate.candidateId} carried links.affiliateUrl. It was NOT carried across: a URL found in an email is source evidence, not an approved affiliate destination.`
      );
    }
    const droppedOfferFields = ["discountPercent", "timezoneSource"].filter(
      (field) => candidate.offer?.[field] !== undefined && candidate.offer?.[field] !== null
    );
    if (droppedOfferFields.length > 0) {
      notes.push(
        `Candidate ${candidate.candidateId} dropped unmapped offer field(s): ${droppedOfferFields.join(", ")}.`
      );
    }

    records.push(candidateToRecord(candidate));
  }

  const resolvedScanDate =
    scanDate ?? deriveScanDate(candidates) ?? new Date().toISOString().slice(0, 10);

  const channels = [
    ...new Set(
      records
        .map((record) => record.developer.name)
        .filter((name) => typeof name === "string" && name.trim() !== "")
    )
  ];

  const pkg = {
    packageVersion: "1.0",
    scanDate: resolvedScanDate,
    // Vendor names only. Private sender identities never leave private storage.
    channelsMonitored: channels.length > 0 ? channels : ["unattributed"],
    candidatesAccepted: records.length,
    candidatesRejected: refused.length,
    rejectedSummary: refused.map((entry) => `${entry.candidateId}: ${entry.reason}`),
    records
  };

  return { package: pkg, report: { converted: records.map((record) => record.recordId), refused, notes } };
}

function deriveScanDate(candidates) {
  const dates = candidates
    .map((candidate) => candidate?.source?.receivedAt)
    .filter((value) => typeof value === "string" && Number.isFinite(Date.parse(value)))
    .map((value) => value.slice(0, 10))
    .sort();
  return dates.length > 0 ? dates[dates.length - 1] : null;
}

async function readJson(filePath) {
  const absolute = path.resolve(rootDirectory, filePath);
  try {
    return JSON.parse(await readFile(absolute, "utf8"));
  } catch (error) {
    throw new Error(`Could not read and parse ${path.relative(rootDirectory, absolute)}: ${error.message}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(USAGE);
    return;
  }
  if (!options.input) {
    throw new Error("--input is required. Pass the candidate file to bridge.");
  }

  const candidates = normalizeCandidates(await readJson(options.input));
  const { package: pkg, report } = bridgeCandidates(candidates, { scanDate: options.scanDate });

  if (pkg.records.length === 0) {
    throw new Error(
      `No candidate could be bridged:\n- ${report.refused
        .map((entry) => `${entry.candidateId} [${entry.reason}] ${entry.detail}`)
        .join("\n- ")}`
    );
  }

  // Self-check: the bridge must never produce a package its own validator rejects.
  const validation = validateEvidencePackage(pkg);
  if (validation.errors.length > 0) {
    throw new Error(`The bridge produced an invalid package:\n${formatEvidencePackageReport(validation)}`);
  }

  const outputPath = path.resolve(rootDirectory, options.output);
  await writeFile(outputPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");

  const reportPath = path.resolve(rootDirectory, options.report);
  await writeFile(reportPath, `${JSON.stringify({ bridgeVersion: BRIDGE_VERSION, ...report }, null, 2)}\n`, "utf8");

  console.log(
    `Bridged ${pkg.records.length} candidate(s), refused ${report.refused.length}. Wrote ${path.relative(rootDirectory, outputPath)} and ${path.relative(rootDirectory, reportPath)}.`
  );
  for (const entry of report.refused) {
    console.warn(`WARN refused ${entry.candidateId} [${entry.reason}]: ${entry.detail}`);
  }
  for (const note of report.notes) {
    console.warn(`WARN ${note}`);
  }
  console.log(
    "No copy, Verdict, Status, evidence flag or public link was produced. The package needs editorial review before jev:adapt."
  );
}

const invokedDirectly =
  typeof process.argv[1] === "string" &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main().catch((error) => {
    console.error(`ERROR BRIDGE: ${error.stack ?? error.message}`);
    process.exitCode = 1;
  });
}
