import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createConsoleExportEnvelope, prepareConsoleImport } from "../assets/console-export.mjs";
import { readAffiliateData } from "./affiliate-validation.mjs";
import {
  applyEditorialRecords,
  hasUsableCopy,
  resolveRecordType,
  validateEditorialInputRecord
} from "./content-fill.mjs";
import {
  JEV_TYPESAFE_BASE_URL,
  JEV_TYPESAFE_MODEL,
  buildJevFillRequest,
  callSystemOne,
  interpretJevFillAnswers,
  resolveJevEndpoint
} from "./jev-judgments.mjs";

/**
 * Fill ASP content blocks from already-validated editorial records.
 *
 * The fill itself is deterministic code: every reader-facing value is copied
 * from the record, never generated. Jev resolves placement (which block type)
 * and reports whether the record is coherent and complete. Neither step
 * publishes, approves or merges anything.
 */

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const FILL_REPORT_FORMAT = "asp-jev-fill-report";
export const FILL_REPORT_FORMAT_VERSION = 1;

export const FILL_SKIP_REASONS = Object.freeze({
  notAnOffer: "record-is-not-a-product-offer"
});

const USAGE = `ASP Console fill from validated editorial records

Usage:
  node scripts/jev-fill.mjs --records <path> [options]

Options:
  --records <path>    Validated editorial record, or an array of them (required)
  --state <path>      Existing Console state or export to fill into
                      (default: asp-console-export.json)
  --output <path>     Filled ASP Console export envelope
                      (default: asp-console-export.filled.json)
  --report <path>     Fill report (default: asp-jev-fill-report.json)
  --no-jev            Fill deterministically without calling Jev
  --print-request     Print the System One request bodies and exit
  --help              Show this message

Credentials (environment, never written to disk):
  TYPESAFE_API_KEY      TypeSafe API key, direct route (default)
  AI_GATEWAY_API_KEY    Vercel AI Gateway key, optional alternative route
`;

export function parseArgs(argv) {
  const options = {
    records: null,
    state: "asp-console-export.json",
    output: "asp-console-export.filled.json",
    report: "asp-jev-fill-report.json",
    noJev: false,
    printRequest: false,
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
      case "--records":
        options.records = next();
        break;
      case "--state":
        options.state = next();
        break;
      case "--output":
        options.output = next();
        break;
      case "--report":
        options.report = next();
        break;
      case "--no-jev":
        options.noJev = true;
        break;
      case "--print-request":
        options.printRequest = true;
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

async function readJson(filePath) {
  const absolute = path.resolve(rootDirectory, filePath);
  let source;
  try {
    source = await readFile(absolute, "utf8");
  } catch (error) {
    throw new Error(`Could not read ${path.relative(rootDirectory, absolute)}: ${error.message}`);
  }
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`${path.relative(rootDirectory, absolute)} is not valid JSON: ${error.message}`);
  }
}

export function normalizeRecords(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object" && Array.isArray(value.records)) return value.records;
  return [value];
}

/**
 * Printing the request bodies is an offline inspection mode, so it must work
 * without a credential. Any configured route is still honoured.
 */
export function resolveEndpointForRequests(env, { printRequest = false } = {}) {
  try {
    return resolveJevEndpoint(env);
  } catch (error) {
    if (!printRequest) throw error;
    return {
      route: "typesafe",
      baseUrl: JEV_TYPESAFE_BASE_URL,
      model: JEV_TYPESAFE_MODEL,
      endpoint: null,
      apiKey: null
    };
  }
}

function describeReferencedPromotion(promotion) {
  if (!promotion) return undefined;
  return {
    currentPrice: promotion.promoPrice ?? null,
    regularPrice: promotion.regularPrice ?? null,
    currency: promotion.currency ?? null,
    endsAt: promotion.endsAt ?? null,
    status: promotion.status ?? null,
    verdict: promotion.verdict ?? null
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(USAGE);
    return;
  }
  if (!options.records) {
    throw new Error("--records is required. Pass the validated editorial record file to fill from.");
  }

  const state = prepareConsoleImport(await readJson(options.state));
  const records = normalizeRecords(await readJson(options.records));
  const data = await readAffiliateData(rootDirectory);
  const promotionsById = new Map(data.promotions.map((promotion) => [promotion.id, promotion]));

  // Validate every record before touching Jev or the state.
  const problems = [];
  records.forEach((record, index) => {
    const report = validateEditorialInputRecord(record, { knownPromotionIds: promotionsById });
    for (const issue of report.errors) {
      problems.push(`records[${index}] ${issue.location}: ${issue.message}`);
    }
    for (const issue of report.warnings) {
      problems.push(`WARN records[${index}] ${issue.location}: ${issue.message}`);
    }
  });
  const fatal = problems.filter((line) => !line.startsWith("WARN "));
  if (fatal.length > 0) {
    throw new Error(`Invalid editorial input:\n- ${fatal.join("\n- ")}`);
  }
  for (const line of problems) {
    console.warn(line);
  }

  if (options.noJev && options.printRequest) {
    throw new Error("--print-request needs Jev enabled; it prints the System One requests.");
  }
  if (options.noJev && records.some((record) => !record.type)) {
    throw new Error(
      "Every record must declare a type when --no-jev is used, because no classifier is available."
    );
  }

  const endpoint = options.noJev
    ? null
    : resolveEndpointForRequests(process.env, { printRequest: options.printRequest });
  const filledAt = new Date().toISOString();
  const requests = [];
  const skipped = [];

  for (const record of records) {
    const promotion = record.facts?.offer?.promotionId
      ? promotionsById.get(record.facts.offer.promotionId) ?? null
      : null;

    if (options.noJev) {
      const { type } = resolveRecordType(record, {});
      requests.push({ record, type, jev: {} });
      continue;
    }

    const requestRecord = {
      ...record,
      facts: { ...record.facts, referencedPromotion: describeReferencedPromotion(promotion) }
    };
    const body = buildJevFillRequest(requestRecord, {
      model: endpoint.model,
      needsType: !record.type,
      hasCopy: hasUsableCopy(record, record.type ?? "product-review"),
      hasPromotionRecord: Boolean(promotion)
    });
    requests.push({ record, body });
  }

  if (options.printRequest) {
    console.log(JSON.stringify(requests.map((entry) => ({ recordId: entry.record.recordId, body: entry.body })), null, 2));
    return;
  }

  const entries = [];
  for (const entry of requests) {
    if (options.noJev) {
      entries.push(entry);
      continue;
    }

    const response = await callSystemOne({
      endpoint: endpoint.endpoint,
      apiKey: endpoint.apiKey,
      body: entry.body
    });
    const jev = interpretJevFillAnswers(entry.record, response?.answers ?? {}, {
      model: response?.model ?? entry.body.model,
      route: endpoint.route,
      evaluatedAt: filledAt
    });
    const { type, source } = resolveRecordType(entry.record, { offerKind: jev.advisories.offerKind });

    if (!type) {
      skipped.push({
        recordId: entry.record.recordId,
        reason: FILL_SKIP_REASONS.notAnOffer,
        detail: `Jev classified the record as "${jev.advisories.offerKind}".`
      });
      continue;
    }

    entries.push({ record: entry.record, type, jev: { ...jev, typeSource: source } });
  }

  const { state: filledState, results, duplicateWarnings } = applyEditorialRecords(state, entries, {
    updatedAt: filledAt,
    promotionsById
  });

  if (results.length === 0) {
    console.log(
      `No block was filled: all ${skipped.length} record(s) were skipped. Nothing was written and the state is unchanged.`
    );
    return;
  }

  const envelope = createConsoleExportEnvelope(filledState, new Date().toISOString());
  const outputPath = path.resolve(rootDirectory, options.output);
  await writeFile(outputPath, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");

  const report = {
    format: FILL_REPORT_FORMAT,
    formatVersion: FILL_REPORT_FORMAT_VERSION,
    filledAt,
    route: endpoint?.route ?? "none",
    model: endpoint?.model ?? null,
    state: options.state,
    records: options.records,
    results,
    skipped,
    duplicateWarnings
  };
  const reportPath = path.resolve(rootDirectory, options.report);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  const created = results.filter((result) => result.action === "created").length;
  const updated = results.length - created;
  const mergedByRecordId = results.filter((result) => result.matchedBy === "recordId").length;
  console.log(
    `Filled ${results.length} block(s) (${created} created, ${updated} updated${mergedByRecordId > 0 ? `, ${mergedByRecordId} merged by recordId` : ""}), skipped ${skipped.length}. Wrote ${path.relative(rootDirectory, outputPath)} and ${path.relative(rootDirectory, reportPath)}.`
  );
  const withGaps = results.filter((result) => result.missing.length > 0);
  for (const result of withGaps) {
    console.warn(`WARN ${result.blockId}: missing ${result.missing.join(", ")}`);
  }
  for (const duplicate of duplicateWarnings) {
    console.warn(
      `WARN possible duplicate: "${duplicate.productKey}" already arrives as ${duplicate.existingRecordId} and now also as ${duplicate.incomingRecordId}. Two blocks for one offer unless the sources agree on a recordId.`
    );
  }
  console.log("Nothing was published, approved or merged. Import the output into the Console for human review.");
}

const invokedDirectly =
  typeof process.argv[1] === "string" &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main().catch((error) => {
    console.error(`ERROR JEV FILL: ${error.stack ?? error.message}`);
    process.exitCode = 1;
  });
}
