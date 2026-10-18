import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  formatEvidencePackageReport,
  validateEvidencePackage
} from "./evidence-package-validation.mjs";

/**
 * Render a human-readable report from a validated evidence package.
 *
 * The report is derived, never narrated: every number comes from the package and
 * every problem comes from `validateEvidencePackage`. It therefore cannot say the
 * package is fine when the package is not, which is the failure mode of letting a
 * model write prose about the data.
 */

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const PACKAGE_REPORT_NAME = "asp-package-report.md";

const USAGE = `ASP evidence package -> human report

Usage:
  node scripts/package-report.mjs --input <path> [options]

Options:
  --input <path>   Evidence package JSON (required)
  --output <path>  Markdown report (default: ${PACKAGE_REPORT_NAME})
  --help           Show this message

The report is generated from the package and its validation result. It writes no
repository data and exits non-zero when the package has errors.
`;

export function parseArgs(argv) {
  const options = { input: null, output: PACKAGE_REPORT_NAME, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`Option ${argument} requires a value.`);
      return argv[index];
    };
    switch (argument) {
      case "--input":
        options.input = next();
        break;
      case "--output":
        options.output = next();
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      default:
        throw new Error(`Unknown option: ${argument}`);
    }
  }
  return options;
}

function cell(value) {
  if (value === null || value === undefined || value === "") return "—";
  return String(value).replace(/\|/g, "\\|");
}

function code(value) {
  if (value === null || value === undefined || value === "") return "—";
  return `\`${String(value).replace(/\|/g, "\\|")}\``;
}

function list(values) {
  return Array.isArray(values) && values.length > 0 ? values.join(", ") : "—";
}

function money(value, currency) {
  if (typeof value !== "number") return "—";
  return currency ? `${value} ${currency}` : String(value);
}

/**
 * Aggregate the same gap across records, so the editor sees one line per kind of
 * work instead of the same missing field three times.
 */
export function aggregateGaps(records) {
  const gaps = new Map();
  const add = (label, recordId) => {
    if (!gaps.has(label)) gaps.set(label, []);
    gaps.get(label).push(recordId);
  };

  for (const record of records) {
    const evidence = Array.isArray(record.evidence) ? record.evidence : [];
    // Mutually exclusive: an empty list is not also "a list without URL".
    if (evidence.length === 0) {
      add("Sem nenhuma entrada de evidência", record.recordId);
    } else if (!evidence.some((entry) => typeof entry?.url === "string" && entry.url !== "")) {
      add("Sem URL de evidência (nada citável)", record.recordId);
    }
    if (!record.developer?.developerOfficialUrl) add("Sem URL oficial do fabricante", record.recordId);
    if (!record.acquisitionUrl) add("Sem URL de aquisição", record.recordId);
    if (record.limitedBy === "time" && !record.offer?.endsAt && !record.offer?.endsAtDate) {
      add("limitedBy \"time\" sem prazo declarado", record.recordId);
    }
    if (record.offer?.couponCode && record.offer?.couponPublishable !== true) {
      add("Cupom não liberado para publicação", record.recordId);
    }
    if (record.copyStatus === "missing") add("Copy de leitura ainda não escrita", record.recordId);
    if (record.primarySourceFound === false) add("Sem fonte primária", record.recordId);
  }

  return [...gaps.entries()].map(([label, recordIds]) => ({ label, recordIds }));
}

export function renderPackageReport(pkg, validation, { inputPath = null } = {}) {
  const records = Array.isArray(pkg?.records) ? pkg.records : [];
  const errors = validation?.errors ?? [];
  const warnings = validation?.warnings ?? [];
  const valid = errors.length === 0;

  const lines = [];
  lines.push("# Relatório do pacote de evidências");
  lines.push("");

  if (valid) {
    lines.push(
      `**PACOTE VÁLIDO — 0 erros, ${warnings.length} aviso(s).** Pode seguir para \`jev:adapt\`.`
    );
  } else {
    lines.push(
      `**PACOTE INVÁLIDO — ${errors.length} erro(s), ${warnings.length} aviso(s). Não será adaptado para o Console e nenhum bloco será criado.**`
    );
  }
  lines.push("");

  lines.push("| | |");
  lines.push("| --- | --- |");
  lines.push(`| Arquivo | ${cell(inputPath)} |`);
  lines.push(`| packageVersion | ${cell(pkg?.packageVersion)} |`);
  lines.push(`| Scan date | ${cell(pkg?.scanDate)} |`);
  const channels = Array.isArray(pkg?.channelsMonitored) ? pkg.channelsMonitored : [];
  lines.push(`| Canais monitorados | ${channels.length}${channels.length > 0 ? ` (${channels.map(cell).join(", ")})` : ""} |`);
  lines.push(`| Aceitos / Rejeitados | ${cell(pkg?.candidatesAccepted)} / ${cell(pkg?.candidatesRejected)} |`);
  lines.push("");

  if (errors.length > 0) {
    lines.push(`## Erros (${errors.length})`);
    lines.push("");
    lines.push("| código | local | mensagem |");
    lines.push("| --- | --- | --- |");
    for (const issue of errors) {
      lines.push(`| ${code(issue.code)} | ${code(issue.location)} | ${cell(issue.message)} |`);
    }
    lines.push("");
  }

  if (warnings.length > 0) {
    lines.push(`## Avisos (${warnings.length})`);
    lines.push("");
    lines.push("| código | local | mensagem |");
    lines.push("| --- | --- | --- |");
    for (const issue of warnings) {
      lines.push(`| ${code(issue.code)} | ${code(issue.location)} | ${cell(issue.message)} |`);
    }
    lines.push("");
  }

  const rejected = Array.isArray(pkg?.rejectedSummary) ? pkg.rejectedSummary : [];
  if (typeof pkg?.candidatesRejected === "number") {
    const reconciles = pkg.candidatesRejected === rejected.length;
    lines.push("## Reconciliação de rejeitados");
    lines.push("");
    lines.push(
      `\`candidatesRejected\` = ${pkg.candidatesRejected} · \`rejectedSummary\` lista ${rejected.length} motivo(s). ${
        reconciles ? "Fecham." : "**Não fecham** — a lista não explica o total."
      }`
    );
    lines.push("");
    if (rejected.length > 0) {
      for (const reason of rejected) lines.push(`- ${reason}`);
      lines.push("");
    }
  }

  lines.push(`## Registros (${records.length})`);
  lines.push("");
  lines.push("| recordId | produto | fabricante | natureza | limite | promo | regular | cupom | qualificação | fonte 1ª | copy | evid. |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const record of records) {
    const offer = record.offer ?? {};
    const coupon = offer.couponCode
      ? `${offer.couponCode}${offer.couponPublishable === true ? "" : " (não publ.)"}`
      : "—";
    const evidence = Array.isArray(record.evidence) ? record.evidence.length : 0;
    lines.push(
      `| ${code(record.recordId)} | ${cell(record.product?.name)} | ${cell(record.developer?.name)} | ${cell(
        record.offerNature
      )} | ${cell(record.limitedBy)} | ${cell(money(offer.promoPrice, offer.currency))} | ${cell(
        money(offer.regularPrice, offer.currency)
      )} | ${cell(coupon)} | ${cell(record.freeQualification)} | ${
        record.primarySourceFound === true ? "sim" : "não"
      } | ${cell(record.copyStatus)} | ${evidence} |`
    );
  }
  lines.push("");

  const gaps = aggregateGaps(records);
  lines.push("## Pendências agregadas");
  lines.push("");
  if (gaps.length === 0) {
    lines.push("Nenhuma pendência detectada nos campos estruturados.");
  } else {
    lines.push("| pendência | registros |");
    lines.push("| --- | --- |");
    for (const gap of gaps) lines.push(`| ${cell(gap.label)} | ${cell(gap.recordIds.join(", "))} |`);
  }
  lines.push("");

  lines.push("## Detalhe por registro");
  lines.push("");
  for (const record of records) {
    const offer = record.offer ?? {};
    lines.push(`### ${code(record.recordId)}`);
    lines.push("");
    lines.push(`- Produto: ${cell(record.product?.name)} (${cell(record.product?.category ?? record.productKind)}) — ${cell(record.developer?.name)}`);
    lines.push(`- O que é: ${cell(record.product?.whatItIs)}`);
    lines.push(`- Natureza: ${cell(record.offerNature)} · limite: ${cell(record.limitedBy)}`);
    lines.push(
      `- Preço: ${cell(money(offer.promoPrice, offer.currency))} · regular: ${cell(
        money(offer.regularPrice, offer.currency)
      )}${offer.regularPriceSource ? ` (fonte: ${cell(offer.regularPriceSource)})` : ""}`
    );
    lines.push(
      `- Prazo: ${cell(offer.endsAt ?? offer.endsAtDate)}${
        offer.endsAtDate && !offer.endsAt ? ` (só data, dateOnly: ${offer.dateOnly === true})` : ""
      }`
    );
    if (offer.couponCode) {
      lines.push(
        `- Cupom: \`${offer.couponCode}\` · escopo: ${cell(offer.couponScope)} · dono: ${cell(
          offer.couponOwner
        )} · **publicável: ${cell(offer.couponPublishable)}**`
      );
    }
    lines.push(`- Qualificação de gratuidade: ${cell(record.freeQualification)}`);
    lines.push(`- URL oficial do fabricante: ${cell(record.developer?.developerOfficialUrl)}`);
    lines.push(`- URL de aquisição: ${cell(record.acquisitionUrl)}`);
    lines.push(`- Copy: ${cell(record.copyStatus)}`);
    lines.push(`- missingFacts: ${list(record.missingFacts)}`);
    lines.push(`- notApplicable: ${list(record.notApplicable)}`);
    lines.push(`- openQuestions: ${list(record.openQuestions)}`);
    lines.push(`- toValidate: ${list(record.toValidate)}`);
    lines.push("- Evidências:");
    const evidence = Array.isArray(record.evidence) ? record.evidence : [];
    if (evidence.length === 0) {
      lines.push("  - (nenhuma)");
    } else {
      for (const entry of evidence) {
        const url = typeof entry?.url === "string" && entry.url !== "" ? entry.url : "**URL AUSENTE**";
        lines.push(`  - ${cell(entry?.role)} · ${cell(entry?.name)} · ${url} · ${cell(entry?.date)} — ${cell(entry?.fact)}`);
      }
    }
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push(
    "Relatório gerado a partir do pacote e do seu resultado de validação. Nenhum Verdict, Status ou decisão editorial está incluído."
  );
  lines.push("");

  return lines.join("\n");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(USAGE);
    return;
  }
  if (!options.input) {
    throw new Error("--input is required. Pass the evidence package to report on.");
  }

  const absolute = path.resolve(rootDirectory, options.input);
  const relative = path.relative(rootDirectory, absolute);
  let parsed;
  try {
    parsed = JSON.parse(await readFile(absolute, "utf8"));
  } catch (error) {
    throw new Error(`Could not read and parse ${relative}: ${error.message}`);
  }

  const validation = validateEvidencePackage(parsed);
  const markdown = renderPackageReport(parsed, validation, { inputPath: relative });

  const outputPath = path.resolve(rootDirectory, options.output);
  await writeFile(outputPath, markdown, "utf8");

  console.log(formatEvidencePackageReport(validation));
  console.log(`Relatório escrito em ${path.relative(rootDirectory, outputPath)}.`);
  if (validation.errors.length > 0) {
    process.exitCode = 1;
  }
}

const invokedDirectly =
  typeof process.argv[1] === "string" &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main().catch((error) => {
    console.error(`ERROR PACKAGE REPORT: ${error.stack ?? error.message}`);
    process.exitCode = 1;
  });
}
