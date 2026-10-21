import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  findRedactionMarkers,
  formatEvidencePackageReport,
  validateEvidencePackage
} from "./evidence-package-validation.mjs";

/**
 * Decide what an incoming evidence package is actually worth, before anything
 * touches the catalogue.
 *
 * Structure validation answers "is this package well formed?". It cannot answer
 * the two questions that cost real time:
 *
 *   1. Is this record already published? A producer that re-scans the same
 *      ground re-delivers live posts as "accepted candidates".
 *   2. Would importing it make the live site worse? Merging by recordId rewrites
 *      the block in place, so a package carrying a homepage URL or a checkout
 *      deep-link silently undoes a correction a human made.
 *
 * This module answers both, offline and deterministically. It reads; it never
 * writes.
 */

export const INTAKE_STATES = Object.freeze({
  PUBLISHABLE: "publishable",
  ALREADY_LIVE: "already-live",
  BLOCKED: "blocked"
});

export const INTAKE_VERDICTS = Object.freeze({
  NEW_MATERIAL: "new-material",
  REGRESSION_ONLY: "regression-only",
  NOTHING_NEW: "nothing-new",
  NOTHING_USABLE: "nothing-usable"
});

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function pathDepth(url) {
  try {
    return new URL(url).pathname.split("/").filter(Boolean).length;
  } catch {
    return -1;
  }
}

/**
 * A checkout URL is a transaction, not a readable destination. The reader should
 * land on the page that explains the product.
 */
function looksLikeCheckout(url) {
  return (
    /\/(checkout|cart|basket)(\/|$)/i.test(url) ||
    /[?&](catalogItemReferenceIds|cart|checkout)=/i.test(url)
  );
}

function hasRedactionMarker(value) {
  return findRedactionMarkers(value, "$", []).length > 0;
}

/**
 * Classify one record against what is already published.
 *
 * BLOCKED wins over everything: a record with no verifiable primary source has
 * nothing to publish, whatever else it carries.
 */
export function classifyRecord(record, { products = [], links = [], verification = null } = {}) {
  const recordId = typeof record?.recordId === "string" ? record.recordId : "(sem recordId)";
  const acquisitionUrl =
    typeof record?.acquisitionUrl === "string" ? record.acquisitionUrl.trim() : "";
  const product = products.find((entry) => entry.id === recordId) ?? null;
  const link = product ? links.find((entry) => entry.productId === recordId) ?? null : null;

  const blockers = [];
  if (record?.primarySourceFound !== true) {
    blockers.push("sem fonte primária confirmada");
  }
  if (acquisitionUrl.length === 0) {
    blockers.push("sem URL de aquisição");
  } else if (hasRedactionMarker(acquisitionUrl)) {
    blockers.push("URL de aquisição redigida");
  } else if (!/^https:\/\//i.test(acquisitionUrl)) {
    blockers.push("URL de aquisição não é https");
  }
  // A URL that does not open is not a source, however complete it looks.
  if (verification && verification.ok === false) {
    blockers.push(`destino não responde (${verification.reason})`);
  }

  if (blockers.length > 0) {
    return { recordId, state: INTAKE_STATES.BLOCKED, reasons: blockers, changes: [], product, link };
  }

  if (!product) {
    return {
      recordId,
      state: INTAKE_STATES.PUBLISHABLE,
      reasons: [],
      changes: [],
      product,
      link
    };
  }

  const changes = [];

  const catalogCategory = product.category ?? null;
  const packageCategory = record?.product?.category ?? null;
  if (catalogCategory && packageCategory && catalogCategory !== packageCategory) {
    // Re-importing would rewrite the category with a value a human already
    // corrected. That is a regression, not an update.
    changes.push({
      kind: "regression",
      field: "category",
      from: catalogCategory,
      to: packageCategory,
      note: "a categoria publicada seria substituída"
    });
  }

  const catalogDestination = link?.destinationUrl ?? null;
  if (catalogDestination && catalogDestination !== acquisitionUrl) {
    let note = null;
    if (looksLikeCheckout(acquisitionUrl)) {
      note = "o destino publicado viraria um link de checkout";
    } else if (pathDepth(acquisitionUrl) < pathDepth(catalogDestination)) {
      note = "o destino publicado viraria uma página mais genérica";
    }
    changes.push({
      kind: note ? "regression" : "change",
      field: "destinationUrl",
      from: catalogDestination,
      to: acquisitionUrl,
      note
    });
  }

  return { recordId, state: INTAKE_STATES.ALREADY_LIVE, reasons: [], changes, product, link };
}

export function checkIntake(pkg, { products = [], links = [], verifications = {} } = {}) {
  const records = Array.isArray(pkg?.records)
    ? pkg.records.map((record) =>
        classifyRecord(record, {
          products,
          links,
          verification: verifications[record?.recordId] ?? null
        })
      )
    : [];

  const regressions = records.reduce(
    (total, entry) => total + entry.changes.filter((change) => change.kind === "regression").length,
    0
  );

  const summary = {
    total: records.length,
    publishable: records.filter((entry) => entry.state === INTAKE_STATES.PUBLISHABLE).length,
    alreadyLive: records.filter((entry) => entry.state === INTAKE_STATES.ALREADY_LIVE).length,
    blocked: records.filter((entry) => entry.state === INTAKE_STATES.BLOCKED).length,
    regressions
  };

  return { records, summary, verdict: intakeVerdict(summary) };
}

export function intakeVerdict(summary) {
  if (summary.publishable > 0) return INTAKE_VERDICTS.NEW_MATERIAL;
  if (summary.regressions > 0) return INTAKE_VERDICTS.REGRESSION_ONLY;
  if (summary.alreadyLive > 0) return INTAKE_VERDICTS.NOTHING_NEW;
  return INTAKE_VERDICTS.NOTHING_USABLE;
}

const VERDICT_TEXT = Object.freeze({
  [INTAKE_VERDICTS.NEW_MATERIAL]: "há material novo para publicar",
  [INTAKE_VERDICTS.REGRESSION_ONLY]: "nada novo, e importar reverteria o que está publicado",
  [INTAKE_VERDICTS.NOTHING_NEW]: "nada novo: tudo já está publicado",
  [INTAKE_VERDICTS.NOTHING_USABLE]: "nada publicável neste pacote"
});

const STATE_TEXT = Object.freeze({
  [INTAKE_STATES.PUBLISHABLE]: "PUBLICÁVEL",
  [INTAKE_STATES.ALREADY_LIVE]: "JÁ PUBLICADO",
  [INTAKE_STATES.BLOCKED]: "BLOQUEADO"
});

export function formatIntakeReport({ records, summary, verdict, verifications = {} }) {
  const lines = [];
  const width = Math.min(
    52,
    records.reduce((longest, entry) => Math.max(longest, entry.recordId.length), 0)
  );

  lines.push("Triagem de entrada do pacote");
  lines.push("");
  lines.push(
    `  ${summary.total} registro(s): ${summary.publishable} publicável(is), ` +
      `${summary.alreadyLive} já publicado(s), ${summary.blocked} bloqueado(s)`
  );
  if (summary.regressions > 0) {
    lines.push(`  ${summary.regressions} regressão(ões) detectada(s) contra o catálogo publicado`);
  }
  lines.push("");

  for (const entry of records) {
    lines.push(`  ${STATE_TEXT[entry.state].padEnd(13)} ${entry.recordId.slice(0, width)}`);
    for (const reason of entry.reasons) {
      lines.push(`      · ${reason}`);
    }
    for (const change of entry.changes) {
      const marker = change.kind === "regression" ? "REGRIDE" : "muda";
      lines.push(`      · ${marker} ${change.field}: ${change.from} -> ${change.to}`);
      if (change.note) lines.push(`        ${change.note}`);
    }
    const check = verifications[entry.recordId];
    if (check && check.ok && check.finalIsHomepage) {
      lines.push(`      · destino é a home da marca: ${check.finalUrl}`);
    } else if (check && check.ok && check.redirected) {
      lines.push(`      · destino redireciona para ${check.finalUrl}`);
    }
  }

  lines.push("");
  lines.push(`VEREDITO: ${VERDICT_TEXT[verdict]}`);
  return lines.join("\n");
}

async function readJson(filename) {
  return JSON.parse(await readFile(filename, "utf8"));
}

/**
 * Ask the destination whether it actually opens.
 *
 * A certificate that names a different domain is not a 404: DNS resolves, TCP
 * connects, and the browser still refuses the page. That is why this reports the
 * failure message rather than a status code alone.
 */
export async function verifyUrl(url, { fetchImpl, timeoutMs = 15000 } = {}) {
  const doFetch = fetchImpl ?? globalThis.fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await doFetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": "asp-intake-check" }
    });
    const finalUrl = response.url || url;
    return {
      ok: response.ok === true,
      status: response.status,
      redirected: finalUrl !== url,
      // The reader ends on the bare domain instead of the page that explains the
      // product. That holds whether the URL started there or redirected into it.
      finalIsHomepage: pathDepth(finalUrl) === 0,
      finalUrl,
      reason: response.ok === true ? null : `HTTP ${response.status}`
    };
  } catch (error) {
    const message = error?.cause?.code ?? error?.message ?? String(error);
    return {
      ok: false,
      status: 0,
      redirected: false,
      finalIsHomepage: false,
      finalUrl: url,
      reason: message
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Verify every record that carries a usable URL, keyed by recordId. */
export async function verifyAcquisitionUrls(pkg, options = {}) {
  const verifications = {};
  for (const record of Array.isArray(pkg?.records) ? pkg.records : []) {
    const url = typeof record?.acquisitionUrl === "string" ? record.acquisitionUrl.trim() : "";
    if (!/^https:\/\//i.test(url) || hasRedactionMarker(url)) continue;
    verifications[record.recordId] = await verifyUrl(url, options);
  }
  return verifications;
}

const USAGE = `ASP evidence package intake check

Usage:
  node scripts/intake-check.mjs --input <path> [--products <path>] [--links <path>] [--verify]

Options:
  --input <path>      Evidence package JSON to triage (required)
  --products <path>   Catalogue products (default: data/products.json)
  --links <path>      Catalogue affiliate links (default: data/affiliate-links.json)
  --verify            Also request each acquisition URL over the network
  --help              Show this message

Read-only. It validates structure, then classifies each record as publishable,
already live or blocked, and reports any change that would make the live site
worse. It never imports, adapts or publishes.

Without --verify the triage is offline and deterministic. With it, a destination
that does not open — including a certificate issued for another domain — blocks
the record, because a URL nobody can reach is not a source.`;

export function parseArgs(argv) {
  const options = {
    input: null,
    products: path.join(rootDirectory, "data", "products.json"),
    links: path.join(rootDirectory, "data", "affiliate-links.json"),
    verify: false,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    switch (argument) {
      case "--input":
        index += 1;
        if (index >= argv.length) throw new Error("--input requires a path.");
        options.input = argv[index];
        break;
      case "--products":
        index += 1;
        if (index >= argv.length) throw new Error("--products requires a path.");
        options.products = argv[index];
        break;
      case "--links":
        index += 1;
        if (index >= argv.length) throw new Error("--links requires a path.");
        options.links = argv[index];
        break;
      case "--verify":
        options.verify = true;
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      default:
        throw new Error(`Unrecognized argument: ${argument}`);
    }
  }

  return options;
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`ERROR INTAKE: ${error.message}`);
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }

  if (options.help) {
    console.log(USAGE);
    return;
  }

  if (!options.input) {
    console.error("ERROR INTAKE: --input is required.");
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }

  const pkg = await readJson(path.resolve(options.input));
  const products = await readJson(path.resolve(options.products));
  const links = await readJson(path.resolve(options.links));

  const validation = validateEvidencePackage(pkg);
  console.log(formatEvidencePackageReport(validation));
  console.log("");

  const verifications = options.verify ? await verifyAcquisitionUrls(pkg) : {};
  const result = checkIntake(pkg, { products, links, verifications });
  console.log(formatIntakeReport({ ...result, verifications }));

  // Structure errors keep a package out of the catalogue regardless of how mean
  // its content is; the exit code says so without hiding the triage above.
  if (validation.errors.length > 0) {
    process.exitCode = 1;
  }
}

const invokedDirectly =
  typeof process.argv[1] === "string" &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main().catch((error) => {
    console.error(`ERROR INTAKE: ${error.stack ?? error.message}`);
    process.exitCode = 1;
  });
}
