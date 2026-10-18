import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createConsoleExportEnvelope, prepareConsoleImport } from "../assets/console-export.mjs";
import { readAffiliateData } from "./affiliate-validation.mjs";
import {
  JEV_SUGGESTIONS_FORMAT,
  JEV_SUGGESTIONS_FORMAT_VERSION,
  applyJevSuggestions,
  buildJevRequests,
  callSystemOne,
  interpretJevAnswers,
  resolveJevEndpoint
} from "./jev-judgments.mjs";

/**
 * Human-invoked Jev review for an exported ASP Editorial Console state.
 *
 * This command is deliberately manual and offline from the site: it is not bound
 * to /advance, it writes no public content, and it never publishes. It produces
 * an advisory report; the editor decides what, if anything, to keep.
 */

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const USAGE = `ASP Jev advisory review

Usage:
  node scripts/jev-review.mjs [options]

Options:
  --input <path>        Editorial state or ASP Console export (default: asp-console-export.json)
  --output <path>       Advisory report to write (default: asp-jev-suggestions.json)
  --apply               Also write the state with metadata.jev advisories merged
  --out-state <path>    Destination for --apply (default: asp-console-export.jev.json)
  --print-request       Print the System One request bodies and exit without calling Jev
  --only <blockId>      Evaluate only the given block ID (repeatable)
  --help                Show this message

Credentials (environment, never written to disk):
  TYPESAFE_API_KEY      TypeSafe API key, direct route
  AI_GATEWAY_API_KEY    Vercel AI Gateway key, TypeSafe-compatible route
  JEV_BASE_URL          Override the base URL of the System One endpoint
  JEV_MODEL             Override the model identifier
  JEV_ROUTE             typesafe | ai-gateway | custom
`;

function parseArgs(argv) {
  const options = {
    input: "asp-console-export.json",
    output: "asp-jev-suggestions.json",
    outState: "asp-console-export.jev.json",
    apply: false,
    printRequest: false,
    only: [],
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) {
        throw new Error(`Option ${argument} requires a value.`);
      }
      return argv[index];
    };

    switch (argument) {
      case "--input":
        options.input = next();
        break;
      case "--output":
        options.output = next();
        break;
      case "--out-state":
        options.outState = next();
        break;
      case "--only":
        options.only.push(next());
        break;
      case "--apply":
        options.apply = true;
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

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(USAGE);
    return;
  }

  const state = prepareConsoleImport(await readJson(options.input));
  const data = await readAffiliateData(rootDirectory);
  const productsById = new Map(data.products.map((product) => [product.id, product]));
  const promotionsById = new Map(data.promotions.map((promotion) => [promotion.id, promotion]));

  const { requests, skipped } = buildJevRequests(state, { productsById, promotionsById });
  const selected = options.only.length > 0
    ? requests.filter((entry) => options.only.includes(entry.blockId))
    : requests;

  if (options.only.length > 0 && selected.length === 0) {
    throw new Error(
      `No evaluable block matched --only. Evaluable blocks: ${requests.map((entry) => entry.blockId).join(", ") || "(none)"}.`
    );
  }

  if (options.printRequest) {
    console.log(
      JSON.stringify(
        selected.map((entry) => ({ blockId: entry.blockId, body: entry.request })),
        null,
        2
      )
    );
    return;
  }

  const endpoint = resolveJevEndpoint(process.env);
  const blocksById = new Map(state.blocks.map((block) => [block.id, block]));
  const evaluatedAt = new Date().toISOString();
  const results = [];

  for (const entry of selected) {
    const response = await callSystemOne({
      endpoint: endpoint.endpoint,
      apiKey: endpoint.apiKey,
      body: entry.request
    });
    results.push(
      interpretJevAnswers(blocksById.get(entry.blockId), response?.answers ?? {}, {
        model: response?.model ?? entry.request.model,
        route: endpoint.route,
        evaluatedAt
      })
    );
  }

  const report = {
    format: JEV_SUGGESTIONS_FORMAT,
    formatVersion: JEV_SUGGESTIONS_FORMAT_VERSION,
    evaluatedAt,
    route: endpoint.route,
    model: endpoint.model,
    input: options.input,
    advisory: true,
    requiresHumanReview: true,
    results,
    skipped
  };

  const outputPath = path.resolve(rootDirectory, options.output);
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(
    `Jev advisory report written to ${path.relative(rootDirectory, outputPath)} (${results.length} evaluated, ${skipped.length} skipped, route: ${endpoint.route}).`
  );

  if (options.apply) {
    const { state: merged, applied } = applyJevSuggestions(state, report);
    const envelope = createConsoleExportEnvelope(merged, new Date().toISOString());
    const outStatePath = path.resolve(rootDirectory, options.outState);
    await writeFile(outStatePath, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
    console.log(
      `Merged ${applied} advisor${applied === 1 ? "y" : "ies"} into ${path.relative(rootDirectory, outStatePath)}. Editorial Verdict, Status, evidence and gates are untouched; /advance readiness was invalidated.`
    );
  } else {
    console.log(
      "Report only. Re-run with --apply to merge metadata.jev advisories into a copy of the state. Nothing was published."
    );
  }
}

const invokedDirectly =
  typeof process.argv[1] === "string" &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main().catch((error) => {
    console.error(`ERROR JEV: ${error.stack ?? error.message}`);
    process.exitCode = 1;
  });
}
