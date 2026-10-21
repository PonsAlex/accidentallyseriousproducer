import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  COPY_STATUSES,
  COUPON_PUBLISHABLE,
  COUPON_SCOPES,
  EVIDENCE_PACKAGE_VERSION,
  EVIDENCE_ROLES,
  FORBIDDEN_EDITORIAL_KEYS,
  FREE_QUALIFICATIONS,
  KNOWN_FACT_NAMES,
  LIMITED_BY,
  OFFER_NATURES,
  REDACTION_MARKERS,
  REQUIRED_COPY_FIELDS
} from "./evidence-package-validation.mjs";

/**
 * Render the producer contract from the validator's own declarations.
 *
 * A hand-written specification drifts: the validator gains a rule, the document
 * keeps describing the old ones, and the producer follows the document. So the
 * enums, the copy fields and the rule list are read from the code, and a test
 * fails when the committed contract no longer matches.
 *
 * The prose that remains authored is the small set of invariants that no enum
 * can express — temporal coherence, the copy contract, human authority.
 */

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const validationModule = path.join(rootDirectory, "scripts", "evidence-package-validation.mjs");
export const CONTRACT_PATH = path.join(rootDirectory, "docs", "evidence-package-contract.md");

/**
 * Rule codes are the only ALL_CAPS string literals in the validator, so the set
 * can be read without depending on how each call is formatted. Severity comes
 * from the `add("errors" | "warnings", ...)` call that precedes the code.
 */
export function extractValidatorCodes(source) {
  const codes = new Map();

  for (const match of source.matchAll(/"([A-Z][A-Z0-9_]{2,})"/g)) {
    const code = match[1];
    const before = source.slice(Math.max(0, match.index - 260), match.index);
    const lastError = before.lastIndexOf('"errors"');
    const lastWarning = before.lastIndexOf('"warnings"');

    // The nearest `add(` before the code decides its severity.
    const severity = lastError > lastWarning ? "error" : "warning";
    if (!codes.has(code)) codes.set(code, severity);
  }

  return [...codes.entries()]
    .map(([code, severity]) => ({ code, severity }))
    .sort((left, right) => left.code.localeCompare(right.code));
}

function bullets(values) {
  return values.map((value) => `- \`${value}\``).join("\n");
}

function enumTable(title, rows) {
  const body = rows
    .map(([field, values]) => `| \`${field}\` | ${values.map((v) => `\`${v}\``).join(" · ")} |`)
    .join("\n");
  return `### ${title}\n\n| campo | valores permitidos |\n| --- | --- |\n${body}`;
}

export function renderContract({ codes }) {
  const errors = codes.filter((entry) => entry.severity === "error");
  const warnings = codes.filter((entry) => entry.severity === "warning");

  return `# Evidence package contract

<!-- GERADO POR \`npm run contract:package\`. Não edite à mão. -->

Versão do pacote: \`${EVIDENCE_PACKAGE_VERSION}\`

Este é o formato que o validador do ASP aceita. Ele é gerado a partir do próprio
validador: os valores permitidos e a lista de regras saem do código, e um teste
falha se este arquivo ficar para trás. Se algo aqui divergir do validador, o
validador está certo.

Entregar um pacote que viole qualquer regra da seção 10 **não é um erro de
julgamento**: é um pacote que não entra. O validador é a porteira.

## 1. Envelope do pacote

| campo | exigência |
| --- | --- |
| \`packageVersion\` | \`"${EVIDENCE_PACKAGE_VERSION}"\` |
| \`scanDate\` | data de calendário \`YYYY-MM-DD\`, real |
| \`channelsMonitored\` | lista de strings não vazia, com a fonte pelo nome |
| \`candidatesAccepted\` | inteiro ≥ 0, igual ao número de \`records\` |
| \`candidatesRejected\` | inteiro ≥ 0, igual ao número de itens de \`rejectedSummary\` |
| \`rejectedSummary\` | um motivo por item rejeitado, com a data da expiração |
| \`records\` | lista de registros |

Os números têm de fechar. Um cabeçalho que diz "3 rejeitados" e uma lista com 5
motivos derruba o pacote inteiro.

## 2. Forma de um registro

Obrigatórios em todo registro:

${bullets([
    "recordId",
    "productKind",
    "offerNature",
    "limitedBy",
    "primarySourceFound",
    "developer.name",
    "developer.developerOfficialUrl",
    "acquisitionUrl",
    "product.name",
    "product.category",
    "product.whatItIs",
    "offer",
    "evidence",
    "restrictions",
    "openQuestions",
    "missingFacts",
    "notApplicable",
    "toValidate",
    "pendingHumanDecision"
  ])}

\`recordId\` é a identidade do produto entre pacotes e no catálogo. Use um slug
estável (\`fabricante-produto\`). Reenviar o mesmo \`recordId\` não duplica: mescla.
Reenviar com dados piores **reverte o que está publicado** — antes de entregar um
registro que já existe, rode \`npm run intake:check\`.

## 3. Valores permitidos

${enumTable("Natureza da oferta", [["offerNature", OFFER_NATURES]])}

${enumTable("Limite da oferta", [["limitedBy", LIMITED_BY]])}

${enumTable("Papel da evidência", [["evidence[].role", EVIDENCE_ROLES]])}

${enumTable("Escopo do cupom", [["couponScope", COUPON_SCOPES]])}

${enumTable("Publicabilidade do cupom", [["couponPublishable", COUPON_PUBLISHABLE]])}

${enumTable("Estado do texto", [["copyStatus", COPY_STATUSES]])}

${enumTable("Qualificação de gratuidade", [["freeQualification", FREE_QUALIFICATIONS]])}

\`productCategory\` tem de ser coerente com \`productKind\`: um \`bundle\` não é um
\`plugin\`. Essa divergência sozinha derrubou um pacote.

## 4. O contrato do texto

\`copyStatus\` é obrigatório em todo registro. Não é opcional e não tem default.

| \`copyStatus\` | \`readerFacingCopy\` |
| --- | --- |
| \`missing\` | ausente ou \`null\` — a extração produziu fatos e nenhum texto |
| \`draft\` | presente, com ${REQUIRED_COPY_FIELDS.map((f) => `\`${f}\``).join(", ")} |
| \`final\` | presente, com ${REQUIRED_COPY_FIELDS.map((f) => `\`${f}\``).join(", ")} |

Escrever texto e declarar \`missing\` derruba o pacote. Declarar \`final\` sem os
três campos também.

## 5. Coerência temporal

- \`offerNature: "permanent-free"\` → \`endsAt\` e \`endsAtDate\` nulos. Um grátis
  permanente não tem prazo final.
- \`offerNature: "limited-free"\` → \`limitedBy\` diferente de \`none\`.
- \`limitedBy: "none"\` → nenhum prazo.
- \`limitedBy: "time"\` → \`endsAt\` ou \`endsAtDate\` preenchido, **ou** declarado em
  \`missingFacts\`.
- \`limitedBy: "quantity"\` → sem prazo final; a escassez é de licenças.
- \`dateOnly: true\` só faz sentido quando existe um prazo.

## 6. Cupons

- \`couponCode\` presente → \`couponScope\` e \`couponPublishable\` obrigatórios.
- \`couponScope: "creator-affiliated"\` → \`couponOwner\` obrigatório.
- \`couponPublishable: true\` significa que o código **pode** ir ao leitor. Sem
  isso, ele não sai do pacote.
- O código nunca aparece em \`readerFacingCopy\`.

## 7. Evidência e fontes

- Pelo menos uma entrada em \`evidence\`.
- \`url\` completa em \`https://\`, sem marcador de redação, sem credencial.
- \`primarySourceFound\` tem de concordar com a evidência: dizendo \`true\` sem
  nenhuma fonte \`primary\`, o pacote não passa.

### Marcadores proibidos

Qualquer um destes derruba o registro:

${bullets(REDACTION_MARKERS.map((pattern) => pattern.source))}

Se a ferramenta de coleta perdeu uma URL, **remova a entrada de evidência inteira**.
Não existe meio-termo: uma entrada sem URL derruba o pacote com \`MISSING_URL\`, e um
marcador no lugar da URL derruba com \`REDACTED_URL\`. Um fato que ninguém consegue
conferir não é evidência — é o registro de que algo se perdeu.

Se ao remover as entradas o registro ficar sem nenhuma fonte, ele não sai neste
pacote. Perder um candidato custa uma linha; publicar uma fonte que não existe custa
a credibilidade do site.

## 8. Fatos ausentes vs. não aplicáveis

\`missingFacts\` e \`notApplicable\` só aceitam nomes desta lista. Um rótulo livre
como \`"expiryDate"\` não é lido por ninguém — é o mesmo que não declarar nada:

${bullets(KNOWN_FACT_NAMES)}

O mesmo fato não pode estar nas duas listas.

## 9. Autoridade editorial é do humano

O pacote **não** carrega veredito, status de publicação nem seleção. Nenhuma
destas chaves pode aparecer em lugar nenhum:

${bullets(FORBIDDEN_EDITORIAL_KEYS)}

\`pendingHumanDecision\` é obrigatório e vale \`true\`. O pacote descreve o que
encontrou; decidir o que publicar não é papel dele.

## 10. Toda regra que o validador emite

${codes.length} códigos: ${errors.length} erros (bloqueiam) e ${warnings.length} avisos (não bloqueiam).

| código | severidade |
| --- | --- |
${codes.map((entry) => `| \`${entry.code}\` | ${entry.severity === "error" ? "erro" : "aviso"} |`).join("\n")}

## 11. Antes de entregar

- [ ] \`copyStatus\` em **todo** registro
- [ ] nenhum marcador de redação em lugar nenhum
- [ ] \`candidatesRejected\` igual ao número de motivos em \`rejectedSummary\`
- [ ] \`candidatesAccepted\` igual ao número de \`records\`
- [ ] toda oferta \`permanent-free\` sem prazo final
- [ ] \`dateOnly\` só onde existe prazo
- [ ] \`productCategory\` coerente com \`productKind\`
- [ ] toda URL abre — testada, não suposta
- [ ] \`npm run validate:input -- --input <pacote>\` sem erros
- [ ] \`npm run intake:check -- --input <pacote> --verify\` revisado
`;
}

export async function buildContract() {
  const source = await readFile(validationModule, "utf8");
  const codes = extractValidatorCodes(source);
  return { markdown: renderContract({ codes }), codes };
}

export async function writeContract() {
  const { markdown, codes } = await buildContract();
  await mkdir(path.dirname(CONTRACT_PATH), { recursive: true });
  await writeFile(CONTRACT_PATH, markdown, "utf8");
  return { path: CONTRACT_PATH, codes: codes.length };
}

/**
 * Compare content, not the working tree's line endings. Git checks these files
 * out as CRLF on Windows, which would otherwise report a stale contract on every
 * clone that never touched the file.
 */
export function normalizeNewlines(value) {
  return String(value ?? "").replace(/\r\n/g, "\n");
}

const USAGE = `ASP evidence package contract

Usage:
  node scripts/package-contract.mjs [--output <path>] [--check]

Options:
  --output <path>   Write the contract there (default: docs/evidence-package-contract.md)
  --check           Fail if the file on disk differs from what would be generated
  --help            Show this message

The contract is generated from the validator: allowed values and the rule list
come from its source. --check is what keeps them from drifting.`;

export function parseArgs(argv) {
  const options = { output: CONTRACT_PATH, check: false, help: false };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    switch (argument) {
      case "--output":
        index += 1;
        if (index >= argv.length) throw new Error("--output requires a path.");
        options.output = path.resolve(argv[index]);
        break;
      case "--check":
        options.check = true;
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
    console.error(`ERROR CONTRACT: ${error.message}`);
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }

  if (options.help) {
    console.log(USAGE);
    return;
  }

  const { markdown, codes } = await buildContract();

  if (options.check) {
    let current = null;
    try {
      current = await readFile(options.output, "utf8");
    } catch {
      current = null;
    }

    if (normalizeNewlines(current) !== normalizeNewlines(markdown)) {
      console.error(
        `Contrato desatualizado em ${path.relative(rootDirectory, options.output)}. Rode: npm run contract:package`
      );
      process.exitCode = 1;
      return;
    }

    console.log(`Contrato em dia: ${codes.length} regras.`);
    return;
  }

  await mkdir(path.dirname(options.output), { recursive: true });
  await writeFile(options.output, markdown, "utf8");
  console.log(
    `Contrato escrito em ${path.relative(rootDirectory, options.output)} com ${codes.length} regras.`
  );
}

const invokedDirectly =
  typeof process.argv[1] === "string" &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main().catch((error) => {
    console.error(`ERROR CONTRACT: ${error.stack ?? error.message}`);
    process.exitCode = 1;
  });
}
