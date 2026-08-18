import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const STAGE_ORDER = [
  "RADAR",
  "EVIDÊNCIA",
  "FREE QUALIFICATION",
  "SELEÇÃO EDITORIAL",
  "BRANCH EDITORIAL",
  "PREVIEW / HUMAN REVIEW",
  "PUBLICATION GATE"
];

export const STAGE_TITLES = {
  RADAR: "Radar",
  EVIDÊNCIA: "O que conseguimos provar?",
  "FREE QUALIFICATION": "Free qualification",
  "SELEÇÃO EDITORIAL": "Seleção editorial",
  "BRANCH EDITORIAL": "Branch editorial",
  "PREVIEW / HUMAN REVIEW": "Preview / Human review",
  "PUBLICATION GATE": "Publication gate"
};

export const STAGE_CHECKLISTS = {
  RADAR: [
    "Oferta",
    "Freebie",
    "Novo produto",
    "Atualização",
    "Notícia",
    "Outro",
    "Ignorar"
  ],
  EVIDÊNCIA: [
    "Fonte primária confirmada",
    "Produto confirmado",
    "Preço confirmado",
    "Prazo confirmado",
    "Condições confirmadas",
    "Evidência suficiente",
    "Evidência insuficiente",
    "Revisão necessária"
  ],
  "FREE QUALIFICATION": [
    "Oferta gratuita confirmada",
    "Termos confirmados",
    "Restrição de uso validada",
    "Qualificação de gratuidade concluída",
    "Revisão de elegibilidade necessária"
  ],
  "SELEÇÃO EDITORIAL": [
    "Item elegível",
    "Item relevante",
    "Item com potencial",
    "Item fora do escopo",
    "Revisão editorial necessária"
  ],
  "BRANCH EDITORIAL": [
    "Branch registrada",
    "Conteúdo revisado",
    "Rascunho consistente",
    "Risco de publicação identificado",
    "Aprovação editorial pendente"
  ],
  "PREVIEW / HUMAN REVIEW": [
    "Preview revisada",
    "Aprovação humana registrada",
    "Material relevante revisado",
    "Correções pendentes",
    "Aguardando publicação"
  ],
  "PUBLICATION GATE": [
    "Publicação autorizada",
    "Link final validado",
    "Disclosure revisado",
    "Aprovação final concluída",
    "Publicação pendente"
  ]
};

const ADVANCE_CHECKBOX = /(?:^|\n)\s*[*-]\s*\[(?:x|X)\]\s*(?:\*\*)?AVANÇAR(?:\*\*)?/m;
const AVANCA_CHECKBOX = /(?:^|\n)\s*[*-]\s*\[(?:x|X)\]\s*(?:\*\*)?AVANÇAR(?:\*\*)?/m;
const SELECTOR_LINE = /^\s*[*-]\s*\[(?:x|X)\]\s*(?:\*\*)?AVANÇAR(?:\*\*)?\s*$/m;
const STAGE_LABEL = /^\s*\*\*(.+?)\*\*\s*$/m;
const ISSUE_ITEM_HEADING = /^###\s+(.+)$/gm;
const ALREADY_PROCESSED = /<!--\s*asp-editorial-advance:\s*[^>]+\s*-->/m;

export function normalizeStageName(value = "") {
  const normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) return "";
  if (normalized === "RADAR") return "RADAR";
  if (normalized === "EVIDENCIA") return "EVIDÊNCIA";
  if (normalized.includes("FREE") && normalized.includes("QUAL")) return "FREE QUALIFICATION";
  if (normalized.includes("SELECAO") || normalized.includes("SELEÇÃO") || normalized.includes("SELEC") || normalized.includes("EDITORIAL")) return "SELEÇÃO EDITORIAL";
  if (normalized.includes("BRANCH")) return "BRANCH EDITORIAL";
  if (normalized.includes("PREVIEW") || normalized.includes("HUMAN REVIEW")) return "PREVIEW / HUMAN REVIEW";
  if (normalized.includes("PUBLICATION") || normalized.includes("GATE")) return "PUBLICATION GATE";
  return normalized;
}

export function parseIssueCards(issueBody = "") {
  const cards = [];
  const headings = [...issueBody.matchAll(ISSUE_ITEM_HEADING)];

  for (let index = 0; index < headings.length; index += 1) {
    const match = headings[index];
    const nextMatch = headings[index + 1];
    const title = match[1].trim();
    const start = match.index + match[0].length;
    const end = nextMatch ? nextMatch.index : issueBody.length;
    const rawContent = issueBody.slice(start, end).trim();

    const stageLineMatch = rawContent.match(STAGE_LABEL);
    const stage = stageLineMatch ? normalizeStageName(stageLineMatch[1]) : "";
    const advanceSelected = AVANCA_CHECKBOX.test(rawContent);
    const processed = ALREADY_PROCESSED.test(rawContent);

    cards.push({
      title,
      stage,
      body: rawContent,
      advanceSelected,
      processed
    });
  }

  return cards;
}

export function hasFreeClaim(body = "") {
  const haystack = body.toLowerCase();
  return /(freebie|free|gratuit|gratis|free with purchase|gratuidade|oferta gratuita|produto gratuito|possible free|free offer)/i.test(haystack);
}

export function determineNextStage(currentStage = "", body = "") {
  const stageName = normalizeStageName(currentStage);
  const freeClaim = hasFreeClaim(body);

  if (stageName === "RADAR") return "EVIDÊNCIA";
  if (stageName === "EVIDÊNCIA") return freeClaim ? "FREE QUALIFICATION" : "SELEÇÃO EDITORIAL";
  if (stageName === "FREE QUALIFICATION") return "SELEÇÃO EDITORIAL";
  if (stageName === "SELEÇÃO EDITORIAL") return "BRANCH EDITORIAL";
  if (stageName === "BRANCH EDITORIAL") return "PREVIEW / HUMAN REVIEW";
  if (stageName === "PREVIEW / HUMAN REVIEW") return "PUBLICATION GATE";
  if (stageName === "PUBLICATION GATE") return "PUBLICATION GATE";
  return null;
}

function stripStageContent(body = "") {
  const lines = body.split(/\r?\n/);
  const keep = [];
  let dropStageFromHere = false;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (i === 0 && /^\s*[*-]\s*\[.*\]\s*(?:\*\*)?AVANÇAR(?:\*\*)?\s*$/.test(line)) {
      continue;
    }

    if (STAGE_LABEL.test(line)) {
      dropStageFromHere = true;
      continue;
    }

    if (dropStageFromHere) {
      if (/^\s*$/.test(line)) continue;
      if (/^\s*[*-]\s*\[[ xX]\]/.test(line)) continue;
      if (/^\s*[*-]\s*\*\*/.test(line)) continue;
      if (/^\s*\*\*.+\*\*\s*$/.test(line)) continue;
      if (/^\s*#+\s*/.test(line)) continue;
      keep.push(line);
      continue;
    }

    keep.push(line);
  }

  return keep.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function renderStageChecklist(stageName = "EVIDÊNCIA") {
  const orderedStage = normalizeStageName(stageName);
  const items = STAGE_CHECKLISTS[orderedStage] ?? STAGE_CHECKLISTS.EVIDÊNCIA;
  return `**${STAGE_TITLES[orderedStage] || orderedStage}**\n\n${items.map((entry) => `* [ ] ${entry}`).join("\n")}`;
}

export function buildSelectedItemBody(card, nextStage) {
  const withoutStage = stripStageContent(card.body || "").trim();
  const bodyChunks = [];
  if (withoutStage) bodyChunks.push(withoutStage);
  bodyChunks.push(renderStageChecklist(nextStage));
  return bodyChunks.join("\n\n").trim();
}

export function buildAdvancedIssueBody(selectedCards, sourceIssueNumber, nextStage) {
  const items = selectedCards
    .filter((card) => !card.processed)
    .map((card) => {
      const title = card.title || "Item editorial";
      const itemBody = buildSelectedItemBody(card, nextStage);
      return `### ${title}\n\n* [ ] **AVANÇAR**\n\n${itemBody}\n\n/advance`;
    })
    .join("\n\n---\n\n");

  const referenceLine = `↗ Avançado da issue #${sourceIssueNumber} para ${nextStage}.`;
  return `${referenceLine}\n\n${items}`.trim();
}

export function processAdvanceRequest(issueBody = "", sourceIssueNumber = "") {
  const cards = parseIssueCards(issueBody);
  const selected = cards.filter((card) => card.advanceSelected && !card.processed);

  const byStage = new Map();
  for (const card of selected) {
    const nextStage = determineNextStage(card.stage, card.body);
    if (!nextStage) continue;
    const list = byStage.get(nextStage) ?? [];
    list.push(card);
    byStage.set(nextStage, list);
  }

  const nextStages = [...byStage.entries()];
  const result = {
    cards,
    selected,
    nextStages,
    grouped: Object.fromEntries(nextStages.map(([stage, stageCards]) => [stage, stageCards])),
    noSelection: selected.length === 0,
    movedCount: selected.length,
    createdIssues: []
  };

  return result;
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

async function createIssueComment(repo, issueNumber, token, message) {
  const url = `https://api.github.com/repos/${repo}/issues/${issueNumber}/comments`;
  return ghRequest(url, token, "POST", { body: message });
}

async function createDestinationIssue(repo, token, title, body) {
  const url = `https://api.github.com/repos/${repo}/issues`;
  return ghRequest(url, token, "POST", { title, body });
}

export async function runAdvanceWorkflowFromEnv() {
  if (!process.env.GITHUB_EVENT_PATH || !process.env.GITHUB_REPOSITORY || !process.env.GITHUB_TOKEN) {
    return { skipped: true, reason: "GitHub Actions environment variables were not provided." };
  }

  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  const issueNumber = event.issue?.number;
  const issueBody = event.issue?.body ?? "";
  const commentBody = event.comment?.body ?? "";

  if (!issueNumber || commentBody.trim() !== "/advance") {
    return { skipped: true, reason: "Comment body was not an exact /advance trigger." };
  }

  const result = processAdvanceRequest(issueBody, issueNumber);
  if (result.noSelection) {
    await createIssueComment(repo, issueNumber, token, "⚠️ Nenhum item com [x] AVANÇAR foi encontrado. Nenhuma alteração realizada.");
    return { skipped: true, reason: "No item was selected to advance." };
  }

  const createdIssues = [];
  for (const [stage, cards] of result.nextStages) {
    const title = `${stage} — ${new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })}`;
    const body = buildAdvancedIssueBody(cards, issueNumber, stage);
    const created = await createDestinationIssue(repo, token, title, body);
    createdIssues.push({ stage, issueNumber: created.number, url: created.html_url });
  }

  const summary = createdIssues.length > 0
    ? createdIssues.map(({ stage, issueNumber: createdIssueNumber }) => `#${createdIssueNumber} — ${stage}`).join(", ")
    : "nenhuma issue";

  const summaryMessage = `✅ ${result.movedCount} itens avançados para ${summary}.`;
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
