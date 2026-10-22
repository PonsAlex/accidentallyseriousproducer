import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Turn the Outlook promotions feed into candidate leads.
 *
 * This is the first stage only. An email is not a citable source: the bridge
 * refuses a candidate without an https page, and it should. So the adapter's job
 * is to say "here is a lead, here is the vendor page if the email carried one,
 * here is what the email claimed" — and then stop. The offer is read from the
 * vendor page, by a person or by a verified fetch, never from the email.
 */

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const DEFAULT_FEED =
  process.env.ODYSSEUS_OUTLOOK_FEED_PATH ??
  "G:\\ODYSSEUS\\data\\outlook_odysseus_bridge\\odysseus_mail_feed.json";

/**
 * Hosts that carry a redirect, a report action or an open-pixel. A link through
 * one of these reaches the vendor only after a hop the email does not describe.
 */
const TRACKING_HOSTS = Object.freeze([
  /(^|\.)duckduckgo\.com$/i,
  /mailchi\.mp$/i,
  /list-manage\.com$/i,
  /sendgrid\.net$/i,
  /hubspotlinks\.com$/i,
  /customeriomail\.com$/i,
  /awstrack\.me$/i,
  /mandrillapp\.com$/i,
  /rs6\.net$/i,
  /kit-mail\d*\.com$/i,
  /(^|\.)click\./i,
  /(^|\.)links?\.(mail|email)\./i,
  /(^|\.)notifications\./i,
  /(^|\.)email\./i
]);

/** Paths that mark a link as a click-tracker rather than a destination. */
const TRACKING_PATHS = Object.freeze([
  /^\/cl\//i,
  /^\/tl\/c\//i,
  /^\/gp\/cl\//i,
  /^\/gh\/cl\//i,
  /^\/e5u/i,
  /\/report(-spam)?#/i
]);

const MONTHS = Object.freeze({
  janeiro: 1,
  fevereiro: 2,
  março: 3,
  marco: 3,
  abril: 4,
  maio: 5,
  junho: 6,
  julho: 7,
  agosto: 8,
  setembro: 9,
  outubro: 10,
  novembro: 11,
  dezembro: 12
});

export function slug(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 60)
    .replace(/^-+|-+$/g, "");
}

/** "quinta-feira, 22 de outubro de 2026 13:33:06" -> Date (local), or null. */
export function parseReceivedAt(value) {
  const match = /(\d{1,2})\s+de\s+([a-zç]+)\s+de\s+(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/i.exec(
    String(value ?? "")
  );
  if (!match) return null;
  const month = MONTHS[match[2].toLowerCase()];
  if (!month) return null;
  return new Date(
    Number(match[3]),
    month - 1,
    Number(match[1]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6])
  );
}

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function pathOf(url) {
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
}

/** The sender's own domain, from an address masked as noreply_at_acme.com_x@duck.com. */
export function senderDomain(fromEmail, fromName) {
  const masked = /_at_([a-z0-9.-]+\.[a-z]{2,})_/i.exec(String(fromEmail ?? ""));
  if (masked) return masked[1].toLowerCase();
  const plain = /@([a-z0-9.-]+\.[a-z]{2,})/i.exec(String(fromEmail ?? ""));
  if (plain && !/duck\.com$/i.test(plain[1])) return plain[1].toLowerCase();
  return null;
}

export function isTrackingUrl(url) {
  const host = hostOf(url);
  if (!host) return true;
  if (TRACKING_HOSTS.some((pattern) => pattern.test(host))) return true;
  const pathname = pathOf(url);
  return TRACKING_PATHS.some((pattern) => pattern.test(pathname));
}

/** Every URL the email carried, deduplicated. The feed stores these as an array. */
export function urlsFrom(item) {
  const raw = item?.links;
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? (raw.match(/https?:\/\/[^\s"'<>)\],]+/g) ?? [])
      : [];
  return [
    ...new Set(
      list.filter((url) => typeof url === "string" && /^https?:\/\//i.test(url))
    )
  ];
}

/**
 * The best vendor page the email offers: a non-tracking link on the sender's own
 * domain, deepest path first. Returns null when the email only carried redirects,
 * which is common and means the lead needs the vendor looked up by hand.
 */
export function extractVendorUrl(item) {
  const domain = senderDomain(item?.from_email, item?.from_name);
  const candidates = urlsFrom(item).filter((url) => !isTrackingUrl(url));
  if (candidates.length === 0) return null;

  const onDomain = domain
    ? candidates.filter((url) => {
        const host = hostOf(url);
        return host === domain || host?.endsWith(`.${domain}`);
      })
    : [];

  const pool = onDomain.length > 0 ? onDomain : candidates;
  return pool
    .slice()
    .sort((left, right) => pathOf(right).split("/").filter(Boolean).length -
      pathOf(left).split("/").filter(Boolean).length)[0];
}

function firstNumber(value) {
  const match = /(\d+(?:[.,]\d{1,2})?)/.exec(String(value ?? ""));
  if (!match) return null;
  const number = Number(match[1].replace(",", "."));
  return Number.isFinite(number) ? number : null;
}

function deadlineToDate(value) {
  const iso = /\b(\d{4}-\d{2}-\d{2})\b/.exec(String(value ?? ""));
  if (iso) return iso[1];

  const full = parseReceivedAt(value);
  if (full) return full.toISOString().slice(0, 10);

  // "18 de outubro de 2026" — a deadline without a time is still a deadline.
  const dateOnly = /(\d{1,2})\s+de\s+([a-zç]+)\s+de\s+(\d{4})/i.exec(String(value ?? ""));
  const month = dateOnly ? MONTHS[dateOnly[2].toLowerCase()] : undefined;
  if (!month) return null;
  return `${dateOnly[3]}-${String(month).padStart(2, "0")}-${String(dateOnly[1]).padStart(2, "0")}`;
}

function discountPercent(value) {
  const match = /(\d{1,2})\s*%/i.exec(String(value ?? ""));
  if (!match) return null;
  const percent = Number(match[1]);
  return percent > 0 && percent <= 100 ? percent : null;
}

/**
 * A candidate in the shape `candidate:to-package` reads, matching
 * docs/examples/odysseus-candidate.example.json.
 *
 * Everything the email claimed is recorded as a low-confidence hypothesis, not
 * as a fact: `primarySourceFound` stays false and `evidence` stays empty, so the
 * bridge refuses the candidate until the vendor page has been read. That is the
 * boundary the project already drew — "an email link alone is not a citable
 * source" — and this adapter does not get to cross it.
 */
export function buildCandidate(item, { vendorUrl = null } = {}) {
  const developer = (item.detected_developer || item.from_name || "").trim();
  const productHint = (item.detected_plugin || item.subject || "").trim();
  const discount = String(item.detected_discount ?? "").trim();
  const price = String(item.detected_price ?? "").trim();
  const deadline = String(item.detected_deadline ?? "").trim();
  const free = /free|gr[aá]tis/i.test(discount) || /^(free|0)/i.test(price);
  const percent = discountPercent(discount);
  const endsAtDate = deadlineToDate(deadline);
  const received = parseReceivedAt(item.received_at);

  return {
    schemaVersion: "1.0",
    candidateId: slug(`${developer} ${productHint}`) || slug(item.message_id),
    status: "candidate",
    requiresReview: true,
    source: {
      type: "email",
      messageId: item.message_id ?? null,
      sender: item.from_email ?? item.from_name ?? null,
      subject: item.subject ?? null,
      receivedAt: received ? received.toISOString() : null
    },
    product: {
      name: productHint,
      developer: developer || null,
      category: "plugin",
      // The email's preview is not a description of the product. Left empty on
      // purpose: the vendor page supplies it, and the contract asks for it.
      whatItIs: null
    },
    merchant: { programId: null },
    offer: {
      promoPrice: firstNumber(price),
      regularPrice: null,
      regularPriceSource: null,
      currency: null,
      discountPercent: percent,
      couponCode: null,
      couponScope: null,
      couponOwner: null,
      couponPublishable: null,
      startsAt: null,
      endsAt: null,
      endsAtDate,
      dateOnly: endsAtDate !== null,
      permanent: null,
      timezoneSource: null
    },
    offerNature: free ? "limited-free" : "paid-promo",
    limitedBy: "time",
    freeQualification: free ? "Free temporário" : undefined,
    primarySourceFound: false,
    links: {
      sourceUrl: vendorUrl,
      developerOfficialUrl: null,
      affiliateUrl: null
    },
    evidence: [],
    confidence: {
      product: vendorUrl ? "medium" : "low",
      price: "low",
      dates: endsAtDate ? "medium" : "low",
      link: vendorUrl ? "medium" : "low"
    },
    restrictions: [],
    openQuestions: [
      "Read the offer on the vendor page before building a record from this lead."
    ],
    missingFacts: [],
    notApplicable: [],
    toValidate: [
      "Confirm price, deadline and coupon on the vendor page; the email is a lead, not a source."
    ],
    lead: {
      receivedAt: item.received_at ?? null,
      relevance: item.relevance ?? null,
      detectedDiscount: discount || null,
      detectedPrice: price || null,
      detectedDeadline: deadline || null,
      vendorUrlState: vendorUrl ? "clean" : urlsFrom(item).length > 0 ? "tracking-only" : "none"
    }
  };
}

export function selectLeads(items, { days = 14, now = new Date(), limit = 200 } = {}) {
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const leads = [];

  for (const item of items) {
    if (!item || item.relevance === "low") continue;
    const discount = String(item.detected_discount ?? "").trim();
    const price = String(item.detected_price ?? "").trim();
    if (discount === "" && price === "") continue;

    const received = parseReceivedAt(item.received_at);
    if (received && received < cutoff) continue;

    leads.push(item);
    if (leads.length >= limit) break;
  }

  return leads;
}

export function buildReport(candidates, { feed, days, now }) {
  const withUrl = candidates.filter((c) => c.lead.vendorUrlState === "clean").length;
  const trackingOnly = candidates.filter((c) => c.lead.vendorUrlState === "tracking-only").length;
  const none = candidates.filter((c) => c.lead.vendorUrlState === "none").length;
  return {
    feed,
    windowDays: days,
    generatedFor: now.toISOString().slice(0, 10),
    total: candidates.length,
    withCleanVendorUrl: withUrl,
    trackingOnly,
    noUrl: none
  };
}

export function formatReport(report) {
  return [
    `Leads do email: ${report.total} (janela de ${report.windowDays} dias)`,
    `  com URL do fabricante : ${report.withCleanVendorUrl}`,
    `  só link de rastreio   : ${report.trackingOnly}`,
    `  sem URL nenhuma       : ${report.noUrl}`,
    "",
    "Nenhum é publicável ainda: o email é lead, não fonte. A página do fabricante",
    "precisa ser lida antes de virar pacote, e é a porteira que cobra isso."
  ].join("\n");
}

const USAGE = `ASP e-mail candidates: Outlook promotions feed -> candidate leads

Usage:
  node scripts/email-candidates.mjs [--feed <path>] [--output <path>] [--top <n>]
                                    [--days <n>] [--now <YYYY-MM-DD>]

Options:
  --feed <path>     Odysseus mail feed JSON (default: $ODYSSEUS_OUTLOOK_FEED_PATH)
  --output <path>   Candidates to write (default: asp-candidates.json)
  --top <n>         Maximum leads (default: 200)
  --days <n>        How far back to look (default: 14)
  --now <date>      Pretend it is this date
  --help            Show this message

Read-only over the feed. It writes candidates, never records and never a package.
An email is a lead: the vendor page still has to be read.`;

export function parseArgs(argv) {
  const options = {
    feed: DEFAULT_FEED,
    output: path.join(rootDirectory, "asp-candidates.json"),
    top: 200,
    days: 14,
    now: null,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    switch (argument) {
      case "--feed":
        index += 1;
        if (index >= argv.length) throw new Error("--feed requires a path.");
        options.feed = argv[index];
        break;
      case "--output":
        index += 1;
        if (index >= argv.length) throw new Error("--output requires a path.");
        options.output = path.resolve(rootDirectory, argv[index]);
        break;
      case "--top":
        index += 1;
        options.top = Number(argv[index]);
        if (!Number.isInteger(options.top) || options.top <= 0) {
          throw new Error("--top requires a positive integer.");
        }
        break;
      case "--days":
        index += 1;
        options.days = Number(argv[index]);
        if (!Number.isInteger(options.days) || options.days <= 0) {
          throw new Error("--days requires a positive integer.");
        }
        break;
      case "--now":
        index += 1;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(argv[index] ?? "")) {
          throw new Error("--now requires a calendar date in YYYY-MM-DD form.");
        }
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
    console.error(`ERROR CANDIDATES: ${error.message}`);
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }

  if (options.help) {
    console.log(USAGE);
    return;
  }

  const items = JSON.parse(await readFile(options.feed, "utf8"));
  const now = options.now ? new Date(`${options.now}T12:00:00`) : new Date();
  const leads = selectLeads(items, { days: options.days, now, limit: options.top });
  const candidates = leads.map((item) =>
    buildCandidate(item, { vendorUrl: extractVendorUrl(item) })
  );

  await writeFile(options.output, `${JSON.stringify(candidates, null, 2)}\n`, "utf8");
  const report = buildReport(candidates, { feed: options.feed, days: options.days, now });
  console.log(formatReport(report));
  console.log(`\nCandidatos escritos em ${path.relative(rootDirectory, options.output)}.`);
}

const invokedDirectly =
  typeof process.argv[1] === "string" &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main().catch((error) => {
    console.error(`ERROR CANDIDATES: ${error.stack ?? error.message}`);
    process.exitCode = 1;
  });
}
