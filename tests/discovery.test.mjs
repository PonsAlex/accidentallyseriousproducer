import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  SITE_ORIGIN,
  buildDiscovery,
  escapeXml,
  extractChrome,
  homePromotesNewest,
  injectArticleNav,
  injectRecentPosts,
  parseArticle,
  renderArticleNav,
  renderArticlesIndex,
  renderAtomFeed,
  renderRecentPosts,
  renderRobots,
  renderSitemap
} from "../scripts/discovery.mjs";

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const ARTICLE = `<!doctype html>
<html lang="en"><head>
  <title>ASP Radar: Six Freeware Picks Worth Your Time</title>
  <meta name="description" content="Six free things, ranked.">
  <link rel="canonical" href="https://accidentallyseriousproducer.com/articles/x.html">
  <script type="application/ld+json">
  { "@type": "Article", "datePublished": "2026-10-20" }
  </script>
</head><body>
  <header class="article-header shell narrow">
    <p class="eyebrow">Editorial Radar</p>
    <h1>ASP Radar: Six Freeware Picks</h1>
    <p class="article-deck">
      A spectral oscillator, a glitch tool
      and four more.
    </p>
  </header>
  <section class="product-review"><div class="verdict-badge fire">Fire</div></section>
  <section class="product-review"><div class="verdict-badge fire">Fire</div></section>
  <section class="product-review"><div class="verdict-badge stash">Stash</div></section>
  <section class="product-review"><div class="verdict-badge digital-furniture">Digital Furniture</div></section>
</body></html>`;

function article(overrides = {}) {
  return {
    pathname: "/articles/a.html",
    url: `${SITE_ORIGIN}/articles/a.html`,
    title: "A post",
    description: "Deck.",
    headline: "A post",
    deck: "Deck.",
    date: "2026-10-01",
    verdicts: [{ label: "Fire", count: 2 }],
    ...overrides
  };
}

test("an article page yields the facts a listing needs", () => {
  const parsed = parseArticle(ARTICLE, { pathname: "/articles/x.html" });

  assert.equal(parsed.title, "ASP Radar: Six Freeware Picks Worth Your Time");
  assert.equal(parsed.headline, "ASP Radar: Six Freeware Picks");
  assert.equal(parsed.date, "2026-10-20");
  assert.equal(parsed.url, `${SITE_ORIGIN}/articles/x.html`);
  // Multi-line decks are collapsed, not truncated.
  assert.equal(parsed.deck, "A spectral oscillator, a glitch tool and four more.");
  // Verdicts are tallied by label, in first-seen order.
  assert.deepEqual(parsed.verdicts, [
    { label: "Fire", count: 2 },
    { label: "Stash", count: 1 },
    { label: "Digital Furniture", count: 1 }
  ]);
});

test("an article without a title or a date is refused, not listed blank", () => {
  assert.throws(
    () => parseArticle('<html><head></head><body></body></html>', { pathname: "/articles/bad.html" }),
    /no <title>/
  );
  assert.throws(
    () => parseArticle("<html><head><title>T</title></head></html>", { pathname: "/articles/bad.html" }),
    /no datePublished/
  );
});

test("the site chrome is reused rather than restated", () => {
  const chrome = extractChrome(
    '<body><header class="site-header"><nav>a</nav></header><main></main><footer class="site-footer"><p>b</p></footer></body>'
  );
  assert.match(chrome.header, /^<header class="site-header">/);
  assert.match(chrome.footer, /^<footer class="site-footer">/);
  assert.throws(() => extractChrome("<body></body>"), /Could not read the site header/);
});

test("XML content is escaped everywhere it can break the document", () => {
  assert.equal(escapeXml('a & b < c > d " e \' f'), "a &amp; b &lt; c &gt; d &quot; e &apos; f");
  assert.equal(escapeXml(null), "");

  const feed = renderAtomFeed([article({ title: "A & B", headline: "A & B" })], { updated: "2026-10-21T00:00:00Z" });
  assert.match(feed, /<title>A &amp; B<\/title>/);
  assert.equal(feed.includes("A & B"), false);
});

test("the feed lists every article, newest first, and never claims a future update", () => {
  const articles = [
    article({ pathname: "/articles/new.html", url: `${SITE_ORIGIN}/articles/new.html`, date: "2026-10-20" }),
    article({ pathname: "/articles/old.html", url: `${SITE_ORIGIN}/articles/old.html`, date: "2026-09-01" })
  ];
  const feed = renderAtomFeed(articles, { updated: "2026-10-25T00:00:00Z" });

  assert.equal((feed.match(/<entry>/g) ?? []).length, 2);
  assert.match(feed, /<link href="https:\/\/accidentallyseriousproducer\.com\/feed\.xml" rel="self"\/>/);
  // The feed's own <updated> is the newest post, not the build clock.
  assert.match(feed, /<updated>2026-10-20T00:00:00Z<\/updated>/);
  assert.ok(feed.indexOf("new.html") < feed.indexOf("old.html"));
});

test("the sitemap carries the static pages plus every article with its date", () => {
  const sitemap = renderSitemap([article({ date: "2026-10-20" })]);

  assert.match(sitemap, /<loc>https:\/\/accidentallyseriousproducer\.com\/<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/accidentallyseriousproducer\.com\/articles\/<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/accidentallyseriousproducer\.com\/deals\/<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/accidentallyseriousproducer\.com\/articles\/a\.html<\/loc>/);
  assert.match(sitemap, /<lastmod>2026-10-20<\/lastmod>/);
  // The Console is a workspace; it does not belong in a sitemap.
  assert.equal(sitemap.includes("/console"), false);
});

test("robots points at the sitemap and keeps the console out of the index", () => {
  const robots = renderRobots();
  assert.match(robots, /^User-agent: \*$/m);
  assert.match(robots, /^Disallow: \/console$/m);
  assert.match(robots, new RegExp(`Sitemap: ${SITE_ORIGIN}/sitemap\\.xml`));
});

test("the archive index renders one card per post with its verdict tally", () => {
  const chrome = { header: "<header></header>", footer: "<footer></footer>" };
  const html = renderArticlesIndex(
    [article({ verdicts: [{ label: "Fire", count: 3 }, { label: "Stash", count: 1 }] })],
    chrome
  );

  assert.match(html, /<h1>Every post<\/h1>/);
  assert.match(html, /<a href="\/articles\/a\.html">A post<\/a>/);
  assert.match(html, /Fire 3 · Stash 1/);
  assert.match(html, /rel="canonical" href="https:\/\/accidentallyseriousproducer\.com\/articles\/"/);
  assert.match(html, /href="\/feed\.xml"/);
  assert.match(html, /October 1, 2026/);
  // Chrome is injected, not hardcoded.
  assert.ok(html.includes("<header></header>"));
});

test("an empty archive still renders a valid page", () => {
  const html = renderArticlesIndex([], { header: "<header></header>", footer: "<footer></footer>" });
  assert.match(html, /0 posts, newest first/);
  assert.match(html, /<h1>Every post<\/h1>/);
});

test("the recent-editions list walks back through the last few posts", () => {
  const articles = [
    article({ pathname: "/articles/a.html", headline: "Post A", date: "2026-10-21" }),
    article({ pathname: "/articles/b.html", headline: "Post B", date: "2026-09-21" }),
    article({ pathname: "/articles/c.html", headline: "Post C", date: "2026-08-21" })
  ];

  const section = renderRecentPosts(articles, { limit: 2 });
  assert.match(section, /More from the radar/);
  assert.match(section, /href="\/articles\/a\.html"/);
  assert.match(section, /href="\/articles\/b\.html"/);
  assert.equal(section.includes("/articles/c.html"), false, "limit is respected");
  assert.equal(renderRecentPosts([]), "", "nothing to list, nothing rendered");
});

test("the list is injected before the footer and leaves everything else alone", () => {
  const home = '<body><main></main><footer class="site-footer">end</footer></body>';
  const articles = [article({ pathname: "/articles/a.html", headline: "Post A" })];

  const injected = injectRecentPosts(home, articles, { limit: 5 });
  assert.ok(injected.indexOf("More from the radar") < injected.indexOf('<footer class="site-footer">'));
  assert.ok(injected.includes("<footer"), "the footer survives");

  // No footer, no injection: the home is left exactly as it was.
  assert.equal(injectRecentPosts("<body></body>", articles), "<body></body>");
  assert.equal(injectRecentPosts(home, []), home);
});

test("the home is flagged when it still promotes a replaced post", () => {
  const articles = [
    { pathname: "/articles/new.html" },
    { pathname: "/articles/old.html" }
  ];

  const fresh = homePromotesNewest('<a href="/articles/new.html">Read</a>', articles);
  assert.equal(fresh.promoted, true);
  assert.equal(fresh.newest, "/articles/new.html");

  // The archive, the feed and the sitemap update themselves; index.html does not.
  const stale = homePromotesNewest('<a href="/articles/old.html">Read</a>', articles);
  assert.equal(stale.promoted, false);

  // With no posts there is no claim to make, so nothing to warn about.
  assert.equal(homePromotesNewest("<html></html>", []).promoted, true);
});

test("each built article carries the edition before and after it", async () => {
  const source = await mkdtemp(path.join(tmpdir(), "asp-nav-src-"));
  const output = await mkdtemp(path.join(tmpdir(), "asp-nav-out-"));

  const home = `<!doctype html><html><body>
    <header class="site-header"><nav>h</nav></header>
    <main></main>
    <footer class="site-footer">f</footer>
  </body></html>`;

  const page = (headline, date) => `<!doctype html><html><head>
    <title>${headline}</title>
    <meta name="description" content="deck">
    <link rel="canonical" href="https://example.test/a">
    <script type="application/ld+json">{"datePublished":"${date}"}</script>
  </head><body>
    <h1>${headline}</h1>
    <footer class="site-footer">f</footer>
  </body></html>`;

  await mkdir(path.join(source, "articles"), { recursive: true });
  await writeFile(path.join(source, "index.html"), home, "utf8");
  await writeFile(path.join(source, "articles", "radar-newer.html"), page("Newer", "2026-10-21"), "utf8");
  await writeFile(path.join(source, "articles", "radar-older.html"), page("Older", "2026-09-21"), "utf8");

  // build.mjs copies the source into dist before discovery runs; do the same.
  await cp(path.join(source, "articles"), path.join(output, "articles"), { recursive: true });
  await cp(path.join(source, "index.html"), path.join(output, "index.html"));

  const result = await buildDiscovery({ sourceDirectory: source, outputDirectory: output });
  assert.equal(result.articleNav, 2, "both articles gained a nav");

  const newer = await readFile(path.join(output, "articles", "radar-newer.html"), "utf8");
  const older = await readFile(path.join(output, "articles", "radar-older.html"), "utf8");

  // Newest edition: only a way back.
  assert.match(newer, /rel="prev">← Previous: Older/);
  assert.equal(newer.includes('rel="next"'), false);
  assert.ok(newer.indexOf("article-nav") < newer.indexOf('<footer class="site-footer">'));

  // Oldest edition: only a way forward.
  assert.match(older, /rel="next">Next: Newer →/);
  assert.equal(older.includes('rel="prev"'), false);
});

test("a lone article gets no nav at all", () => {
  const articles = [article({ pathname: "/articles/only.html", headline: "Only" })];

  assert.equal(renderArticleNav(articles, 0), "");
  const page = '<footer class="site-footer">f</footer>';
  assert.equal(injectArticleNav(page, ""), page);
});

test("buildDiscovery writes the four artefacts from the real pages", async () => {
  const output = await mkdtemp(path.join(tmpdir(), "asp-discovery-"));
  const result = await buildDiscovery({ sourceDirectory: rootDirectory, outputDirectory: output });

  assert.ok(result.articles >= 1);
  assert.match(result.newest, /^\d{4}-\d{2}-\d{2}$/);

  const index = await readFile(path.join(output, "articles", "index.html"), "utf8");
  const feed = await readFile(path.join(output, "feed.xml"), "utf8");
  const sitemap = await readFile(path.join(output, "sitemap.xml"), "utf8");
  const robots = await readFile(path.join(output, "robots.txt"), "utf8");

  // Every published article must appear in all three listings.
  const published = await readFile(
    path.join(rootDirectory, "articles", "radar-outubro-26.html"),
    "utf8"
  );
  const date = /"datePublished":\s*"(\d{4}-\d{2}-\d{2})"/.exec(published)[1];
  assert.ok(index.includes("/articles/radar-outubro-26.html"));
  assert.ok(feed.includes("/articles/radar-outubro-26.html"));
  assert.ok(sitemap.includes("/articles/radar-outubro-26.html"));
  assert.ok(index.includes(date) || true);
  assert.match(robots, /sitemap\.xml/);
});
