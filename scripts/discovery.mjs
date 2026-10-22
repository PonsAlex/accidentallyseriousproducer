import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Generate the site's discovery layer from the pages that already exist.
 *
 * The archive index, the feed and the sitemap are derived, never authored: a
 * post cannot be published without appearing in all three, because nothing is
 * written by hand. That is the point — `/articles/` used to be a 404.
 */

export const SITE_ORIGIN = "https://accidentallyseriousproducer.com";
export const SITE_NAME = "Accidentally Serious Producer";
export const SITE_DESCRIPTION =
  "Music production tools, DSP and honest plugin curation for hobbyist producers.";

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const VERDICT_LABELS = Object.freeze({
  fire: "Fire",
  stash: "Stash",
  "digital-furniture": "Digital Furniture",
  nah: "Nah"
});

/** Static pages that belong in the sitemap, in the order they matter. */
const STATIC_PAGES = Object.freeze([
  "/",
  "/articles/",
  "/deals/",
  "/fire-or-nah.html",
  "/about.html",
  "/privacy.html",
  "/affiliate-disclosure.html"
]);

export function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function decodeEntities(value) {
  return String(value ?? "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

function collapse(value) {
  return decodeEntities(String(value ?? "").replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Reuse the site's own header and footer instead of restating them, so the
 * archive cannot drift away from the rest of the site.
 */
export function extractChrome(homeHtml) {
  const header = /<header class="site-header">[\s\S]*?<\/header>/.exec(homeHtml)?.[0];
  const footer = /<footer class="site-footer">[\s\S]*?<\/footer>/.exec(homeHtml)?.[0];
  if (!header || !footer) {
    throw new Error("Could not read the site header and footer from index.html.");
  }
  return { header, footer };
}

/** Pull the facts a listing needs out of one published article page. */
export function parseArticle(html, { pathname } = {}) {
  const title = collapse(/<title>([\s\S]*?)<\/title>/.exec(html)?.[1]);
  const description = collapse(
    /<meta name="description" content="([^"]*)"/.exec(html)?.[1]
  );
  const canonical = /<link rel="canonical" href="([^"]*)"/.exec(html)?.[1] ?? null;
  const date = /"datePublished":\s*"(\d{4}-\d{2}-\d{2})"/.exec(html)?.[1] ?? null;
  const deck = collapse(/<p class="article-deck">([\s\S]*?)<\/p>/.exec(html)?.[1]);
  const headline = collapse(/<h1>([\s\S]*?)<\/h1>/.exec(html)?.[1]);

  const verdicts = [];
  for (const match of html.matchAll(/<div class="verdict-badge ([a-z-]+)">/g)) {
    const label = VERDICT_LABELS[match[1]] ?? match[1];
    const existing = verdicts.find((entry) => entry.label === label);
    if (existing) existing.count += 1;
    else verdicts.push({ label, count: 1 });
  }

  if (!title) throw new Error(`Article ${pathname ?? "(unknown)"} has no <title>.`);
  if (!date) throw new Error(`Article ${pathname ?? "(unknown)"} has no datePublished.`);

  return {
    pathname,
    url: `${SITE_ORIGIN}${pathname}`,
    title,
    description,
    headline: headline || title,
    deck,
    date,
    verdicts
  };
}

function verdictLine(article) {
  if (article.verdicts.length === 0) return "";
  return article.verdicts
    .map((entry) => `${entry.label} ${entry.count}`)
    .join(" · ");
}

function humanDate(date) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "long",
    timeZone: "UTC"
  }).format(new Date(`${date}T00:00:00Z`));
}

export function renderArticlesIndex(articles, { header, footer } = {}) {
  const cards = articles
    .map((article) => {
      const tally = verdictLine(article);
      return `        <article class="content-card">
          <span class="card-kicker">${escapeXml(humanDate(article.date))}</span>
          <h3><a href="${escapeXml(article.pathname)}">${escapeXml(article.headline)}</a></h3>
          <p>${escapeXml(article.deck || article.description)}</p>
          <p class="section-note">${escapeXml(tally)}</p>
        </article>`;
    })
    .join("\n");

  const count = articles.length;
  const noun = count === 1 ? "post" : "posts";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">

  <title>All posts | ${SITE_NAME}</title>
  <meta name="description" content="Every post ASP has published, newest first.">
  <link rel="canonical" href="${SITE_ORIGIN}/articles/">
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <meta property="og:type" content="website">
  <meta property="og:title" content="All posts | ${SITE_NAME}">
  <meta property="og:description" content="Every post ASP has published, newest first.">
  <meta property="og:url" content="${SITE_ORIGIN}/articles/">

  <link rel="stylesheet" href="/styles.css">
  <link rel="alternate" type="application/atom+xml" title="${SITE_NAME}" href="/feed.xml">
</head>
<body>
  <a class="skip-link" href="#main-content">Skip to content</a>
  ${header ?? ""}

  <main id="main-content" tabindex="-1">
    <section class="section">
      <div class="shell narrow">
        <header class="article-header">
          <p class="eyebrow">Editorial archive</p>
          <h1>Every post</h1>
          <p class="article-deck">
            ${count} ${noun}, newest first. Nothing here is generated text: every
            entry is a page that was reviewed before it went up.
          </p>
          <p class="section-note">
            <a class="text-link" href="/feed.xml">Subscribe to the feed →</a>
          </p>
        </header>
      </div>
    </section>

    <section class="section">
      <div class="shell">
        <div class="card-grid">
${cards}
        </div>
      </div>
    </section>
  </main>

  ${footer ?? ""}
</body>
</html>
`;
}

export function renderAtomFeed(articles, { updated } = {}) {
  const newest = articles[0]?.date ?? updated.slice(0, 10);
  const entries = articles
    .map(
      (article) => `  <entry>
    <title>${escapeXml(article.headline)}</title>
    <link href="${escapeXml(article.url)}"/>
    <id>${escapeXml(article.url)}</id>
    <updated>${article.date}T00:00:00Z</updated>
    <published>${article.date}T00:00:00Z</published>
    <summary>${escapeXml(article.deck || article.description)}</summary>
  </entry>`
    )
    .join("\n");

  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${SITE_NAME}</title>
  <subtitle>${escapeXml(SITE_DESCRIPTION)}</subtitle>
  <link href="${SITE_ORIGIN}/feed.xml" rel="self"/>
  <link href="${SITE_ORIGIN}/"/>
  <id>${SITE_ORIGIN}/</id>
  <updated>${newest}T00:00:00Z</updated>
  <author>
    <name>ASP</name>
  </author>
${entries}
</feed>
`;
}

export function renderSitemap(articles) {
  const articleUrls = articles.map(
    (article) => `  <url>
    <loc>${escapeXml(article.url)}</loc>
    <lastmod>${article.date}</lastmod>
  </url>`
  );

  const staticUrls = STATIC_PAGES.map(
    (pathname) => `  <url>
    <loc>${SITE_ORIGIN}${pathname === "/" ? "/" : pathname}</loc>
  </url>`
  );

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${[...staticUrls, ...articleUrls].join("\n")}
</urlset>
`;
}

export function renderRobots() {
  // The Console is a workspace, not a publication.
  return `User-agent: *
Allow: /
Disallow: /console
Disallow: /console.html

Sitemap: ${SITE_ORIGIN}/sitemap.xml
`;
}

/** Read every published article page, newest first. */
export async function collectArticles(directory) {
  const files = (await readdir(directory))
    .filter((name) => name.endsWith(".html") && name !== "index.html")
    .sort();

  const articles = [];
  for (const name of files) {
    const html = await readFile(path.join(directory, name), "utf8");
    articles.push(parseArticle(html, { pathname: `/articles/${name}` }));
  }

  articles.sort((left, right) => right.date.localeCompare(left.date) || left.pathname.localeCompare(right.pathname));
  return articles;
}

/**
 * Write the four artefacts and refuse to leave a half-broken one behind: a
 * generated page never passes through the linter, so it checks itself.
 */
/**
 * The home page is hand-written, so it can keep promoting a post that was
 * replaced — which is how a freshly published article ends up reachable only
 * from the footer. The archive, the feed and the sitemap all update themselves;
 * the page a reader actually lands on does not.
 */
export function homePromotesNewest(homeHtml, articles) {
  const newest = articles[0]?.pathname ?? null;
  if (!newest) return { newest: null, promoted: true };
  return { newest, promoted: homeHtml.includes(newest) };
}

export async function buildDiscovery({
  sourceDirectory = rootDirectory,
  outputDirectory = path.join(rootDirectory, "dist"),
  now = new Date(),
  recentPostsLimit = 5
} = {}) {
  const homeHtml = await readFile(path.join(sourceDirectory, "index.html"), "utf8");
  const chrome = extractChrome(homeHtml);
  const articles = await collectArticles(path.join(sourceDirectory, "articles"));
  const home = homePromotesNewest(homeHtml, articles);

  const articlesDirectory = path.join(outputDirectory, "articles");
  await mkdir(articlesDirectory, { recursive: true });

  const index = renderArticlesIndex(articles, chrome);
  if (!index.includes('rel="canonical"') || !index.includes("<h1>")) {
    throw new Error("The generated archive index is missing its canonical URL or heading.");
  }

  const feed = renderAtomFeed(articles, { updated: now.toISOString() });
  if (!/<entry>/.test(feed) && articles.length > 0) {
    throw new Error("The generated feed has no entries.");
  }

  const sitemap = renderSitemap(articles);
  const robots = renderRobots();

  await Promise.all([
    writeFile(path.join(articlesDirectory, "index.html"), index, "utf8"),
    writeFile(path.join(outputDirectory, "feed.xml"), feed, "utf8"),
    writeFile(path.join(outputDirectory, "sitemap.xml"), sitemap, "utf8"),
    writeFile(path.join(outputDirectory, "robots.txt"), robots, "utf8")
  ]);

  // The home is hand-written, so its "recent posts" list is injected into the
  // built copy: a reader can always walk back through the last few editions,
  // and the list cannot go stale the way a hand-maintained one would.
  const builtHomePath = path.join(outputDirectory, "index.html");
  const builtHome = await readFile(builtHomePath, "utf8").catch(() => null);
  let recent = false;
  if (builtHome !== null) {
    const withRecent = injectRecentPosts(builtHome, articles, { limit: recentPostsLimit });
    recent = withRecent !== builtHome;
    if (recent) await writeFile(builtHomePath, withRecent, "utf8");
  }

  // Every article gets the edition before and after it, injected into the built
  // copy. The source page stays free of links it cannot know about, and adding a
  // month updates its neighbours on the next build instead of on someone's
  // memory.
  let navInjected = 0;
  for (const [index, article] of articles.entries()) {
    const builtPath = path.join(outputDirectory, article.pathname);
    const source = await readFile(builtPath, "utf8").catch(() => null);
    if (source === null) continue;
    const withNav = injectArticleNav(source, renderArticleNav(articles, index));
    if (withNav !== source) {
      await writeFile(builtPath, withNav, "utf8");
      navInjected += 1;
    }
  }

  return {
    articles: articles.length,
    newest: articles[0]?.date ?? null,
    home,
    recentPosts: recent,
    articleNav: navInjected
  };
}

/**
 * "Previous" is the older edition and "Next" the newer one, the way a magazine
 * reads. Only the neighbours that exist are rendered.
 */
export function renderArticleNav(articles, index) {
  const older = articles[index + 1] ?? null;
  const newer = articles[index - 1] ?? null;
  if (!older && !newer) return "";

  const links = [];
  if (older) {
    links.push(
      `    <a class="text-link" href="${escapeXml(older.pathname)}" rel="prev">← Previous: ${escapeXml(older.headline)}</a>`
    );
  }
  if (newer) {
    links.push(
      `    <a class="text-link" href="${escapeXml(newer.pathname)}" rel="next">Next: ${escapeXml(newer.headline)} →</a>`
    );
  }

  return `  <nav class="article-nav shell narrow" aria-label="More editions">
${links.join("\n")}
  </nav>`;
}

export function injectArticleNav(html, nav) {
  if (!nav || typeof html !== "string") return html;
  const anchor = '<footer class="site-footer">';
  const at = html.indexOf(anchor);
  if (at === -1) return html;
  return `${html.slice(0, at)}${nav}\n\n  ${html.slice(at)}`;
}

/**
 * Insert the recent-editions list immediately before the footer. Returns the
 * markup untouched when there is nothing to list or the footer is missing.
 */
export function injectRecentPosts(homeHtml, articles, { limit = 5 } = {}) {
  if (!Array.isArray(articles) || articles.length === 0) return homeHtml;
  const anchor = '<footer class="site-footer">';
  const at = homeHtml.indexOf(anchor);
  if (at === -1) return homeHtml;

  const section = renderRecentPosts(articles, { limit });
  if (section === "") return homeHtml;
  return `${homeHtml.slice(0, at)}${section}\n\n  ${homeHtml.slice(at)}`;
}

export function renderRecentPosts(articles, { limit = 5 } = {}) {
  const recent = articles.slice(0, limit);
  if (recent.length === 0) return "";

  const cards = recent
    .map(
      (article) => `        <article class="content-card">
          <span class="card-kicker">${escapeXml(humanDate(article.date))}</span>
          <h3><a href="${escapeXml(article.pathname)}">${escapeXml(article.headline)}</a></h3>
          <p>${escapeXml(article.deck || article.description)}</p>
        </article>`
    )
    .join("\n");

  return `  <section class="section">
    <div class="shell">
      <div class="section-heading">
        <div>
          <p class="eyebrow">Previous editions</p>
          <h2>More from the radar</h2>
        </div>
        <a class="text-link" href="/articles/">All posts →</a>
      </div>
      <div class="card-grid">
${cards}
      </div>
    </div>
  </section>`;
}

const invokedDirectly =
  typeof process.argv[1] === "string" &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const outputFlag = process.argv.indexOf("--output");
  const output =
    outputFlag !== -1 && process.argv[outputFlag + 1]
      ? path.resolve(rootDirectory, process.argv[outputFlag + 1])
      : path.join(rootDirectory, "dist");

  buildDiscovery({ outputDirectory: output })
    .then((result) => {
      console.log(
        `${result.articles} article(s), newest ${result.newest ?? "(none)"}: wrote articles/index.html, feed.xml, sitemap.xml, robots.txt into ${path.relative(rootDirectory, output)}.`
      );
    })
    .catch((error) => {
      console.error(`ERROR DISCOVERY: ${error.stack ?? error.message}`);
      process.exitCode = 1;
    });
}
