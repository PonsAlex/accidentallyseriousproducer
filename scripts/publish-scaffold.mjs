import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AFFILIATE_ID_PATTERN, isSafeHttpsUrl } from "../assets/affiliate-core.mjs";
import { formatValidationReport, validateAffiliateData } from "./affiliate-validation.mjs";

/**
 * Scaffold the three catalog records a block needs before it can be published:
 * one affiliate program, one product and one reviewed affiliate link.
 *
 * It fills everything from the validated editorial record and leaves exactly one
 * field for the human: the destination URL, which must be a real affiliate or
 * vendor URL. It never sets a Verdict, and its Status is a proposal computed from
 * the offer facts, not a decision.
 */

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const PUBLISH_SCAFFOLD_FORMAT = "asp-publish-scaffold";
export const PUBLISH_SCAFFOLD_VERSION = 1;

const DATA_FILES = Object.freeze({
  programs: "affiliate-programs.json",
  products: "products.json",
  links: "affiliate-links.json"
});

const USAGE = `ASP publish scaffold: catalog records for one editorial record

Usage:
  node scripts/publish-scaffold.mjs --records <path> --record <recordId> [options]

Options:
  --records <path>          Editorial records (jev:adapt output) (required)
  --record <recordId>       Which record to scaffold (required)
  --affiliate-url <url>     The reviewed destination. Without it the primary
                            evidence URL is used and the link stays unverified.
  --verified                Attest the destination and mark the link reviewed.
  --apply                   Merge the records into data/*.json and validate.
  --output <path>           Where to write the scaffold (default:
                            asp-publish-scaffold.json)
  --help                    Show this message

The Verdict is never set here. The Status is a proposal from the offer facts.
`;

export function parseArgs(argv) {
  const options = {
    records: null,
    record: null,
    affiliateUrl: null,
    verified: false,
    apply: false,
    output: "asp-publish-scaffold.json",
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
      case "--record":
        options.record = next();
        break;
      case "--affiliate-url":
        options.affiliateUrl = next();
        break;
      case "--verified":
        options.verified = true;
        break;
      case "--apply":
        options.apply = true;
        break;
      case "--output":
        options.output = next();
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

export function slugify(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function daysUntil(dateString, now) {
  if (typeof dateString !== "string") return null;
  const target = Date.parse(dateString.length === 10 ? `${dateString}T23:59:59Z` : dateString);
  if (!Number.isFinite(target)) return null;
  return (target - now.getTime()) / 86_400_000;
}

/**
 * Propose an editorial Status from the offer facts. Deterministic and explained
 * in the scaffold, because "automation may validate status conditions" but the
 * editor still confirms it.
 *
 * Accepts both shapes: editorial records keep the offer under `facts.offer` and
 * infer the nature from `permanent`, while a package record carries `offer` and
 * `offerNature` at the top level.
 */
export function proposeEditorialStatus(record, now = new Date()) {
  const offer = record?.facts?.offer ?? record?.offer ?? {};
  const nature = record?.offerNature ?? record?.facts?.offerNature ?? "";
  const deadline = offer.endsAt ?? offer.endsAtDate ?? null;
  const remaining = daysUntil(deadline, now);
  const isFree = offer.promoPrice === 0;

  if (offer.permanent === true || nature === "permanent-free") {
    return { status: "Free", reason: "permanent freeware has no deadline" };
  }
  if (nature === "launch-price") {
    return { status: "New Release", reason: "the offer is a launch price" };
  }
  if (remaining !== null) {
    if (remaining <= 1) return { status: "Call an Ambulance", reason: "the deadline is within 24 hours" };
    if (remaining <= 7) return { status: "Last Chance", reason: "the deadline is within a week" };
    if (isFree) return { status: "Free", reason: "free, with the deadline still ahead" };
    return { status: "", reason: "a paid offer with a distant deadline has no status condition yet" };
  }
  if (isFree) return { status: "Free", reason: "the price is zero and no deadline is declared" };
  return { status: "", reason: "no deadline and no free price: the status cannot be proposed" };
}

function primarySourceUrl(record) {
  // Editorial records carry `facts.sources` as plain URL strings; a package
  // record carries `evidence[]`. Accept both shapes.
  const sources = Array.isArray(record?.facts?.sources) ? record.facts.sources : [];
  const direct = sources.find((url) => isSafeHttpsUrl(url));
  if (direct) return direct;

  const evidence = Array.isArray(record?.evidence) ? record.evidence : [];
  const primary = evidence.find((entry) => entry?.role === "primary" && isSafeHttpsUrl(entry?.url));
  if (primary) return primary.url;
  const any = evidence.find((entry) => isSafeHttpsUrl(entry?.url));
  return any?.url ?? null;
}

export function buildScaffold(record, { affiliateUrl = null, verified = false } = {}) {
  const now = new Date();
  const stamp = now.toISOString();
  const developer = (record?.facts?.product?.developer ?? "").trim();
  const productName = (record?.facts?.product?.name ?? "").trim();

  if (developer === "" || productName === "") {
    throw new Error("The record needs facts.product.developer and facts.product.name to scaffold a catalog entry.");
  }

  const programId = slugify(developer);
  const productId = slugify(`${developer}-${productName}`);
  const linkId = `link-${productId}`;

  for (const [label, id] of [["programId", programId], ["productId", productId], ["linkId", linkId]]) {
    if (!AFFILIATE_ID_PATTERN.test(id)) {
      throw new Error(`${label} "${id}" is not a valid catalog id. Rename the product or developer slug.`);
    }
  }

  const sourceUrl = primarySourceUrl(record);
  const destinationUrl = affiliateUrl ?? sourceUrl;
  if (!isSafeHttpsUrl(destinationUrl)) {
    throw new Error(
      "No usable destination. Pass --affiliate-url with the reviewed https destination, or add a primary evidence URL to the record."
    );
  }

  const developerUrl = record?.facts?.sources?.find?.((url) => isSafeHttpsUrl(url)) ?? null;
  const programme = {
    id: programId,
    name: developer,
    homepage: developerUrl ?? new URL(sourceUrl).origin,
    affiliateDisclosureRequired: true,
    paidTrafficAllowed: false,
    status: "active"
  };

  const product = {
    id: productId,
    slug: productId,
    programId,
    name: productName,
    category: record?.facts?.product?.category ?? "plugin",
    description: record?.facts?.product?.description ?? productName,
    status: "active",
    createdAt: stamp,
    updatedAt: stamp
  };

  const link = {
    id: linkId,
    productId,
    programId,
    destinationUrl,
    fallbackUrl: programme.homepage,
    status: "active",
    requiresReview: !verified,
    lastVerifiedAt: stamp,
    allowFallback: true
  };

  const proposal = proposeEditorialStatus(record, now);
  const pending = [];

  if (!affiliateUrl) {
    pending.push(
      "The destination is the developer page from the record's evidence, not a real affiliate URL. Replace destinationUrl when a program approves you."
    );
  }
  if (!verified) {
    pending.push("The link is requiresReview: true, so it will not render until you re-run with --verified.");
  }
  pending.push("The Verdict is yours. This scaffold never sets it.");
  if (proposal.status === "") {
    pending.push(`No Status could be proposed: ${proposal.reason}.`);
  } else {
    pending.push(`Proposed Status "${proposal.status}" (${proposal.reason}). Confirm or change it.`);
  }

  return {
    recordId: record.recordId,
    program: programme,
    product,
    link,
    proposedStatus: proposal.status,
    proposedStatusReason: proposal.reason,
    pending
  };
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

export function mergeCatalogRecord(collection, record) {
  const index = collection.findIndex((entry) => entry.id === record.id);
  if (index === -1) {
    return { collection: [...collection, record], action: "added" };
  }
  const next = [...collection];
  next[index] = record;
  return { collection: next, action: "replaced" };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(USAGE);
    return;
  }
  if (!options.records) throw new Error("--records is required.");
  if (!options.record) throw new Error("--record is required.");

  const records = await readJson(options.records);
  const list = Array.isArray(records) ? records : records.records ?? [];
  const record = list.find((entry) => entry.recordId === options.record);
  if (!record) {
    throw new Error(
      `Record ${options.record} not found. Available: ${list.map((entry) => entry.recordId).join(", ") || "(none)"}.`
    );
  }

  const scaffold = buildScaffold(record, {
    affiliateUrl: options.affiliateUrl,
    verified: options.verified
  });

  const envelope = { format: PUBLISH_SCAFFOLD_FORMAT, formatVersion: PUBLISH_SCAFFOLD_VERSION, ...scaffold };
  const outputPath = path.resolve(rootDirectory, options.output);
  await writeFile(outputPath, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");

  console.log(`Scaffold written to ${path.relative(rootDirectory, outputPath)}:`);
  console.log(`  program : ${scaffold.program.id}  (${scaffold.program.name})`);
  console.log(`  product : ${scaffold.product.id}  (${scaffold.product.name})`);
  console.log(`  link    : ${scaffold.link.id}  -> ${scaffold.link.destinationUrl}`);
  console.log(`  link requiresReview: ${scaffold.link.requiresReview}`);
  console.log(`  proposed Status: ${scaffold.proposedStatus || "(none)"} — ${scaffold.proposedStatusReason}`);
  for (const note of scaffold.pending) console.warn(`WARN ${note}`);

  if (!options.apply) {
    console.log("Report only. Re-run with --apply to merge these into data/*.json.");
    return;
  }

  const [programs, products, links] = await Promise.all([
    readJson(path.join("data", DATA_FILES.programs)),
    readJson(path.join("data", DATA_FILES.products)),
    readJson(path.join("data", DATA_FILES.links))
  ]);

  const programResult = mergeCatalogRecord(programs, scaffold.program);
  const productResult = mergeCatalogRecord(products, scaffold.product);
  const linkResult = mergeCatalogRecord(links, scaffold.link);

  const data = {
    affiliatePrograms: programResult.collection,
    products: productResult.collection,
    affiliateLinks: linkResult.collection,
    promotions: await readJson(path.join("data", "promotions.json"))
  };

  const report = validateAffiliateData(data);
  if (report.errors.length > 0) {
    throw new Error(`Refusing to write: the merged data is invalid.\n${formatValidationReport(report)}`);
  }

  await Promise.all([
    writeFile(path.join(rootDirectory, "data", DATA_FILES.programs), `${JSON.stringify(programResult.collection, null, 2)}\n`, "utf8"),
    writeFile(path.join(rootDirectory, "data", DATA_FILES.products), `${JSON.stringify(productResult.collection, null, 2)}\n`, "utf8"),
    writeFile(path.join(rootDirectory, "data", DATA_FILES.links), `${JSON.stringify(linkResult.collection, null, 2)}\n`, "utf8")
  ]);

  console.log(
    `Merged into data/: program ${programResult.action}, product ${productResult.action}, link ${linkResult.action}.`
  );
  console.log("Run npm run lint && npm run build before committing.");
}

const invokedDirectly =
  typeof process.argv[1] === "string" &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main().catch((error) => {
    console.error(`ERROR SCAFFOLD: ${error.stack ?? error.message}`);
    process.exitCode = 1;
  });
}
