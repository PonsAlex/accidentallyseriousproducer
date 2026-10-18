import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  formatEvidencePackageReport,
  validateEvidencePackage
} from "./evidence-package-validation.mjs";

/**
 * Adapt an ASP evidence package into ASP editorial input records.
 *
 * This step is deterministic code and makes no model call. It copies supplied
 * values, never composes copy, and deliberately leaves every editorial decision
 * to a human:
 *
 * - `editorial.verdict`, `editorial.editorialStatus` and `editorial.selection`
 *   are not set, so the fill leaves them empty;
 * - `metadata.evidence` flags are not set, because nothing has been confirmed;
 * - `href` is not set, because a public destination must be a reviewed
 *   `/go/<linkId>` created by a human in `data/affiliate-links.json`.
 */

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const ADAPTED_RECORDS_VERSION = "1.0";

const USAGE = `ASP evidence package -> editorial records

Usage:
  node scripts/jev-adapt.mjs --input <path> [options]

Options:
  --input <path>      Evidence package JSON to adapt (required)
  --records <path>    Editorial input records for jev:fill
                      (default: asp-editorial-records.json)
  --checklist <path>  Human review checklist in Markdown
                      (default: asp-editorial-checklist.md)
  --help              Show this message

This command makes no network call and writes no repository data.
`;

export function parseArgs(argv) {
  const options = {
    input: null,
    records: "asp-editorial-records.json",
    checklist: "asp-editorial-checklist.md",
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
      case "--records":
        options.records = next();
        break;
      case "--checklist":
        options.checklist = next();
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

function collectSources(evidence) {
  const primaries = evidence.filter((entry) => entry.role === "primary").map((entry) => entry.url);
  const secondaries = evidence.filter((entry) => entry.role !== "primary").map((entry) => entry.url);
  return [...new Set([...primaries, ...secondaries])];
}

function buildCatalogTasks(record) {
  const tasks = [
    {
      area: "data/affiliate-programs.json",
      action: "register-or-confirm",
      subject: record.developer?.name ?? "(unknown developer)",
      required: true
    },
    {
      area: "data/products.json",
      action: "register-or-confirm",
      subject: record.product?.name ?? "(unknown product)",
      required: true
    },
    {
      area: "data/affiliate-links.json",
      action: "review-destination-and-create-/go/-link",
      subject: record.acquisitionUrl ?? "(no acquisition URL captured)",
      required: true
    },
    {
      area: "data/promotions.json",
      action: "create-only-if-this-should-be-a-Deals-entry",
      subject: `${record.product?.name ?? "?"} — ${record.offerNature ?? "?"}`,
      required: false
    }
  ];
  return tasks;
}

function buildChecklistEntry(record) {
  const blockedReasons = [];
  if (record.primarySourceFound === false) {
    blockedReasons.push("No primary source was found; this record cannot leave RADAR.");
  }
  if (!record.acquisitionUrl) {
    blockedReasons.push("No acquisition URL captured; no reviewed destination can be created yet.");
  }
  if (!record.offer?.endsAt && !record.offer?.endsAtDate && record.limitedBy === "time") {
    blockedReasons.push("Time-limited offer with no end date; the deadline must be confirmed before publishing.");
  }

  const coupon = record.offer?.couponCode
    ? {
        code: record.offer.couponCode,
        scope: record.offer.couponScope ?? null,
        owner: record.offer.couponOwner ?? null,
        publishable: record.offer.couponPublishable ?? null,
        decision:
          record.offer.couponPublishable === true
            ? "Cleared for publication; the code appears in reader-facing copy."
            : "NOT cleared for publication; keep the code out of reader-facing copy until an editor decides."
      }
    : null;

  const copyMissing = record.copyStatus === "missing";

  const humanDecisionsRequired = [
    "Assign the editorial Verdict (Fire / Stash / Digital Furniture / Nah).",
    "Assign the editorial Status (Breaking / New Release / Free / Call an Ambulance / Last Chance / Updated).",
    "Assign the editorial selection.",
    "Confirm the evidence flags once the facts are checked.",
    "Provide the reviewed /go/<linkId> destination before any link is published."
  ];
  if (copyMissing) {
    humanDecisionsRequired.unshift(
      "Write the reader-facing copy: this record arrived with facts but no copy, because an extraction must not compose published text."
    );
  }

  return {
    recordId: record.recordId,
    plannedBlockId: `product-review-${record.recordId}`,
    type: "product-review",
    placementNote:
      record.limitedBy === "time"
        ? "Time-limited offer. If it should appear under Deals, create an approved promotion record and set type to \"deal\" plus facts.offer.promotionId."
        : "Permanent freeware; it belongs in articles as a product review unless an editor decides otherwise.",
    blocked: blockedReasons.length > 0,
    blockedReasons,
    primarySourceFound: record.primarySourceFound ?? null,
    copyStatus: record.copyStatus ?? null,
    freeQualification: record.freeQualification ?? null,
    sourceConfidence: record.confidence ?? null,
    coupon,
    proposedSummary: record.readerFacingCopy?.summary ?? null,
    regularPriceSource: record.offer?.regularPriceSource ?? null,
    sources: collectSources(record.evidence ?? []),
    openQuestions: record.openQuestions ?? [],
    toValidate: record.toValidate ?? [],
    missingFacts: record.missingFacts ?? [],
    notApplicable: record.notApplicable ?? [],
    catalogTasks: buildCatalogTasks(record),
    humanDecisionsRequired
  };
}

export function adaptEvidencePackage(pkg) {
  const report = validateEvidencePackage(pkg);
  if (report.errors.length > 0) {
    throw new Error(`Evidence package is not valid:\n${formatEvidencePackageReport(report)}`);
  }

  const records = pkg.records.map((record) => {
    const adapted = {
      inputVersion: ADAPTED_RECORDS_VERSION,
      recordId: record.recordId,
      type: "product-review",
      facts: {
        product: {
          name: record.product.name,
          developer: record.developer?.name ?? null,
          category: record.product.category ?? record.productKind ?? null
        },
        offer: {
          promoPrice: record.offer.promoPrice ?? null,
          regularPrice: record.offer.regularPrice ?? null,
          currency: record.offer.currency ?? null,
          startsAt: record.offer.startsAt ?? null,
          endsAt: record.offer.endsAt ?? null,
          // A date-only deadline is still a deadline. Dropping it here loses the
          // fact and makes the fill report a gap that does not exist.
          endsAtDate: record.offer.endsAtDate ?? null,
          dateOnly: record.offer.dateOnly === true,
          permanent: record.offer.permanent === true
        },
        restrictions: record.restrictions ?? [],
        sources: collectSources(record.evidence ?? [])
      },
      // Facts the package declared inapplicable, so the fill does not report them
      // as gaps. A permanent freeware has no end date by design.
      notApplicable: record.notApplicable ?? []
      // No `editorial` block: the Verdict, Status and selection stay human.
      // No `evidence` block: no fact has been confirmed yet.
      // No `href`: a reviewed /go/<linkId> does not exist yet.
    };

    // An extraction-derived record legitimately has no copy. Omitting draftCopy
    // leaves the content fields empty and makes the fill report the gap, rather
    // than inventing copy here.
    if (record.copyStatus !== "missing") {
      adapted.draftCopy = {
        title: record.readerFacingCopy.title,
        body: record.readerFacingCopy.body
      };
    }

    return adapted;
  });

  return { records, checklist: pkg.records.map(buildChecklistEntry) };
}

export function renderChecklistMarkdown(pkg, checklist) {
  const lines = [
    "# ASP editorial checklist",
    "",
    `Source package: \`packageVersion ${pkg.packageVersion}\`, scan date ${pkg.scanDate}.`,
    `Monitored channels: ${pkg.channelsMonitored.length}. Accepted: ${pkg.candidatesAccepted}. Rejected: ${pkg.candidatesRejected}.`,
    "",
    "Nothing here is approved. Every Verdict, Status and selection below is a human decision.",
    ""
  ];

  for (const entry of checklist) {
    lines.push(`## ${entry.recordId}`);
    lines.push("");
    lines.push(`- Planned block: \`${entry.plannedBlockId}\` (${entry.type})`);
    lines.push(`- Primary source found: ${entry.primarySourceFound === null ? "not declared" : entry.primarySourceFound}`);
    lines.push(`- Copy status: ${entry.copyStatus ?? "not declared"}`);
    if (entry.freeQualification) {
      lines.push(`- Free qualification: ${entry.freeQualification}`);
    }
    if (entry.sourceConfidence) {
      const confidence = Object.entries(entry.sourceConfidence)
        .map(([dimension, value]) => `${dimension} ${value}`)
        .join(", ");
      lines.push(`- Source confidence: ${confidence}`);
    }
    lines.push(`- ${entry.placementNote}`);
    if (entry.blocked) {
      lines.push(`- **BLOCKED**`);
      for (const reason of entry.blockedReasons) {
        lines.push(`  - ${reason}`);
      }
    }
    lines.push("");
    lines.push("### Catalog work before this can be published");
    lines.push("");
    for (const task of entry.catalogTasks) {
      const flag = task.required ? "required" : "optional";
      lines.push(`- [ ] \`${task.area}\` — ${task.action} (${flag}): ${task.subject}`);
    }
    lines.push("");
    lines.push("- [ ] Provide the reviewed `/go/<linkId>` destination for `draftCopy.href`.");
    lines.push("");

    if (entry.coupon) {
      lines.push("### Coupon");
      lines.push("");
      lines.push(`- Code: \`${entry.coupon.code}\``);
      lines.push(`- Scope: ${entry.coupon.scope} · Owner: ${entry.coupon.owner ?? "n/a"}`);
      lines.push(`- Publishable: ${JSON.stringify(entry.coupon.publishable)} — ${entry.coupon.decision}`);
      lines.push("");
    }

    const lists = [
      ["Open questions", entry.openQuestions],
      ["To validate", entry.toValidate],
      ["Missing facts", entry.missingFacts],
      ["Not applicable", entry.notApplicable]
    ];
    for (const [title, items] of lists) {
      lines.push(`### ${title}`);
      lines.push("");
      if (items.length === 0) {
        lines.push("- none");
      } else {
        for (const item of items) lines.push(`- ${item}`);
      }
      lines.push("");
    }

    lines.push("### Editorial decisions required");
    lines.push("");
    for (const decision of entry.humanDecisionsRequired) {
      lines.push(`- [ ] ${decision}`);
    }
    lines.push("");
    if (entry.proposedSummary) {
      lines.push(`> Proposed summary (not published anywhere yet): ${entry.proposedSummary}`);
      lines.push("");
    }
    if (entry.regularPriceSource) {
      lines.push(`Regular price source: ${entry.regularPriceSource}`);
      lines.push("");
    }
    lines.push("Sources:");
    lines.push("");
    for (const source of entry.sources) lines.push(`- ${source}`);
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(USAGE);
    return;
  }
  if (!options.input) {
    throw new Error("--input is required. Pass the evidence package file to adapt.");
  }

  const absolute = path.resolve(rootDirectory, options.input);
  let parsed;
  try {
    parsed = JSON.parse(await readFile(absolute, "utf8"));
  } catch (error) {
    throw new Error(`Could not read and parse ${path.relative(rootDirectory, absolute)}: ${error.message}`);
  }

  const { records, checklist } = adaptEvidencePackage(parsed);

  const recordsPath = path.resolve(rootDirectory, options.records);
  await writeFile(recordsPath, `${JSON.stringify(records, null, 2)}\n`, "utf8");

  const checklistPath = path.resolve(rootDirectory, options.checklist);
  await writeFile(checklistPath, renderChecklistMarkdown(parsed, checklist), "utf8");

  const blocked = checklist.filter((entry) => entry.blocked);
  console.log(
    `Adapted ${records.length} record(s) to ${path.relative(rootDirectory, recordsPath)} and wrote ${path.relative(rootDirectory, checklistPath)}.`
  );
  if (blocked.length > 0) {
    console.warn(
      `WARN ${blocked.length} record(s) are blocked and cannot leave RADAR: ${blocked.map((entry) => entry.recordId).join(", ")}`
    );
  }
  console.log(
    "No Verdict, Status, selection, evidence flag or public link was set. Run jev:fill after a human reviews the checklist."
  );
}

const invokedDirectly =
  typeof process.argv[1] === "string" &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main().catch((error) => {
    console.error(`ERROR ADAPT: ${error.stack ?? error.message}`);
    process.exitCode = 1;
  });
}
