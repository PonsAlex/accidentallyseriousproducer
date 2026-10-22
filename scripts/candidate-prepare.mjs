import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * PREPARAÇÃO: open the vendor page behind each lead and read the offer off it.
 *
 * An email is a lead. This step is the only one allowed to turn a lead into a
 * record, and it may only use what the page itself states. When the page is
 * missing, unreachable, or about a different product, the candidate stays
 * unverified — the bridge will refuse it, which is the intended outcome.
 */

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "free", "new", "now", "get", "your", "our",
  "off", "sale", "sales", "deal", "deals", "plugin", "plugins", "audio", "pro", "plus",
  "edition", "collection", "bundle", "pack", "presets", "update", "updates",
  "discount", "discounts", "save", "offer", "offers", "gear", "news", "awards",
  "annual", "storewide", "percent", "your", "week", "days"
]);

export const PREPARE_STATES = Object.freeze({
  VERIFIED: "verified",
  UNREACHABLE: "unreachable",
  OFF_TOPIC: "off-topic",
  NO_URL: "no-url"
});

function normalize(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** Significant tokens of a product name, longest first. */
export function nameTokens(name) {
  return normalize(name)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 4 && !STOPWORDS.has(token));
}

/**
 * Subjects are written as sentences. "presets in Ostinato Seventeen scales in
 * Chords" is not a product name, and no page can be verified against it. A
 * name with a connector word, punctuation or too many words is refused rather
 * than guessed at.
 */
const SENTENCE_CONNECTORS =
  /\b(in|of|to|for|with|from|and|the|is|are|behind|whats|your|our)\b/i;

export function looksLikeSentence(name) {
  const value = String(name ?? "").trim();
  if (value === "") return false;
  if (/[:;!?"$%]/.test(value)) return true;
  if (SENTENCE_CONNECTORS.test(value)) return true;
  return nameTokens(value).length > 5;
}

/** Does the page look like it is about this product? */
export function pageMentionsProduct(html, name) {
  const tokens = nameTokens(name);
  if (tokens.length === 0) return false;
  const text = normalize(stripTags(html)).slice(0, 20000);
  return tokens.some((token) => text.includes(token));
}

function stripTags(html) {
  return String(html ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}

function decodeEntities(value) {
  return String(value ?? "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

export function pageTitle(html) {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return match ? decodeEntities(match[1].replace(/\s+/g, " ")).trim() : null;
}

/**
 * Structured offer data, when the page publishes it. Shopify, WooCommerce and
 * most storefronts emit schema.org Offer with a real price; a page that does not
 * is left to a human, because guessing a price from prose is how discounts get
 * invented.
 */
export function extractJsonLdOffer(html) {
  const blocks = [...String(html ?? "").matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  )];

  for (const block of blocks) {
    let parsed;
    try {
      parsed = JSON.parse(block[1]);
    } catch {
      continue;
    }

    const queue = Array.isArray(parsed) ? [...parsed] : [parsed];
    while (queue.length > 0) {
      const node = queue.shift();
      if (!node || typeof node !== "object") continue;

      if (Array.isArray(node["@graph"])) queue.push(...node["@graph"]);
      if (Array.isArray(node.offers)) queue.push(...node.offers);
      else if (node.offers && typeof node.offers === "object") queue.push(node.offers);

      if (typeof node.price === "number" || (typeof node.price === "string" && node.price !== "")) {
        return {
          price: Number(node.price),
          currency: typeof node.priceCurrency === "string" ? node.priceCurrency : null,
          priceValidUntil: typeof node.priceValidUntil === "string" ? node.priceValidUntil : null
        };
      }
    }
  }

  return null;
}

/** A "was X, now Y" pair, only when the page shows both numbers as an offer. */
export function extractPriceMeta(html) {
  const amount = /<meta[^>]+property=["']product:price:amount["'][^>]+content=["']([^"']+)["']/i.exec(html);
  const currency = /<meta[^>]+property=["']product:price:currency["'][^>]+content=["']([^"']+)["']/i.exec(html);
  if (!amount) return null;
  const price = Number(String(amount[1]).replace(/[^0-9.]/g, ""));
  return Number.isFinite(price) ? { price, currency: currency ? currency[1] : null, priceValidUntil: null } : null;
}

export async function fetchPage(url, { fetchImpl, timeoutMs = 20000 } = {}) {
  const doFetch = fetchImpl ?? globalThis.fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await doFetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": "asp-preparacao/1.0" }
    });
    const html = await response.text();
    return {
      ok: response.ok === true,
      status: response.status,
      finalUrl: response.url || url,
      html
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      finalUrl: url,
      html: "",
      reason: error?.cause?.code ?? error?.message ?? String(error)
    };
  } finally {
    clearTimeout(timer);
  }
}

function siteHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\d*\./i, "").toLowerCase();
  } catch {
    return null;
  }
}

function sameSite(left, right) {
  const a = siteHost(left);
  const b = siteHost(right);
  return a !== null && a === b;
}

/**
 * Stores and marketplaces are not the vendor's own page. A click-tracker that
 * lands on one of them tells us the deal exists, not what the vendor charges.
 */
const RESELLER_HOSTS = Object.freeze([
  /(^|\.)pluginboutique\.com$/i,
  /(^|\.)adsrsounds\.com$/i,
  /(^|\.)bestservice\.com$/i,
  /(^|\.)plugivery\.com$/i,
  /(^|\.)gearspace\.com$/i,
  /(^|\.)kvraudio\.com$/i,
  /(^|\.)audio-plugin\.de$/i,
  /(^|\.)plugin\.deals$/i,
  /(^|\.)audioplugin\.deals$/i,
  /(^|\.)sweetwater\.com$/i,
  /(^|\.)thomann\.de$/i,
  /(^|\.)amazon\./i,
  /(^|\.)gumroad\.com$/i
]);

function isReseller(url) {
  const host = siteHost(url);
  return host !== null && RESELLER_HOSTS.some((pattern) => pattern.test(host));
}

/**
 * Decide, from one fetched page, whether the candidate is now verified. Returns a
 * patch plus the reason, and never raises a confidence it cannot justify.
 *
 * A redirect is not a rejection: an email often links through a campaign domain,
 * and what matters is where it lands. The page that was actually read becomes the
 * evidence URL, so the record points at something a reader can open.
 */
export function assessCandidate(candidate, page, { now = new Date() } = {}) {
  const url = candidate?.links?.sourceUrl ?? null;
  const name = candidate?.product?.name ?? "";

  if (!url) {
    return { state: PREPARE_STATES.NO_URL, reason: "O email não trouxe página do fabricante." };
  }
  if (nameTokens(name).length === 0) {
    return {
      state: PREPARE_STATES.OFF_TOPIC,
      reason: `O nome extraído do email ("${name}") não identifica um produto.`
    };
  }
  if (looksLikeSentence(name)) {
    return {
      state: PREPARE_STATES.OFF_TOPIC,
      reason: `O email não nomeia um produto, e sim uma frase ("${name.slice(0, 60)}"). Sem nome, a página não pode ser conferida.`
    };
  }
  if (!page.ok) {
    return { state: PREPARE_STATES.UNREACHABLE, reason: `A página não respondeu (${page.status || page.reason}).` };
  }
  if (isReseller(page.finalUrl)) {
    return {
      state: PREPARE_STATES.OFF_TOPIC,
      reason: `A página final é uma loja, não o fabricante: ${page.finalUrl}`
    };
  }
  if (!pageMentionsProduct(page.html, name)) {
    const elsewhere = sameSite(url, page.finalUrl) ? "" : ` (o link levou a ${page.finalUrl})`;
    return {
      state: PREPARE_STATES.OFF_TOPIC,
      reason: `A página não menciona o produto${elsewhere}.`
    };
  }

  const offer = extractJsonLdOffer(page.html) ?? extractPriceMeta(page.html);
  const title = pageTitle(page.html);
  const date = now.toISOString().slice(0, 10);
  const evidenceUrl = page.finalUrl || url;

  const patch = {
    primarySourceFound: true,
    evidence: [
      {
        role: "primary",
        name: title || evidenceUrl,
        url: evidenceUrl,
        date,
        fact: offer && Number.isFinite(offer.price)
          ? `Página do fabricante com preço publicado: ${offer.price}${offer.currency ? ` ${offer.currency}` : ""}.`
          : "Página do fabricante do produto confirmada; a oferta não foi lida dela."
      }
    ],
    confidence: {
      ...candidate.confidence,
      link: "high",
      product: "high",
      price: offer && Number.isFinite(offer.price) ? "high" : "low",
      dates: "low"
    },
    links: {
      ...candidate.links,
      resolvedUrl: evidenceUrl,
      developerOfficialUrl: candidate.links?.developerOfficialUrl ?? new URL(evidenceUrl).origin
    }
  };

  if (offer && Number.isFinite(offer.price)) {
    patch.offer = {
      ...candidate.offer,
      promoPrice: offer.price,
      currency: offer.currency ?? candidate.offer?.currency ?? null
    };
  }

  // `priceValidUntil` is frequently a template default — UJAM published 2028-01-01
  // while the real deadline lived in a script. It is recorded for review, never
  // used as the deadline.
  return {
    state: PREPARE_STATES.VERIFIED,
    reason: offer ? "Preço publicado na página." : "Produto confirmado; preço não publicado.",
    priceValidUntilHint: offer?.priceValidUntil ?? null,
    patch
  };
}

export async function prepareCandidates(candidates, { fetchImpl, now = new Date(), concurrency = 5, onProgress } = {}) {
  const results = [];
  const prepared = [];

  for (let index = 0; index < candidates.length; index += concurrency) {
    const batch = candidates.slice(index, index + concurrency);
    const assessed = await Promise.all(
      batch.map(async (candidate) => {
        const url = candidate?.links?.sourceUrl ?? null;
        if (!url) {
          return { candidate, ...assessCandidate(candidate, { ok: false, status: 0, html: "" }, { now }) };
        }
        const page = await fetchPage(url, { fetchImpl });
        return { candidate, page, ...assessCandidate(candidate, page, { now }) };
      })
    );

    for (const entry of assessed) {
      results.push({
        candidateId: entry.candidate.candidateId,
        state: entry.state,
        reason: entry.reason,
        url: entry.candidate.links?.sourceUrl ?? null,
        priceValidUntilHint: entry.priceValidUntilHint ?? null
      });
      prepared.push(entry.patch ? { ...entry.candidate, ...entry.patch } : entry.candidate);
      if (onProgress) onProgress(results.length, candidates.length);
    }
  }

  return { prepared, results };
}

export function summarise(results) {
  const counts = Object.fromEntries(Object.values(PREPARE_STATES).map((state) => [state, 0]));
  for (const result of results) counts[result.state] = (counts[result.state] ?? 0) + 1;
  return { total: results.length, ...counts };
}

export function formatReport(summary) {
  return [
    `Preparação: ${summary.total} lead(s)`,
    `  verificados (página do fabricante) : ${summary.verified}`,
    `  página fora do assunto             : ${summary["off-topic"]}`,
    `  não responderam                    : ${summary.unreachable}`,
    `  sem URL                            : ${summary["no-url"]}`,
    "",
    "Só os verificados podem virar pacote. O resto continua lead."
  ].join("\n");
}

const USAGE = `ASP preparação: read the offer off each lead's vendor page

Usage:
  node scripts/candidate-prepare.mjs [--input <path>] [--output <path>]
                                     [--report <path>] [--top <n>] [--now <date>]

Options:
  --input <path>    Candidates JSON (default: asp-candidates.json)
  --output <path>   Prepared candidates (default: asp-candidates-prepared.json)
  --report <path>   Per-candidate report (default: asp-candidate-prepare-report.json)
  --top <n>         How many leads to open (default: 40)
  --now <date>      Pretend it is this date
  --help            Show this message

Reads the open web, writes only local JSON. A candidate is verified only when the
page loads, stays on the vendor's domain, and mentions the product.`;

export function parseArgs(argv) {
  const options = {
    input: path.join(rootDirectory, "asp-candidates.json"),
    output: path.join(rootDirectory, "asp-candidates-prepared.json"),
    report: path.join(rootDirectory, "asp-candidate-prepare-report.json"),
    top: 40,
    now: null,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    switch (argument) {
      case "--input":
        index += 1;
        options.input = path.resolve(rootDirectory, argv[index]);
        break;
      case "--output":
        index += 1;
        options.output = path.resolve(rootDirectory, argv[index]);
        break;
      case "--report":
        index += 1;
        options.report = path.resolve(rootDirectory, argv[index]);
        break;
      case "--top":
        index += 1;
        options.top = Number(argv[index]);
        if (!Number.isInteger(options.top) || options.top <= 0) throw new Error("--top requires a positive integer.");
        break;
      case "--now":
        index += 1;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(argv[index] ?? "")) throw new Error("--now requires a calendar date.");
        options.now = argv[index];
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
    console.error(`ERROR PREPARE: ${error.message}`);
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }

  if (options.help) {
    console.log(USAGE);
    return;
  }

  const candidates = JSON.parse(await readFile(options.input, "utf8"));
  const slice = candidates.slice(0, options.top);
  const now = options.now ? new Date(`${options.now}T12:00:00`) : new Date();

  const { prepared, results } = await prepareCandidates(slice, {
    now,
    onProgress: (done, total) => {
      if (done % 5 === 0 || done === total) console.error(`  ${done}/${total}`);
    }
  });

  await writeFile(options.output, `${JSON.stringify(prepared, null, 2)}\n`, "utf8");
  await writeFile(options.report, `${JSON.stringify({ generatedFor: now.toISOString().slice(0, 10), results }, null, 2)}\n`, "utf8");

  console.log(formatReport(summarise(results)));
  console.log(`\nPreparados: ${path.relative(rootDirectory, options.output)}`);
  console.log(`Relatório:  ${path.relative(rootDirectory, options.report)}`);
}

const invokedDirectly =
  typeof process.argv[1] === "string" &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main().catch((error) => {
    console.error(`ERROR PREPARE: ${error.stack ?? error.message}`);
    process.exitCode = 1;
  });
}
