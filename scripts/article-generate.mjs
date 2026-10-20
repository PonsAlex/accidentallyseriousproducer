import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EDITORIAL_STATUSES, EDITORIAL_VERDICTS } from "../assets/content-blocks.mjs";
import { createConsoleExportEnvelope, prepareConsoleImport } from "../assets/console-export.mjs";

/**
 * Generate a published article page from the Console state.
 *
 * The Console is a workspace; the site is HTML. This renders the blocks into the
 * exact markup the site already uses, so the page is a first-class article and
 * the Console can extract its templates back out.
 *
 * A block without a Verdict stops the generation: the site's whole premise is
 * that a human decided. The Status may be confirmed from the scaffold proposal.
 */

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE_ORIGIN = "https://accidentallyseriousproducer.com";

const USAGE = `ASP article generator: Console state -> published article page

Usage:
  node scripts/article-generate.mjs --state <export> --slug <slug> --title <title> [options]

Options:
  --state <path>      Console export to read (required)
  --slug <slug>       Article file name without .html (required)
  --title <title>     Article headline (required)
  --deck <text>       Standfirst under the headline
  --eyebrow <text>    Small label above the headline (default: Editorial Radar)
  --date <YYYY-MM-DD> Publication date (default: today, UTC)
  --decisions <path>  JSON map blockId -> { verdict, status } to apply in memory
  --state-out <path>  Write the export with those decisions applied
  --allow-missing-verdict  Emit a review without a Verdict (not recommended)
  --output <path>     Page path (default: articles/<slug>.html)
  --help              Show this message

The Verdict and Status are editorial decisions. This tool applies what you decide;
it never chooses for you.
`;

export function parseArgs(argv) {
  const options = {
    state: null,
    slug: null,
    title: null,
    deck: null,
    eyebrow: "Editorial Radar",
    date: null,
    decisions: null,
    stateOut: null,
    only: null,
    allowMissingVerdict: false,
    output: null,
    help: false
  };

  const valued = new Map([
    ["--state", "state"],
    ["--slug", "slug"],
    ["--title", "title"],
    ["--deck", "deck"],
    ["--eyebrow", "eyebrow"],
    ["--date", "date"],
    ["--decisions", "decisions"],
    ["--state-out", "stateOut"],
    ["--only", "only"],
    ["--output", "output"]
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    if (argument === "--allow-missing-verdict") {
      options.allowMissingVerdict = true;
      continue;
    }
    const key = valued.get(argument);
    if (!key) throw new Error(`Unknown option: ${argument}`);
    index += 1;
    if (index >= argv.length) throw new Error(`Option ${argument} requires a value.`);
    options[key] = argv[index];
  }

  return options;
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function badgeClass(label) {
  return String(label ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function verdictClass(verdict) {
  const known = EDITORIAL_VERDICTS.find((entry) => entry.toLowerCase() === String(verdict).toLowerCase());
  return badgeClass(known ?? verdict);
}

/**
 * Apply the human's decisions to the blocks, refusing a value outside the board
 * vocabulary and never inventing one.
 */
export function applyDecisions(state, decisions = {}) {
  const applied = [];
  const unknown = Object.keys(decisions).filter(
    (blockId) => !state.blocks.some((block) => block.id === blockId)
  );
  if (unknown.length > 0) {
    throw new Error(`Decisions target unknown block(s): ${unknown.join(", ")}.`);
  }

  for (const [blockId, decision] of Object.entries(decisions)) {
    const block = state.blocks.find((entry) => entry.id === blockId);
    if (decision?.verdict !== undefined && decision.verdict !== "") {
      const match = EDITORIAL_VERDICTS.find(
        (entry) => entry.toLowerCase() === String(decision.verdict).toLowerCase()
      );
      if (!match) {
        throw new Error(
          `Block ${blockId}: "${decision.verdict}" is not a Verdict. Use one of: ${EDITORIAL_VERDICTS.join(", ")}.`
        );
      }
      block.metadata.verdict = match;
      applied.push(`${blockId} verdict=${match}`);
    }
    if (decision?.status !== undefined && decision.status !== "") {
      const match = EDITORIAL_STATUSES.find(
        (entry) => entry.toLowerCase() === String(decision.status).toLowerCase()
      );
      if (!match) {
        throw new Error(
          `Block ${blockId}: "${decision.status}" is not a Status. Use one of: ${EDITORIAL_STATUSES.join(", ")}.`
        );
      }
      block.metadata.editorialStatus = match;
      applied.push(`${blockId} status=${match}`);
    }
    // The one-sentence verdict that appears as "**Verdict:** ..." on the page.
    // Nothing in the extraction produces it, so it travels with the decision.
    if (decision?.note !== undefined && decision.note !== "") {
      if (typeof decision.note !== "string" || decision.note.trim() === "") {
        throw new Error(`Block ${blockId}: "note" must be a non-empty sentence.`);
      }
      block.content = { ...block.content, verdict: decision.note.trim() };
      applied.push(`${blockId} note written`);
    }
    if (decision?.href !== undefined) {
      const href = decision.href;
      const internal = typeof href === "string" && /^\/go\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(href);
      const external = typeof href === "string" && /^https:\/\/[^\s]+$/.test(href);
      if (!internal && !external) {
        throw new Error(`Block ${blockId}: "href" must be /go/<linkId> or an https URL.`);
      }
      block.content = { ...block.content, href };
      applied.push(`${blockId} href=${href}`);
    }
    if (decision?.linkLabel !== undefined && decision.linkLabel !== "") {
      if (typeof decision.linkLabel !== "string" || decision.linkLabel.trim() === "") {
        throw new Error(`Block ${blockId}: "linkLabel" must be a non-empty string.`);
      }
      block.content = { ...block.content, linkLabel: decision.linkLabel.trim() };
      applied.push(`${blockId} linkLabel written`);
    }
  }

  return applied;
}

export function selectArticleBlocks(state) {
  return state.blocks
    .filter((block) => block.section === "articles" && block.type === "product-review")
    .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id));
}

/** Blocks that cannot be published yet, with the reason. */
export function publicationBlockers(blocks) {
  const blockers = [];
  for (const block of blocks) {
    if (typeof block.content?.title !== "string" || block.content.title.trim() === "") {
      blockers.push({ blockId: block.id, reason: "no title" });
    }
    if (typeof block.content?.body !== "string" || block.content.body.trim() === "") {
      blockers.push({ blockId: block.id, reason: "no body copy" });
    }
    if (typeof block.metadata?.verdict !== "string" || block.metadata.verdict.trim() === "") {
      blockers.push({ blockId: block.id, reason: "no Verdict — an editorial decision is required" });
    }
  }
  return blockers;
}

function renderReviewSection(block) {
  const { content, metadata } = block;
  const lines = ["        <section class=\"product-review\">"];
  lines.push(`          <div class="verdict-badge ${verdictClass(metadata.verdict)}">${escapeHtml(metadata.verdict)}</div>`);

  const status = content.reviewLabel || metadata.editorialStatus;
  if (status) {
    const known = EDITORIAL_STATUSES.find((entry) => entry.toLowerCase() === String(status).toLowerCase());
    lines.push(
      `          <div class="status-badge${known ? ` ${badgeClass(known)}` : ""}">${escapeHtml(status)}</div>`
    );
  }

  lines.push(`          <h2>${escapeHtml(content.title)}</h2>`);
  lines.push(`          <p>${escapeHtml(content.body)}</p>`);

  if (content.verdict) {
    lines.push(
      `          <p class="editorial-note"><strong>Verdict:</strong> ${escapeHtml(content.verdict)}</p>`
    );
  }

  if (content.href) {
    lines.push(
      `          <a href="${escapeHtml(content.href)}" class="cta-button">${escapeHtml(
        content.linkLabel || "View offer"
      )}</a>`
    );
  } else {
    lines.push("          <!-- No reviewed destination: no call to action is emitted. -->");
  }

  lines.push("        </section>");
  return lines.join("\n");
}

export function renderArticlePage({ blocks, slug, title, deck, eyebrow, date }) {
  const sections = blocks.map(renderReviewSection).join("\n\n");
  const canonical = `${SITE_ORIGIN}/articles/${slug}.html`;
  const metaTitle = escapeHtml(title);
  const metaDescription = escapeHtml(deck || title);
  const published = escapeHtml(date);
  const humanDate = new Intl.DateTimeFormat("en", {
    dateStyle: "long",
    timeZone: "UTC"
  }).format(new Date(`${date}T00:00:00Z`));

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">

  <title>${metaTitle}</title>
  <meta name="description" content="${metaDescription}">
  <link rel="canonical" href="${canonical}">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <meta property="og:type" content="article">
  <meta property="og:title" content="${metaTitle}">
  <meta property="og:description" content="${metaDescription}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:site_name" content="Accidentally Serious Producer">
  <meta name="twitter:card" content="summary">
  <meta name="twitter:title" content="${metaTitle}">
  <meta name="twitter:description" content="${metaDescription}">

  <link rel="stylesheet" href="/styles.css">
  <script type="module" src="/assets/affiliate-elements.mjs"></script>

  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": ${JSON.stringify(title)},
    "description": ${JSON.stringify(deck || title)},
    "datePublished": "${date}",
    "dateModified": "${date}",
    "author": {
      "@type": "Person",
      "name": "ASP"
    },
    "publisher": {
      "@type": "Organization",
      "name": "Accidentally Serious Producer"
    },
    "mainEntityOfPage": "${canonical}"
  }
  </script>
</head>
<body>
  <a class="skip-link" href="#main-content">Skip to content</a>
  <header class="site-header">
    <div class="shell header-inner">
      <a class="brand" href="/" aria-label="Accidentally Serious Producer home">
        <span class="brand-mark">ASP</span>
        <span class="brand-name">Accidentally Serious Producer</span>
      </a>
      <nav class="site-nav" aria-label="Primary navigation">
        <a href="/fire-or-nah.html">Fire or Nah?</a>
        <a href="/deals/">Deals</a>
        <a href="/about.html">About</a>
      </nav>
    </div>
  </header>

  <main id="main-content" tabindex="-1">
    <article class="article-page">
      <header class="article-header shell narrow">
        <p class="eyebrow">${escapeHtml(eyebrow)}</p>
        <h1>${metaTitle}</h1>
        <p class="article-deck">
          ${metaDescription}
        </p>
        <div class="article-meta">
          <span>${escapeHtml(humanDate)}</span>
          <span>ASP editorial desk</span>
        </div>
      </header>

      <div class="shell narrow article-body">
        <p class="article-disclosure">
          Promotional facts are time-sensitive. Prices, availability and
          destinations should be checked again before purchase.
        </p>

${sections}
      </div>
    </article>
  </main>

  <footer class="site-footer">
    <div class="shell footer-grid">
      <div>
        <strong>Accidentally Serious Producer</strong>
        <p>Started as a hobby. Got out of hand.</p>
      </div>
      <nav class="footer-nav" aria-label="Footer navigation">
        <a href="/about.html">About</a>
        <a href="/fire-or-nah.html">Fire or Nah?</a>
        <a href="/deals/">Deals</a>
        <a href="/privacy.html">Privacy</a>
        <a href="/articles/">All posts</a>
        <a href="/affiliate-disclosure.html">Affiliate Disclosure</a>
      </nav>
    </div>
  </footer>
</body>
</html>
`;
}

/**
 * The registration the Console needs so it can extract templates from the new
 * page. Printed rather than written: rewriting the module is a code change the
 * author should see.
 */
export function registrationSnippet(blocks, { slug, pageKey }) {
  const entries = blocks
    .map(
      (block, index) =>
        `  add("${block.id}", "product-review", documents.${pageKey}, ".product-review", ${index});`
    )
    .join("\n");
  return [
    `  // 1) PAGE_TEMPLATES`,
    `  ${pageKey}: "/articles/${slug}.html",`,
    ``,
    `  // 2) block registrations, after the existing add(...) calls for that page`,
    entries
  ].join("\n");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(USAGE);
    return;
  }
  if (!options.state) throw new Error("--state is required.");
  if (!options.slug) throw new Error("--slug is required.");
  if (!options.title) throw new Error("--title is required.");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(options.slug)) {
    throw new Error(`--slug "${options.slug}" must be lowercase letters, digits and hyphens.`);
  }

  const date = options.date ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    throw new Error(`--date "${date}" must be a real YYYY-MM-DD date.`);
  }

  const statePath = path.resolve(rootDirectory, options.state);
  const loaded = prepareConsoleImport(JSON.parse(await readFile(statePath, "utf8")));
  const state = JSON.parse(JSON.stringify(loaded));

  if (options.decisions) {
    const decisions = JSON.parse(await readFile(path.resolve(rootDirectory, options.decisions), "utf8"));
    const applied = applyDecisions(state, decisions);
    for (const line of applied) console.log(`  applied ${line}`);
  }

  const blocks = selectArticleBlocks(state);
  if (blocks.length === 0) {
    throw new Error("No product-review block in the articles section. Nothing to publish.");
  }

  const only = options.only
    ? options.only.split(",").map((entry) => entry.trim()).filter(Boolean)
    : null;
  if (only) {
    const known = new Set(blocks.map((block) => block.id));
    const unknown = only.filter((blockId) => !known.has(blockId));
    if (unknown.length > 0) {
      throw new Error(`--only names unknown article block(s): ${unknown.join(", ")}.`);
    }
  }
  const selected = only ? blocks.filter((block) => only.includes(block.id)) : blocks;

  const blockers = publicationBlockers(selected);
  if (blockers.length > 0 && !options.allowMissingVerdict) {
    throw new Error(
      `Cannot generate the page:\n- ${blockers
        .map((entry) => `${entry.blockId}: ${entry.reason}`)
        .join("\n- ")}\n\nSet the Verdict and Status first (a --decisions file is the fastest path), or pass --allow-missing-verdict.`
    );
  }

  const html = renderArticlePage({
    blocks: selected,
    slug: options.slug,
    title: options.title,
    deck: options.deck,
    eyebrow: options.eyebrow,
    date
  });

  const outputPath = path.resolve(rootDirectory, options.output ?? path.join("articles", `${options.slug}.html`));
  await writeFile(outputPath, html, "utf8");

  if (options.stateOut) {
    const outPath = path.resolve(rootDirectory, options.stateOut);
    await writeFile(
      outPath,
      `${JSON.stringify(createConsoleExportEnvelope(state, new Date().toISOString()), null, 2)}\n`,
      "utf8"
    );
    console.log(`Console export with the decisions applied: ${path.relative(rootDirectory, outPath)}`);
  }

  console.log(`Wrote ${path.relative(rootDirectory, outputPath)} with ${selected.length} review(s).`);
  const withoutLink = selected.filter((block) => !block.content?.href);
  for (const block of withoutLink) {
    console.warn(`WARN ${block.id}: no reviewed destination, so no call to action was emitted.`);
  }
  const missing = selected.filter((block) => !block.metadata?.editorialStatus && !block.content?.reviewLabel);
  for (const block of missing) {
    console.warn(`WARN ${block.id}: no Status, so no status badge was emitted.`);
  }
  const noNote = selected.filter((block) => !block.content?.verdict);
  for (const block of noNote) {
    console.warn(`WARN ${block.id}: no verdict sentence, so the editorial note was omitted.`);
  }

  const pageKey = options.slug.replace(/-([a-z0-9])/g, (_, letter) => letter.toUpperCase());
  console.log("\nRegister the page so the Console can extract templates from it:\n");
  console.log(registrationSnippet(selected, { slug: options.slug, pageKey }));
}

const invokedDirectly =
  typeof process.argv[1] === "string" &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main().catch((error) => {
    console.error(`ERROR ARTICLE: ${error.stack ?? error.message}`);
    process.exitCode = 1;
  });
}
