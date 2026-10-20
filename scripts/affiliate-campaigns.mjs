import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Import a Post Affiliate Pro campaign grid export into the ASP catalog shape.
 *
 * The export is a semicolon-delimited CSV with quoted fields that contain
 * embedded newlines and escaped quotes, so it cannot be read line by line.
 * Descriptions also arrive as HubSpot HTML soup and are stripped here.
 *
 * What this file deliberately does NOT produce is a URL. The grid carries
 * campaign ids, not click links, and inventing a URL pattern would put an
 * unverified destination in front of a reader.
 */

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const CAMPAIGNS_FORMAT = "asp-affiliate-campaigns";
export const CAMPAIGNS_FORMAT_VERSION = 1;

/**
 * RFC 4180-ish parser for a single-character delimiter. Handles quoted fields,
 * doubled quotes and newlines inside quotes.
 */
export function parseDelimited(text, { delimiter = ";" } = {}) {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];

    if (inQuotes) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"') {
      inQuotes = true;
    } else if (character === delimiter) {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (character !== "\r") {
      field += character;
    }
  }

  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

/** Strip tags and decode the handful of entities that show up in these exports. */
export function stripHtml(value) {
  return String(value ?? "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function number(value) {
  const parsed = Number(String(value ?? "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

/** Commission strings look like `per Sale: 25% / 10%` or `per Sale: 25%`. */
export function parseCommission(value) {
  const text = String(value ?? "").trim();
  const match = text.match(/(\d+(?:\.\d+)?)\s*%(?:\s*\/\s*(\d+(?:\.\d+)?)\s*%)?/);
  if (!match) return { raw: text, perSale: null, tiered: null };
  return {
    raw: text,
    perSale: Number(match[1]),
    // The second figure is optional: some campaigns pay a flat rate.
    tiered: match[2] === undefined ? null : Number(match[2])
  };
}

/**
 * Turn parsed rows into campaign records. The header names come from the export,
 * so this maps them explicitly rather than trusting column order.
 */
export function normalizeCampaigns(rows) {
  const [header, ...body] = rows;
  if (!header || header.length === 0) {
    throw new Error("The export has no header row.");
  }

  const index = new Map(header.map((name, position) => [stripHtml(name), position]));
  const required = ["ID", "Name", "Status", "affstatus", "Cookie lifetime", "Commissions"];
  for (const field of required) {
    if (!index.has(field)) throw new Error(`The export is missing the "${field}" column.`);
  }

  const campaigns = [];
  for (const row of body) {
    // Skip the blank tail row a trailing newline can produce.
    if (row.length === 1 && row[0].trim() === "") continue;

    const get = (name) => (index.has(name) ? row[index.get(name)] : undefined);
    const id = String(get("ID") ?? "").trim();
    if (id === "") continue;

    const name = stripHtml(get("Name"));
    const commission = parseCommission(get("Commissions"));

    campaigns.push({
      campaignId: id,
      name,
      description: stripHtml(get("description")),
      status: String(get("Status") ?? "").trim(),
      affiliateStatus: String(get("affstatus") ?? "").trim(),
      cookieLifetimeDays: number(get("Cookie lifetime")),
      bannerCount: number(get("banners")),
      commission,
      // Everything below needs a human or a source that is not this export.
      linkTemplate: null,
      destinationUrl: null,
      productId: null
    });
  }

  if (campaigns.length === 0) throw new Error("No campaign rows were found in the export.");
  return campaigns;
}

/** Group the WA `WAProd - X` campaigns apart from the product campaigns. */
export function classifyCampaigns(campaigns) {
  return campaigns.map((campaign) => ({
    ...campaign,
    kind: /^WAProd\s*-/i.test(campaign.name) ? "section" : "product",
    section: /^WAProd\s*-\s*(.+)$/i.exec(campaign.name)?.[1]?.trim() ?? null
  }));
}

export const WA_ORIGIN = "https://www.waproduction.com";

/** WA store paths mapped onto the board's product categories. */
export const WA_SECTION_CATEGORIES = Object.freeze({
  plugins: "plugin",
  bundles: "bundle",
  sounds: "sample-pack",
  courses: "course",
  "daw-templates": "other"
});

/**
 * Read a WA product link and pull it apart.
 *
 * The name is NOT derived from the slug here: the caller supplies the name it
 * verified on the page, so a wrong slug can never become a wrong public title.
 */
export function parseWaProductLink(url, { name } = {}) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Not a URL: ${JSON.stringify(url)}`);
  }
  if (parsed.origin !== WA_ORIGIN) {
    throw new Error(`Only ${WA_ORIGIN} links are accepted (got ${parsed.origin}).`);
  }

  const match = /^\/([a-z0-9-]+)\/view\/([a-z0-9-]+)\/?$/.exec(parsed.pathname);
  if (!match) {
    throw new Error(`Expected a product path like /plugins/view/<slug> (got ${parsed.pathname}).`);
  }

  const [, section, slug] = match;
  const category = WA_SECTION_CATEGORIES[section];
  if (!category) throw new Error(`Unknown WA section "${section}".`);

  const params = new URLSearchParams(parsed.hash.replace(/^#/, ""));
  const affiliateId = params.get("a_aid");
  const bannerId = params.get("a_bid");
  if (!affiliateId) throw new Error("The link has no a_aid; it does not identify the affiliate.");
  if (!bannerId) throw new Error("The link has no a_bid; it does not attribute the click.");

  const clean = String(name ?? "").trim();
  if (clean === "") {
    throw new Error(`A verified name is required for ${slug}; it is not derived from the slug.`);
  }

  return {
    slug,
    section,
    category,
    affiliateId,
    bannerId,
    name: clean,
    landingPath: parsed.pathname,
    destinationUrl: `${WA_ORIGIN}${parsed.pathname}#a_aid=${affiliateId}&a_bid=${bannerId}`,
    fallbackUrl: `${WA_ORIGIN}/${section}/`
  };
}

/**
 * Turn verified product links into catalog records: products plus the reviewed
 * affiliate link each one needs. Ids are prefixed so a WA product can never
 * collide with a developer's product of the same slug.
 */
export function buildProductRecords(entries, { programId = "wa-production", verifiedAt = new Date().toISOString() } = {}) {
  if (!Array.isArray(entries) || entries.length === 0) throw new Error("No product links were supplied.");

  const products = [];
  const affiliateLinks = [];
  const seen = new Set();

  for (const entry of entries) {
    const parsed = parseWaProductLink(entry.url, { name: entry.name });
    const productId = `${programId}-${parsed.slug}`;
    if (seen.has(productId)) throw new Error(`Duplicate product id ${productId}.`);
    seen.add(productId);

    products.push({
      id: productId,
      slug: parsed.slug,
      programId,
      name: parsed.name,
      category: parsed.category,
      description: parsed.name,
      status: "active",
      createdAt: verifiedAt,
      updatedAt: verifiedAt
    });

    affiliateLinks.push({
      id: `link-${productId}`,
      productId,
      programId,
      destinationUrl: parsed.destinationUrl,
      fallbackUrl: parsed.fallbackUrl,
      status: "active",
      requiresReview: false,
      lastVerifiedAt: verifiedAt,
      allowFallback: true
    });
  }

  return { products, affiliateLinks };
}

/**
 * Build a Post Affiliate Pro click URL.
 *
 * `a_aid` is the affiliate (constant for the account); `a_bid` is the banner id,
 * which selects the creative and therefore the landing page. Neither is the
 * campaign id — the grid export only carries those.
 *
 * Everything is validated: a link is a destination in front of a reader, so an
 * unusable one is an error rather than a string to find out about later.
 */
export function buildAffiliateLink({ path, bannerId, affiliateId } = {}) {
  if (typeof affiliateId !== "string" || !/^[a-z0-9]{8,32}$/i.test(affiliateId)) {
    throw new Error(`A valid affiliate id is required (got ${JSON.stringify(affiliateId)}).`);
  }
  if (typeof bannerId !== "string" || !/^[a-z0-9]{6,32}$/i.test(bannerId)) {
    throw new Error(`A valid banner id is required (got ${JSON.stringify(bannerId)}).`);
  }
  if (typeof path !== "string" || !path.startsWith("/")) {
    throw new Error(`The landing path must start with "/" (got ${JSON.stringify(path)}).`);
  }
  return `${WA_ORIGIN}${path}#a_aid=${affiliateId}&a_bid=${bannerId}`;
}

/**
 * Apply known banner links. A link either names a campaign it belongs to, or it
 * stands alone as a section banner the export does not describe.
 */
export function attachLinks(document, links, { affiliateId } = {}) {
  if (!Array.isArray(links) || links.length === 0) return document;

  const byCampaign = new Map();
  const standalone = [];

  for (const link of links) {
    const destinationUrl = buildAffiliateLink({
      path: link.path,
      bannerId: link.bannerId,
      affiliateId,
    });
    if (link.campaignId) {
      byCampaign.set(link.campaignId, { ...link, destinationUrl });
    } else {
      standalone.push({ ...link, destinationUrl });
    }
  }

  const campaigns = document.campaigns.map((campaign) => {
    const match = byCampaign.get(campaign.campaignId);
    if (!match) return campaign;
    return {
      ...campaign,
      destinationUrl: match.destinationUrl,
      bannerId: match.bannerId,
      landingPath: match.path,
      linkTemplate: `${WA_ORIGIN}{path}#a_aid=${affiliateId}&a_bid={bannerId}`,
    };
  });

  const unmatchedCampaigns = [...byCampaign.keys()].filter(
    (campaignId) => !document.campaigns.some((campaign) => campaign.campaignId === campaignId)
  );
  if (unmatchedCampaigns.length > 0) {
    throw new Error(`Links reference unknown campaign id(s): ${unmatchedCampaigns.join(", ")}.`);
  }

  return {
    ...document,
    linkTemplate: `${WA_ORIGIN}{path}#a_aid=${affiliateId}&a_bid={bannerId}`,
    affiliateId,
    standaloneLinks: standalone,
    campaigns,
  };
}

export function buildCampaignsDocument(campaigns, { source = null, importedAt = new Date().toISOString() } = {}) {
  const classified = classifyCampaigns(campaigns);
  return {
    format: CAMPAIGNS_FORMAT,
    formatVersion: CAMPAIGNS_FORMAT_VERSION,
    source,
    importedAt,
    programId: "wa-production",
    // Not derivable from the export: the affiliate's click URL for a campaign.
    linkTemplate: null,
    campaigns: classified
  };
}

export function summarize(document) {
  const total = document.campaigns.length;
  const sections = document.campaigns.filter((entry) => entry.kind === "section");
  const products = document.campaigns.filter((entry) => entry.kind === "product");
  const active = document.campaigns.filter((entry) => entry.status === "A").length;
  const linked = document.campaigns.filter((entry) => typeof entry.destinationUrl === "string").length;
  const best = document.campaigns.reduce(
    (top, entry) => (entry.commission.perSale ?? -1) > (top?.commission.perSale ?? -1) ? entry : top,
    null
  );
  const banners = document.campaigns.reduce((sum, entry) => sum + (entry.bannerCount ?? 0), 0);
  return { total, sections: sections.length, products: products.length, active, linked, best, banners };
}

const USAGE = `ASP affiliate campaign import (Post Affiliate Pro grid export)

Usage:
  node scripts/affiliate-campaigns.mjs --input <export.csv> [options]

Options:
  --input <path>        The grid export (required)
  --output <path>       Normalised JSON (default: asp-affiliate-campaigns.json)
  --affiliate-id <id>   The a_aid value from a real click link
  --links <path>        JSON array of banner links to attach:
                        [{ "path": "/bundles", "bannerId": "11d8a200" }]
                        Add "campaignId" to bind a link to a campaign.
  --help                Show this message

The export carries campaign ids, not click links. Without --affiliate-id and
--links this command writes \`linkTemplate: null\` rather than invent a URL.
`;

export function parseArgs(argv) {
  const options = {
    input: null,
    output: "asp-affiliate-campaigns.json",
    affiliateId: null,
    links: null,
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
      case "--affiliate-id":
        options.affiliateId = next();
        break;
      case "--links":
        options.links = next();
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
  if (!options.input) throw new Error("--input is required.");

  const absolute = path.resolve(rootDirectory, options.input);
  const text = await readFile(absolute, "utf8");
  const rows = parseDelimited(text);

  let document = buildCampaignsDocument(normalizeCampaigns(rows), {
    source: path.basename(absolute)
  });

  if (options.links) {
    if (!options.affiliateId) {
      throw new Error("--affiliate-id is required when --links is used: a_bid alone does not identify the affiliate.");
    }
    const linksPath = path.resolve(rootDirectory, options.links);
    const links = JSON.parse(await readFile(linksPath, "utf8"));
    document = attachLinks(document, links, { affiliateId: options.affiliateId });
  }

  const outputPath = path.resolve(rootDirectory, options.output);
  await writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");

  const summary = summarize(document);
  console.log(`${summary.total} campaign(s): ${summary.sections} section, ${summary.products} product, ${summary.active} active.`);
  console.log(`Banner assets referenced: ${summary.banners}. Links attached: ${summary.linked} campaign(s) + ${(document.standaloneLinks ?? []).length} standalone.`);
  if (summary.best) {
    console.log(
      `Highest commission: "${summary.best.name}" at ${summary.best.commission.perSale}% / ${summary.best.commission.tiered}%.`
    );
  }
  console.log(`Written to ${path.relative(rootDirectory, outputPath)}.`);
  if (!document.linkTemplate) {
    console.warn("WARN linkTemplate is null: the export has no click URLs. Supply the real pattern before linking.");
  }
  const withoutLink = document.campaigns.length - summary.linked;
  if (withoutLink > 0) {
    console.warn(`WARN ${withoutLink} campaign(s) still have no destination: the export has banner counts, not banner ids.`);
  }
}

const invokedDirectly =
  typeof process.argv[1] === "string" &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main().catch((error) => {
    console.error(`ERROR CAMPAIGNS: ${error.stack ?? error.message}`);
    process.exitCode = 1;
  });
}
