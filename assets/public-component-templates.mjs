import { EDITORIAL_STATUSES, EDITORIAL_VERDICTS } from "./content-blocks.mjs";

const PAGE_TEMPLATES = Object.freeze({
  home: "/index.html",
  radar: "/articles/radar-setembro-22.html",
  lab: "/lab.html"
});

export const PUBLIC_COMPONENT_BLOCK_IDS = Object.freeze([
  "home-hero",
  "home-radar-article",
  "home-plugin-audit",
  "radar-gold-6-review",
  "radar-big-bottom-review",
  "radar-waves-review",
  "lab-jack-in-the-box"
]);

async function fetchPage(url, fetcher, parseDocument) {
  let response;
  try {
    response = await fetcher(url, {
      headers: { Accept: "text/html" },
      credentials: "same-origin"
    });
  } catch (error) {
    throw new Error(
      `Could not load public component templates from ${url}: ${error.message}`,
      { cause: error }
    );
  }
  if (!response.ok) {
    throw new Error(
      `Could not load public component templates from ${url} (${response.status}).`
    );
  }
  try {
    return parseDocument(await response.text());
  } catch (error) {
    throw new Error(
      `Could not parse public component templates from ${url}: ${error.message}`,
      { cause: error }
    );
  }
}

function updateText(root, selector, value) {
  const node = root?.querySelector(selector);
  if (node && value !== undefined) node.textContent = value;
}

function readText(root, selector) {
  const node = root?.querySelector(selector);
  if (!node) return "";
  const copy = node.cloneNode(true);
  for (const lineBreak of copy.querySelectorAll("br")) {
    lineBreak.replaceWith(document.createTextNode("\n"));
  }
  return copy.textContent.replace(/[ \t]+\n/g, "\n").trim();
}

function readComponent(blockId, type, component) {
  const content = {};
  const metadata = {};

  if (type === "hero") {
    content.eyebrow = readText(component, ".hero-copy .eyebrow");
    content.title = readText(component, ".hero-copy h1");
    content.intro = readText(component, ".hero-intro");
    content.panelLabel = readText(component, ".hero-panel .panel-label");
    content.panelText = readText(component, ".hero-panel p");
  } else if (type === "article") {
    content.tag = readText(component, ".featured-meta .tag");
    content.title = readText(component, ":scope > h3");
    content.deck = readText(component, ".featured-deck");
    content.body = readText(component, ":scope > p:not(.featured-deck)");
    content.date = component.querySelector(".featured-meta time")?.dateTime ?? "";
    const link = component.querySelector(":scope > a");
    if (link) {
      content.href = link.getAttribute("href");
      content.linkLabel = readText(component, ":scope > a");
    }
  } else if (type === "product-review") {
    content.title = readText(component, ":scope > h2");
    content.body = readText(component, ":scope > p:not(.editorial-note)");
    const note = component.querySelector(".editorial-note");
    content.verdict = note?.textContent?.trim() ?? "";
    content.verdict = content.verdict.replace(/^(?:ASP verdict|Verdict|Editorial status):\s*/i, "");
    const label = readText(component, ".status-badge");
    if (EDITORIAL_STATUSES.includes(label)) {
      metadata.editorialStatus = label;
    } else if (label) {
      content.reviewLabel = label;
    }
    const displayedVerdict = readText(component, ".verdict-badge");
    metadata.verdict = EDITORIAL_VERDICTS.find(
      (verdict) => verdict.toLowerCase() === displayedVerdict.toLowerCase()
    ) ?? "";
    const link = component.querySelector(":scope > a");
    if (link) {
      content.href = link.getAttribute("href");
      content.linkLabel = readText(component, ":scope > a");
    }
    if (blockId === "radar-waves-review") {
      metadata.editorialStage = "PREPARAÇÃO";
    }
  } else if (type === "project") {
    content.badge = readText(component, ".project-header .status-badge");
    content.title = readText(component, ".project-header h2");
    content.stage = readText(component, ".project-stage");
    content.body = readText(component, ":scope > p");
    const details = component.querySelectorAll(".project-grid > div");
    content.focus = readText(details[0], "p");
    content.milestone = readText(details[1], "p");
  }
  return { content, metadata };
}

function applyBlockContent(block, component) {
  const { content } = block;
  if (block.type === "hero") {
    updateText(component, ".hero-copy .eyebrow", content.eyebrow);
    updateText(component, ".hero-copy h1", content.title);
    updateText(component, ".hero-intro", content.intro);
    updateText(component, ".hero-panel .panel-label", content.panelLabel);
    updateText(component, ".hero-panel p", content.panelText);
  } else if (block.type === "article") {
    updateText(component, ".featured-meta .tag", content.tag);
    updateText(component, ":scope > h3", content.title);
    updateText(component, ".featured-deck", content.deck);
    updateText(component, ":scope > p:not(.featured-deck)", content.body);
    const time = component.querySelector(".featured-meta time");
    if (time && content.date) {
      time.dateTime = content.date;
      time.textContent = new Intl.DateTimeFormat("en", {
        dateStyle: "long",
        timeZone: "UTC"
      }).format(new Date(`${content.date}T00:00:00Z`));
    }
    const link = component.querySelector(":scope > a");
    if (link) {
      link.href = content.href;
      link.textContent = content.linkLabel;
    }
  } else if (block.type === "product-review") {
    const verdict = component.querySelector(".verdict-badge");
    if (verdict) {
      verdict.className = `verdict-badge ${String(block.metadata.verdict).toLowerCase().replaceAll(" ", "-")}`;
      verdict.textContent = block.metadata.verdict;
    }
    updateText(component, ".status-badge", content.reviewLabel || block.metadata.editorialStatus);
    updateText(component, ":scope > h2", content.title);
    updateText(component, ":scope > p:not(.editorial-note)", content.body);
    const note = component.querySelector(".editorial-note");
    if (note) {
      const strong = note.querySelector("strong");
      note.replaceChildren();
      if (strong) {
        note.append(strong, document.createTextNode(` ${content.verdict}`));
      } else {
        note.textContent = content.verdict;
      }
    }
    const link = component.querySelector(":scope > a");
    if (link) {
      link.href = content.href;
      link.textContent = content.linkLabel;
    }
  } else if (block.type === "project") {
    updateText(component, ".project-header .status-badge", content.badge);
    updateText(component, ".project-header h2", content.title);
    updateText(component, ".project-stage", content.stage);
    updateText(component, ":scope > p", content.body);
    const details = component.querySelectorAll(".project-grid > div");
    updateText(details[0], "p", content.focus);
    updateText(details[1], "p", content.milestone);
  }
  return component;
}

export async function loadPublicComponentTemplates({
  fetcher = globalThis.fetch,
  parseDocument = (html) => new DOMParser().parseFromString(html, "text/html"),
  createOfferElement = (promotionId) => {
    const element = document.createElement("affiliate-offer");
    element.setAttribute("promotion-id", promotionId);
    return element;
  }
} = {}) {
  if (typeof fetcher !== "function") {
    throw new TypeError("A fetch implementation is required to load public components.");
  }

  const pages = await Promise.all(
    Object.entries(PAGE_TEMPLATES).map(async ([name, url]) => [
      name,
      await fetchPage(url, fetcher, parseDocument)
    ])
  );
  const documents = Object.fromEntries(pages);
  const templates = new Map();

  function add(id, type, source, selector, index = 0) {
    const component = source.querySelectorAll(selector)[index];
    if (!component) {
      throw new Error(`Public component template "${id}" was not found (${selector}).`);
    }
    templates.set(id, { type, component });
  }

  add("home-hero", "hero", documents.home, "main > .hero");
  add("home-radar-article", "article", documents.home, ".featured-card", 0);
  add("home-plugin-audit", "article", documents.home, ".featured-card", 1);
  add("radar-gold-6-review", "product-review", documents.radar, ".product-review", 0);
  add("radar-big-bottom-review", "product-review", documents.radar, ".product-review", 1);
  add("radar-waves-review", "product-review", documents.radar, ".product-review", 2);
  add("lab-jack-in-the-box", "project", documents.lab, ".project-card");

  function renderPublicComponent(block) {
    const template = templates.get(block.id);
    if (template && template.type !== block.type) {
      throw new TypeError(`Content block ${block.id} no longer matches its public component template.`);
    }
    if (block.type === "deal") {
      return createOfferElement(block.content.promotionId);
    }
    if (!template) {
      throw new Error(`No existing public component is mapped to content block ${block.id}.`);
    }
    return applyBlockContent(block, template.component.cloneNode(true));
  }
  renderPublicComponent.hasTemplate = (blockId, type) =>
    templates.get(blockId)?.type === type;

  function readInitialContent(blockId) {
    const template = templates.get(blockId);
    if (!template) {
      throw new Error(`No existing public component is mapped to content block ${blockId}.`);
    }
    return readComponent(blockId, template.type, template.component);
  }

  return { renderPublicComponent, readInitialContent };
}
