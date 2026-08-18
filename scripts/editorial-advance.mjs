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

export const STAGE_ALIASES = {
  RADAR: ["RADAR", "Radar"],
  EVIDÊNCIA: ["EVIDÊNCIA", "EVIDENCIA", "O QUE CONSEGUIMOS PROVAR?", "O que conseguimos provar?"],
  "FREE QUALIFICATION": ["FREE QUALIFICATION", "Free qualification", "FREE QUALIFICATION (WHEN APPLICABLE)", "Free Qualification"],
  "SELEÇÃO EDITORIAL": ["SELEÇÃO EDITORIAL", "SELECAO EDITORIAL", "Seleção editorial", "Selecao editorial"],
  "BRANCH EDITORIAL": ["BRANCH EDITORIAL", "Branch editorial", "Branch Editorial"],
  "PREVIEW / HUMAN REVIEW": ["PREVIEW / HUMAN REVIEW", "Preview / Human review", "PREVIEW / HUMAN REVIEW"],
  "PUBLICATION GATE": ["PUBLICATION GATE", "Publication gate"]
};

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
    "Claim de gratuidade confirmado",
    "Condições de gratuidade verificadas",
    "Qualificação concluída",
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
  for (const line of lines) {
    const normalized = normalizeStageName(line);
    if (normalized) return normalized;
  }
  return "";
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

function isAdvanceControlLine(line = "") {
  return /^\s*[*-]\s*\[[ xX]\]\s*(?:\*\*)?AVANÇAR(?:\*\*)?\s*$/.test(String(line ?? ""));
}

function isChecklistLine(line = "") {
  return /^\s*[*-]\s*\[[ xX]\]\s+/.test(String(line ?? ""));
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
    safeLines.push(line);
  }

  return safeLines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function renderStageChecklist(stageName = "EVIDÊNCIA") {
  const orderedStage = normalizeStageName(stageName) || "EVIDÊNCIA";
  const items = STAGE_CHECKLISTS[orderedStage] ?? STAGE_CHECKLISTS.EVIDÊNCIA;
  const title = STAGE_TITLES[orderedStage] || orderedStage;
  return `**${title}**\n\n${items.map((entry) => `* [ ] ${entry}`).join("\n")}`;
}

export function buildSelectedItemBody(card, nextStage) {
  const contentBeforeStage = stripStageContent(card.body || "").trim();
  const chunks = [];
  if (contentBeforeStage) chunks.push(contentBeforeStage);
  chunks.push(renderStageChecklist(nextStage));
  return chunks.join("\n\n").trim();
}

export function buildAdvancedIssueBody(selectedCards, sourceIssueNumber, nextStage) {
  const items = selectedCards
    .filter((card) => !card.processed)
    .map((card) => {
      const title = card.title || "Item editorial";
      const itemBody = buildSelectedItemBody(card, nextStage);
      return `### ${title}\n\n* [ ] **AVANÇAR**\n\n${itemBody}`;
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
  return {
    cards,
    selected,
    nextStages,
    grouped: Object.fromEntries(nextStages.map(([stage, stageCards]) => [stage, stageCards])),
    noSelection: selected.length === 0,
    movedCount: selected.length,
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

  if (commentBody.trim() !== "/advance") {
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

  const updatedIssueBody = markItemsProcessedInIssue(issueBody, result.selected, createdIssues);
  await updateOriginalIssueBody(repo, issueNumber, token, updatedIssueBody);

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
