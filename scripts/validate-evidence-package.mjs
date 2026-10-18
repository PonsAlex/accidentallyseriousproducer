import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  formatEvidencePackageReport,
  validateEvidencePackage
} from "./evidence-package-validation.mjs";

/**
 * Validate an ASP evidence package: the artifact NotebookLM / Odysseus hand to a
 * human editor. Read-only. It never imports, adapts or publishes anything.
 */

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const USAGE = `ASP evidence package validation

Usage:
  node scripts/validate-evidence-package.mjs --input <path>

Options:
  --input <path>   Evidence package JSON to validate (required)
  --help           Show this message
`;

export function parseArgs(argv) {
  const options = { input: null, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    switch (argument) {
      case "--input":
        index += 1;
        if (index >= argv.length) throw new Error("--input requires a path.");
        options.input = argv[index];
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

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(USAGE);
    return;
  }
  if (!options.input) {
    throw new Error("--input is required. Pass the evidence package file to validate.");
  }

  const absolute = path.resolve(rootDirectory, options.input);
  const relative = path.relative(rootDirectory, absolute);
  let source;
  try {
    source = await readFile(absolute, "utf8");
  } catch (error) {
    throw new Error(`Could not read ${relative}: ${error.message}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new Error(`${relative} is not valid JSON: ${error.message}`);
  }

  const report = validateEvidencePackage(parsed);
  console.log(formatEvidencePackageReport(report));

  if (report.errors.length > 0) {
    process.exitCode = 1;
    return;
  }
  console.log(`Pacote ${relative} validado: nenhum dado foi importado ou publicado.`);
}

const invokedDirectly =
  typeof process.argv[1] === "string" &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main().catch((error) => {
    console.error(`ERROR EVIDENCE PACKAGE: ${error.stack ?? error.message}`);
    process.exitCode = 1;
  });
}
