import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const STAGE_ORDER = [
  "RADAR",
  "PREPARAÇÃO",
  "SELEÇÃO EDITORIAL",
  "BRANCH EDITORIAL",
  "PREVIEW / HUMAN REVIEW",
  "PUBLICATION GATE"
];

export const STAGE_ALIASES = {
  RADAR: ["RADAR", "Radar"],
  PREPARAÇÃO: [
    "PREPARAÇÃO",
    "Preparação",
    "PREPARACAO",
    "Preparacao",
    "EVIDÊNCIA",
    "EVIDENCIA",
    "EVIDENCE",
    "Preparação — Evidência",
    "Preparacao — Evidencia"
  ],
  "SELEÇÃO EDITORIAL": ["SELEÇÃO EDITORIAL", "SELECAO EDITORIAL", "Seleção editorial", "Selecao editorial"],
  "BRANCH EDITORIAL": ["BRANCH EDITORIAL", "Branch editorial", "Branch Editorial"],
  "PREVIEW / HUMAN REVIEW": ["PREVIEW / HUMAN REVIEW", "Preview / Human review", "PREVIEW / HUMAN REVIEW"],
  "PUBLICATION GATE": ["PUBLICATION GATE", "Publication gate"]
};

export const PROJECT_CONFIG = {
  projectId: "PVT_kwHOAvRCkM4BgQi6",
  stageFieldId: "PVTSSF_lAHOAvRCkM4BgQi6zhagFjM",
  stageOptionIds: {
    RADAR: "43a51db4",
    PREPARAÇÃO: "84f41bd5",
    "SELEÇÃO EDITORIAL": "7e221e03",
    "BRANCH EDITORIAL": "54295ea8",
    "PREVIEW / HUMAN REVIEW": "2c22896f",
    "PUBLICATION GATE": "7723b6d0"
  }
};

import { STAGE_TITLES, STAGE_CHECKLISTS } from "./editorial-checklists.mjs";

const ISSUE_ITEM_HEADING = /^###\s+(.+)$/gm;
const ADVANCE_CHECKBOX_RE = /(?:^|\n)\s*[*-]\s*\[\s*x\s*\]\s*(?:\*\*)?AVANÇAR(?:\*\*)?\s*(?:\n|$)/im;
const PROCESSED_MARKER_RE = /<!--\s*asp-editorial-advance:.*?-->|↗ Avançado para #\d+\s*—/is;

function removeDiacritics(value = "") {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\*/g, "")
    .trim();
}

export function normalizeStageName(value = "") {
  const candidate = removeDiacritics(String(value ?? "")).toUpperCase();
  if (!candidate) return "";

  for (const [stage, aliases] of Object.entries(STAGE_ALIASES)) {
    for (const alias of aliases) {
      if (candidate === removeDiacritics(alias).toUpperCase()) {
        return stage;
      }
    }
  }

  return "";
}

export function findStageLabelInText(text = "") {
  const lines = String(text ?? "").split(/\r?\n/);
  let legacyPreparation = "";
  for (const line of lines) {
    const normalized = normalizeStageName(line);
    if (!normalized) continue;

    const candidate = removeDiacritics(line).toUpperCase();
    const isLegacyEvidence = [
      "EVIDENCIA",
      "EVIDENCE",
      "PREPARACAO — EVIDENCIA"
    ].includes(candidate);

    if (isLegacyEvidence) {
      legacyPreparation = "PREPARAÇÃO";
      continue;
    }

    return normalized;
  }
  return legacyPreparation;
}

export function parseIssueCards(issueBody = "") {
  const cards = [];
  const headings = [...String(issueBody ?? "").matchAll(ISSUE_ITEM_HEADING)];

  for (let index = 0; index < headings.length; index += 1) {
    const match = headings[index];
    const nextMatch = headings[index + 1];
    const title = match[1].trim();
    const start = match.index + match[0].length;
    const end = nextMatch ? nextMatch.index : String(issueBody ?? "").length;
    const rawContent = String(issueBody ?? "").slice(start, end).trim();

    cards.push({
      title,
      stage: findStageLabelInText(rawContent),
      body: rawContent,
      advanceSelected: ADVANCE_CHECKBOX_RE.test(rawContent),
      processed: PROCESSED_MARKER_RE.test(rawContent)
    });
  }

  return cards;
}

export function hasFreeClaim(body = "") {
  const haystack = String(body ?? "").toLowerCase();
  return /(freebie|free|gratuit|gratis|free with purchase|gratuidade|oferta gratuita|produto gratuito|possible free|free offer)/i.test(haystack);
}

export function determineNextStage(currentStage = "", body = "") {
  const stageName = normalizeStageName(currentStage);

  if (stageName === "RADAR") return "PREPARAÇÃO";
  if (stageName === "PREPARAÇÃO") return "SELEÇÃO EDITORIAL";
  if (stageName === "SELEÇÃO EDITORIAL") return "BRANCH EDITORIAL";
  if (stageName === "BRANCH EDITORIAL") return "PREVIEW / HUMAN REVIEW";
  if (stageName === "PREVIEW / HUMAN REVIEW") return "PUBLICATION GATE";
  return null;
}

function isAdvanceControlLine(line = "") {
  return /^\s*[*-]\s*\[[ xX]\]\s*(?:\*\*)?AVANÇAR(?:\*\*)?\s*$/.test(String(line ?? ""));
}

function isChecklistLine(line = "") {
  return /^\s*[*-]\s*\[[ xX]\]\s+/.test(String(line ?? ""));
}

function isStageContentHeadingLine(line = "") {
  if (normalizeStageName(line)) return true;

  const candidate = removeDiacritics(line).toUpperCase();
  const headings = [
    ...Object.keys(STAGE_CHECKLISTS),
    ...Object.values(STAGE_TITLES),
    ...Object.values(STAGE_CHECKLISTS)
      .filter((checklist) => Array.isArray(checklist))
      .flatMap((checklist) => checklist.filter((entry) => typeof entry === "object").map((entry) => entry.title))
  ];

  return headings.some((heading) => candidate === removeDiacritics(heading).toUpperCase());
}

function stripStageContent(body = "") {
  const lines = String(body ?? "").split(/\r?\n/);
  const safeLines = [];
  let stageSeen = false;

  for (const line of lines) {
    if (isAdvanceControlLine(line)) {
      continue;
    }
    if (!stageSeen) {
      const normalized = normalizeStageName(line);
      if (normalized) {
        stageSeen = true;
        continue;
      }
      safeLines.push(line);
      continue;
    }

    if (isChecklistLine(line)) {
      continue;
    }
    if (isStageContentHeadingLine(line) || /^\s*---\s*$/.test(line)) {
      continue;
    }
    safeLines.push(line);
  }

  return safeLines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function renderStageChecklist(stageName = "EVIDÊNCIA") {
  const orderedStage = normalizeStageName(stageName) || "PREPARAÇÃO";
  if (orderedStage === "PREPARAÇÃO") {
    return renderChecklistGroup("Preparação — Evidência", STAGE_CHECKLISTS.EVIDÊNCIA);
  }
  const checklist = STAGE_CHECKLISTS[orderedStage] ?? STAGE_CHECKLISTS.EVIDÊNCIA;
  const title = STAGE_TITLES[orderedStage] || orderedStage;

  // Support both simple arrays of items and grouped checklists with titles + items
  if (Array.isArray(checklist) && checklist.length > 0 && typeof checklist[0] === "object" && checklist[0].items) {
    // grouped
    return checklist
      .map((group) => `**${group.title}**\n\n${group.items.map((it) => `* [ ] ${it}`).join("\n")}`)
      .join("\n\n");
  }

  const items = Array.isArray(checklist) ? checklist : [];
  return `**${title}**\n\n${items.map((entry) => `* [ ] ${entry}`).join("\n")}`;
}

export function renderChecklistGroup(title, items) {
  return `**${title}**\n\n${items.map((it) => `* [ ] ${it}`).join("\n")}`;
}

export function buildSelectedItemBody(card, nextStage) {
  const contentBeforeStage = stripStageContent(card.body || "").trim();
  const chunks = [];
  if (contentBeforeStage) chunks.push(contentBeforeStage);

  // PREPARAÇÃO contains evidence and, only for a free claim, free qualification.
  if (nextStage === "PREPARAÇÃO") {
    // Use canonical EVIDÊNCIA checklist as the Preparação — Evidência group
    const evidenciaItems = STAGE_CHECKLISTS["EVIDÊNCIA"] || STAGE_CHECKLISTS.EVIDÊNCIA || [];
    chunks.push(renderChecklistGroup("Preparação — Evidência", evidenciaItems));

    if (hasFreeClaim(card.body || "")) {
      const freeItems = STAGE_CHECKLISTS["FREE QUALIFICATION"] || [];
      chunks.push(renderChecklistGroup("Preparação — Free Qualification", freeItems));
    }

    return chunks.join("\n\n").trim();
  }

  chunks.push(renderStageChecklist(nextStage));
  return chunks.join("\n\n").trim();
}

export function buildAdvancedIssueBody(selectedCards, sourceIssueNumber, nextStage) {
  const items = selectedCards
    .filter((card) => !card.processed)
    .map((card) => {
      const title = card.title || "Item editorial";
      const itemBody = buildSelectedItemBody(card, nextStage);
      return `### ${title}\n\n* [ ] **AVANÇAR**\n\n**${nextStage}**\n\n${itemBody}`;
    })
    .join("\n\n---\n\n");

  const referenceLine = `↗ Avançado da issue #${sourceIssueNumber} para ${nextStage}.`;
  return `${referenceLine}\n\n${items}`.trim();
}

export function processAdvanceRequest(issueBody = "", sourceIssueNumber = "") {
  const cards = parseIssueCards(issueBody);
  const selected = cards.filter((card) => card.advanceSelected && !card.processed);

  const processable = [];
  const unprocessable = [];
  const terminal = [];
  const byStage = new Map();

  for (const card of selected) {
    if (normalizeStageName(card.stage) === "PUBLICATION GATE") {
      terminal.push(card);
      continue;
    }
    const nextStage = determineNextStage(card.stage, card.body);
    if (!nextStage) {
      unprocessable.push(card);
      continue;
    }
    processable.push(card);
    const list = byStage.get(nextStage) ?? [];
    list.push(card);
    byStage.set(nextStage, list);
  }

  const nextStages = [...byStage.entries()];
  return {
    cards,
    selected,
    processable,
    unprocessable,
    terminal,
    nextStages,
    grouped: Object.fromEntries(nextStages.map(([stage, stageCards]) => [stage, stageCards])),
    noSelection: selected.length === 0,
    movedCount: processable.length,
    createdIssues: [],
    sourceIssueNumber
  };
}

async function ghRequest(url, token, method = "GET", body) {
  const response = await fetch(url, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub API request failed: ${response.status} ${response.statusText} :: ${text}`);
  }

  return response.status === 204 ? null : response.json();
}

async function graphQlRequest(token, query, variables) {
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28"
    },
    body: JSON.stringify({ query, variables })
  });
  const payload = await response.json();

  if (!response.ok || payload.errors?.length) {
    throw new Error(`GitHub GraphQL request failed: ${response.status} :: ${JSON.stringify(payload.errors ?? payload)}`);
  }
  return payload.data;
}

export async function setProjectStageForIssue(issueNodeId, stage, token, config = PROJECT_CONFIG) {
  const optionId = config.stageOptionIds[stage];
  if (!issueNodeId || !optionId || !token) {
    throw new Error(`Project stage configuration is incomplete for ${stage || "unknown stage"}.`);
  }

  const lookup = await graphQlRequest(token, `
    query ProjectItemForIssue($projectId: ID!) {
      node(id: $projectId) {
        ... on ProjectV2 {
          items(first: 100) {
            nodes { id content { ... on Issue { id } } }
          }
        }
      }
    }
  `, { projectId: config.projectId });
  let itemId = lookup.node?.items?.nodes?.find((item) => item.content?.id === issueNodeId)?.id;

  if (!itemId) {
    const added = await graphQlRequest(token, `
      mutation AddIssueToProject($projectId: ID!, $contentId: ID!) {
        addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
          item { id }
        }
      }
    `, { projectId: config.projectId, contentId: issueNodeId });
    itemId = added.addProjectV2ItemById.item.id;
  }

  await graphQlRequest(token, `
    mutation SetEditorialStage($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
      updateProjectV2ItemFieldValue(input: {
        projectId: $projectId,
        itemId: $itemId,
        fieldId: $fieldId,
        value: { singleSelectOptionId: $optionId }
      }) {
        projectV2Item { id }
      }
    }
  `, {
    projectId: config.projectId,
    itemId,
    fieldId: config.stageFieldId,
    optionId
  });

  return { itemId, stage, optionId };
}

async function createIssueComment(repo, issueNumber, token, message) {
  const url = `https://api.github.com/repos/${repo}/issues/${issueNumber}/comments`;
  return ghRequest(url, token, "POST", { body: message });
}

async function createDestinationIssue(repo, token, title, body) {
  const url = `https://api.github.com/repos/${repo}/issues`;
  return ghRequest(url, token, "POST", { title, body });
}

async function updateOriginalIssueBody(repo, issueNumber, token, body) {
  const url = `https://api.github.com/repos/${repo}/issues/${issueNumber}`;
  return ghRequest(url, token, "PATCH", { body });
}

export function markItemsProcessedInIssue(issueBody = "", selectedCards = [], createdIssues = []) {
  let updated = String(issueBody ?? "");
  const destByStage = Object.fromEntries(createdIssues.map((issue) => [issue.stage, issue.issueNumber]));

  for (const card of selectedCards) {
    const destinationStage = determineNextStage(card.stage, card.body) || card.stage || "EVIDÊNCIA";
    const destinationNumber = destByStage[destinationStage] ?? "";
    const headingEscaped = card.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(^###\\s*${headingEscaped}\\s*\\n\\s*\\n)(\\*\\s*\\[(?:x|X)\\]\\s*(?:\\*\\*)?AVANÇAR(?:\\*\\*)?\\s*\\n?)`, "m");

    updated = updated.replace(
      pattern,
      `$1* [ ] **AVANÇAR**\n\n<!-- asp-editorial-advance: ${destinationStage} -> #${destinationNumber} -->\n↗ Avançado para #${destinationNumber} — ${destinationStage}.\n\n`
    );
  }

  return updated;
}

export async function runAdvanceWorkflowFromEnv() {
  if (!process.env.GITHUB_EVENT_PATH || !process.env.GITHUB_REPOSITORY || !process.env.GITHUB_TOKEN) {
    return { skipped: true, reason: "GitHub Actions environment variables were not provided." };
  }

  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  const projectToken = process.env.ASP_PROJECT_TOKEN;
  const issueNumber = event.issue?.number;
  const issueBody = event.issue?.body ?? "";
  const commentBody = event.comment?.body ?? "";
  const commentUser = event.comment?.user?.login;

  if (!issueNumber || !commentUser || event.issue?.pull_request) {
    return { skipped: true, reason: "This workflow only processes issue comments on non-PR issues." };
  }

  const permissionUrl = `https://api.github.com/repos/${repo}/collaborators/${commentUser}/permission`;
  const permissionPayload = await ghRequest(permissionUrl, token, "GET");
  const allowed = ["admin", "maintain", "write"].includes(permissionPayload.permission);

  if (!allowed) {
    await createIssueComment(repo, issueNumber, token, "⚠️ Você não tem permissão para avançar itens editoriais.");
    return { skipped: true, reason: "Author lacks the required repository permission." };
  }

  if (commentBody !== "/advance") {
    return { skipped: true, reason: "Comment body was not an exact /advance trigger." };
  }

  const result = processAdvanceRequest(issueBody, issueNumber);
  if (result.noSelection) {
    await createIssueComment(repo, issueNumber, token, "⚠️ Nenhum item com [x] AVANÇAR foi encontrado. Nenhuma alteração realizada.");
    return { skipped: true, reason: "No item was selected to advance." };
  }

  // If items were selected but none are processable (no recognized stage), report and skip.
  if ((result.processable ?? []).length === 0) {
    if ((result.terminal ?? []).length > 0 && (result.unprocessable ?? []).length === 0) {
      await createIssueComment(repo, issueNumber, token, "ℹ️ PUBLICATION GATE é terminal; nenhum novo card foi criado.");
      return { skipped: true, reason: "Publication Gate is terminal." };
    }
    const titles = (result.unprocessable ?? []).map((c) => c.title).filter(Boolean);
    const msg = titles.length > 0
      ? `⚠️ Nenhum item selecionado pôde ser avançado porque a etapa atual não foi reconhecida: ${titles.join(", ")}.`
      : `⚠️ Nenhum item selecionado pôde ser avançado porque a etapa atual não foi reconhecida.`;
    await createIssueComment(repo, issueNumber, token, msg);
    return { skipped: true, reason: "Selected items have no recognized stage." };
  }

  if (!projectToken) {
    await createIssueComment(repo, issueNumber, token, "⚠️ O avanço não foi executado porque ASP_PROJECT_TOKEN não está configurado.");
    return { skipped: true, reason: "Project token was not configured." };
  }

  const createdIssues = [];
  for (const [stage, cards] of result.nextStages) {
    const title = `${stage} — ${new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })}`;
    const body = buildAdvancedIssueBody(cards, issueNumber, stage);
    const created = await createDestinationIssue(repo, token, title, body);
    await setProjectStageForIssue(created.node_id, stage, projectToken);
    createdIssues.push({ stage, issueNumber: created.number, url: created.html_url });
  }

  // Mark only actually processed (processable) items in the origin issue
  const updatedIssueBody = markItemsProcessedInIssue(issueBody, result.processable, createdIssues);
  await updateOriginalIssueBody(repo, issueNumber, token, updatedIssueBody);

  const summary = createdIssues.length > 0
    ? createdIssues.map(({ stage, issueNumber: createdIssueNumber }) => `#${createdIssueNumber} — ${stage}`).join(", ")
    : "nenhuma issue";

  let summaryMessage = `✅ ${result.movedCount} itens avançados para ${summary}.`;
  if ((result.unprocessable ?? []).length > 0) {
    const titles = result.unprocessable.map((c) => c.title).filter(Boolean);
    summaryMessage += `\n⚠️ ${result.unprocessable.length} item(ns) não foi(ram) processado(s) por não possuir etapa reconhecida: ${titles.join(", ")}.`;
  }
  if ((result.terminal ?? []).length > 0) {
    summaryMessage += `\nℹ️ ${result.terminal.length} item(ns) em PUBLICATION GATE não foi(ram) avançado(s), pois essa é a etapa terminal.`;
  }

  await createIssueComment(repo, issueNumber, token, summaryMessage);

  return {
    ...result,
    createdIssues,
    summaryMessage
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runAdvanceWorkflowFromEnv().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
