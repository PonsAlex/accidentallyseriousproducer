import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SITE_NAME, SITE_ORIGIN, extractChrome, escapeXml } from "./discovery.mjs";
import { OFFER_PHASES, formatOfferDate, offerPhase } from "./offer-phase.mjs";

/**
 * The monthly Plugin Audit: an audit of our own judgement, not a list of what we
 * found. The radar already lists the finds.
 *
 * Numbers come from the ledger, so they cannot be massaged. The words come from a
 * decisions file the editor writes, so the judgement stays human — the same split
 * the article generator uses.
 */

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const VERDICT_ORDER = Object.freeze(["Fire", "Stash", "Digital Furniture", "Nah"]);

function byVerdict(reviews) {
  const counts = Object.fromEntries(VERDICT_ORDER.map((verdict) => [verdict, 0]));
  for (const review of reviews) {
    if (review.verdict in counts) counts[review.verdict] += 1;
  }
  return counts;
}

/**
 * Everything the audit states about the month, computed. `auditDate` is injected:
 * the page must not disagree with itself depending on when it is rebuilt.
 */
export function summariseMonth(reviews, { month, auditDate }) {
  const inMonth = (Array.isArray(reviews) ? reviews : [])
    .filter((review) => String(review?.publishedAt ?? "").slice(0, 7) === month)
    .sort((left, right) => String(left.publishedAt).localeCompare(String(right.publishedAt)));

  const expired = inMonth.filter(
    (review) => review.endsAtDate && review.endsAtDate < auditDate
  );
  const live = inMonth.filter((review) => review.endsAtDate && review.endsAtDate >= auditDate);
  const undated = inMonth.filter((review) => !review.endsAtDate);
  const upcoming = inMonth.filter(
    (review) => review.startsAtDate && review.startsAtDate > auditDate
  );

  const counts = byVerdict(inMonth);
  const total = inMonth.length;

  return {
    month,
    auditDate,
    total,
    counts,
    reviews: inMonth,
    expired,
    live,
    undated,
    upcoming,
    firstPublished: inMonth[0]?.publishedAt ?? null,
    lastPublished: inMonth.at(-1)?.publishedAt ?? null,
    fireShare: total === 0 ? 0 : counts.Fire / total
  };
}

function list(items, render) {
  return items.map((item) => `        <li>${render(item)}</li>`).join("\n");
}

function reviewLink(review, { radarHref = "/articles/radar-outubro-26.html" } = {}) {
  return `<a href="${escapeXml(radarHref)}">${escapeXml(review.productName ?? review.recordId)}</a>`;
}

/** A share as "6 of 12" plus the sentence that makes it uncomfortable. */
export function describeShare(summary) {
  if (summary.total === 0) return "No reviews this month.";
  const half = summary.counts.Fire * 2 === summary.total;
  const share = `${summary.counts.Fire} of ${summary.total}`;
  if (half) return `${share} — half.`;
  return `${share}.`;
}

/**
 * The deadline that comes first in time, not the first one published. Reading the
 * list in publication order once produced an audit that called a 6 December offer
 * the next deadline while a 18 November one was already on the page.
 */
export function nextDeadline(summary) {
  const withDates = [...(summary?.live ?? [])]
    .filter((review) => review.endsAtDate)
    .sort((left, right) => String(left.endsAtDate).localeCompare(String(right.endsAtDate)));
  return withDates[0] ?? null;
}

export function renderAuditPage(summary, editorial, { header = "", footer = "" } = {}) {
  const slug = editorial.slug;
  const canonical = `${SITE_ORIGIN}/articles/${slug}.html`;
  const numberLine =
    `${summary.total} review${summary.total === 1 ? "" : "s"} between ` +
    `${summary.firstPublished ?? "—"} and ${summary.lastPublished ?? "—"}`;

  const verdictRows = VERDICT_ORDER.filter((verdict) => summary.counts[verdict] > 0)
    .map(
      (verdict) =>
        `        <tr><th scope="row">${verdict}</th><td>${summary.counts[verdict]}</td></tr>`
    )
    .join("\n");

  const fireList = summary.reviews
    .filter((review) => review.verdict === "Fire")
    .map((review) => {
      const line = editorial.defended?.[review.recordId];
      return `        <li><strong>${escapeXml(review.productName ?? review.recordId)}</strong>${
        line ? ` — ${escapeXml(line)}` : ""
      }</li>`;
    })
    .join("\n");

  const demoted = summary.reviews
    .filter((review) => review.verdict !== "Fire")
    .map((review) => {
      const line = editorial.demoted?.[review.recordId];
      return `        <li><strong>${escapeXml(review.verdict)}</strong> · ${escapeXml(
        review.productName ?? review.recordId
      )}${line ? ` — ${escapeXml(line)}` : ""}</li>`;
    })
    .join("\n");

  const next = nextDeadline(summary);
  const expiredBlock =
    summary.expired.length === 0
      ? `        <p>Nothing expired this month. ${
          next
            ? `The first deadline is ${escapeXml(next.productName ?? "")} on ${escapeXml(
                formatOfferDate(next.endsAtDate)
              )}.`
            : ""
        }</p>`
      : `        <ul>\n${list(summary.expired, (review) =>
          `${escapeXml(review.productName ?? review.recordId)} — ended ${escapeXml(
            formatOfferDate(review.endsAtDate)
          )}`
        )}\n        </ul>`;

  const upcomingBlock =
    summary.upcoming.length === 0
      ? `        <p>Nothing on the calendar opens after this audit.</p>`
      : `        <ul>\n${list(summary.upcoming, (review) =>
          `${escapeXml(review.productName ?? review.recordId)} — opens ${escapeXml(
            formatOfferDate(review.startsAtDate)
          )}`
        )}\n        </ul>`;

  const opening = (editorial.opening ?? [])
    .map((paragraph) => `        <p>${escapeXml(paragraph)}</p>`)
    .join("\n");
  const closing = (editorial.closing ?? [])
    .map((paragraph) => `        <p>${escapeXml(paragraph)}</p>`)
    .join("\n");
  const mistakes = (editorial.mistakes ?? [])
    .map((entry) => `        <li>${escapeXml(entry)}</li>`)
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">

  <title>${escapeXml(editorial.title)} | ${SITE_NAME}</title>
  <meta name="description" content="${escapeXml(editorial.deck)}">
  <link rel="canonical" href="${canonical}">
  <link rel="alternate" type="application/atom+xml" title="${SITE_NAME}" href="/feed.xml">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <meta property="og:type" content="article">
  <meta property="og:title" content="${escapeXml(editorial.title)}">
  <meta property="og:description" content="${escapeXml(editorial.deck)}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:site_name" content="${SITE_NAME}">

  <link rel="stylesheet" href="/styles.css">

  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": ${JSON.stringify(editorial.title)},
    "description": ${JSON.stringify(editorial.deck)},
    "datePublished": "${editorial.date}",
    "dateModified": "${editorial.date}",
    "author": { "@type": "Person", "name": "ASP" },
    "publisher": { "@type": "Organization", "name": ${JSON.stringify(SITE_NAME)} },
    "mainEntityOfPage": "${canonical}"
  }
  </script>
</head>
<body>
  <a class="skip-link" href="#main-content">Skip to content</a>
  ${header}

  <main id="main-content" tabindex="-1">
    <article class="article-page">
      <header class="article-header shell narrow">
        <p class="eyebrow">${escapeXml(editorial.eyebrow ?? "Plugin Audit")}</p>
        <h1>${escapeXml(editorial.title)}</h1>
        <p class="article-deck">${escapeXml(editorial.deck)}</p>
        <p class="section-note">${escapeXml(editorial.date)}</p>
      </header>

      <div class="shell narrow article-body">
${opening}

        <h2>The month in numbers</h2>
        <p>${escapeXml(numberLine)}.</p>
        <table class="audit-table">
          <caption>Verdicts across the month</caption>
          <tbody>
${verdictRows}
          </tbody>
        </table>
        <p>
          ${escapeXml(describeShare(summary))} ${escapeXml(editorial.ratioNote ?? "")}
        </p>

        <h2>The ones we would defend</h2>
        <ul>
${fireList}
        </ul>

        <h2>The ones we put down</h2>
        <ul>
${demoted}
        </ul>

        <h2>What expired</h2>
${expiredBlock}

        <h2>What is still ahead</h2>
${upcomingBlock}

        <h2>What we got wrong</h2>
        <ul>
${mistakes}
        </ul>
${closing}
      </div>
    </article>
  </main>

  ${footer}
</body>
</html>
`;
}

const USAGE = `ASP Plugin Audit generator

Usage:
  node scripts/audit-generate.mjs --month <YYYY-MM> --decisions <path> [options]

Options:
  --month <YYYY-MM>    Month being audited (required)
  --decisions <path>   Editorial JSON: the words the audit says (required)
  --reviews <path>     Review ledger (default: data/reviews.json)
  --audit-date <date>  The date the audit speaks from (default: today)
  --output <path>      Page to write (default: articles/audit-<month>.html)
  --help               Show this message

Numbers come from the ledger and are not negotiable. Everything the audit
asserts as judgement comes from the decisions file.`;

export function parseArgs(argv) {
  const options = {
    month: null,
    decisions: null,
    reviews: path.join(rootDirectory, "data", "reviews.json"),
    auditDate: null,
    output: null,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    switch (argument) {
      case "--month":
        index += 1;
        if (!/^\d{4}-\d{2}$/.test(argv[index] ?? "")) throw new Error("--month requires YYYY-MM.");
        options.month = argv[index];
        break;
      case "--decisions":
        index += 1;
        options.decisions = path.resolve(rootDirectory, argv[index]);
        break;
      case "--reviews":
        index += 1;
        options.reviews = path.resolve(rootDirectory, argv[index]);
        break;
      case "--audit-date":
        index += 1;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(argv[index] ?? "")) {
          throw new Error("--audit-date requires YYYY-MM-DD.");
        }
        options.auditDate = argv[index];
        break;
      case "--output":
        index += 1;
        options.output = path.resolve(rootDirectory, argv[index]);
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
    console.error(`ERROR AUDIT: ${error.message}`);
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }

  if (options.help) {
    console.log(USAGE);
    return;
  }
  if (!options.month || !options.decisions) {
    console.error("ERROR AUDIT: --month and --decisions are required.");
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }

  const { reviews } = JSON.parse(await readFile(options.reviews, "utf8"));
  const editorial = JSON.parse(await readFile(options.decisions, "utf8"));
  const auditDate = options.auditDate ?? new Date().toISOString().slice(0, 10);

  const summary = summariseMonth(reviews, { month: options.month, auditDate });
  if (summary.total === 0) {
    console.error(`ERROR AUDIT: no reviews published in ${options.month}.`);
    process.exitCode = 1;
    return;
  }

  const homeHtml = await readFile(path.join(rootDirectory, "index.html"), "utf8");
  const chrome = extractChrome(homeHtml);
  const html = renderAuditPage(summary, editorial, chrome);

  // The filename follows the slug, because the canonical URL is built from it: a
  // page whose canonical names a file that does not exist is worse than no page.
  const output =
    options.output ??
    path.join(rootDirectory, "articles", `${editorial.slug ?? `audit-${options.month}`}.html`);
  await writeFile(output, html, "utf8");

  console.log(
    `Audit de ${options.month}: ${summary.total} reviews, ${summary.counts.Fire} Fire. ` +
      `Escrito em ${path.relative(rootDirectory, output)}.`
  );
}

const invokedDirectly =
  typeof process.argv[1] === "string" &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main().catch((error) => {
    console.error(`ERROR AUDIT: ${error.stack ?? error.message}`);
    process.exitCode = 1;
  });
}
