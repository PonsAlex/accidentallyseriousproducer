import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  formatCandidateReport,
  validatePromotionCandidate
} from "./candidate-validation.mjs";
import {
  formatValidationReport,
  readAffiliateData,
  validateAffiliateData
} from "./affiliate-validation.mjs";
import { assertPublicCandidateBoundary } from "./public-boundary.mjs";
import {
  inspectPublicAffiliateLanguage
} from "./public-affiliate-language.mjs";

const rootDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

const ignoredDirectories = new Set([
  ".git",
  "dist",
  "node_modules"
]);

async function collectFiles(directory, extensions, results = []) {
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) {
      continue;
    }

    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(entryPath, extensions, results);
    } else if (extensions.has(path.extname(entry.name))) {
      results.push(entryPath);
    }
  }

  return results;
}

function lintJavaScript(files) {
  const errors = [];

  for (const file of files) {
    const result = spawnSync(process.execPath, ["--check", file], {
      cwd: rootDirectory,
      encoding: "utf8"
    });

    if (result.status !== 0) {
      errors.push(
        `${path.relative(rootDirectory, file)}: ${result.stderr.trim()}`
      );
    }
  }

  return errors;
}

function readAttribute(tag, attribute) {
  const pattern = new RegExp(
    `\\b${attribute}\\s*=\\s*["']([^"']*)["']`,
    "i"
  );
  return pattern.exec(tag)?.[1] ?? null;
}

async function lintHtml(files) {
  const errors = [];

  for (const file of files) {
    const relative = path.relative(rootDirectory, file);
    const html = await readFile(file, "utf8");

    if (!/^<!doctype html>/i.test(html.trimStart())) {
      errors.push(`${relative}: doctype HTML ausente.`);
    }

    if (!/<html\b[^>]*\blang=["'][^"']+["']/i.test(html)) {
      errors.push(`${relative}: atributo lang ausente.`);
    }

    if (!/<title>[^<]+<\/title>/i.test(html)) {
      errors.push(`${relative}: title ausente ou vazio.`);
    }

    const ids = [
      ...html.matchAll(/\bid=["']([^"']+)["']/gi)
    ].map((match) => match[1]);
    const duplicateIds = ids.filter(
      (id, index) => ids.indexOf(id) !== index
    );
    for (const id of new Set(duplicateIds)) {
      errors.push(`${relative}: id duplicado "${id}".`);
    }

    for (const match of html.matchAll(/<a\b[^>]*>/gi)) {
      const tag = match[0];
      const href = readAttribute(tag, "href");
      const target = readAttribute(tag, "target");
      const rel = readAttribute(tag, "rel") ?? "";

      if (href === "") {
        errors.push(`${relative}: link com href vazio.`);
      }

      if (href && /^(?:javascript|data):/i.test(href.trim())) {
        errors.push(`${relative}: esquema inseguro em ${href}.`);
      }

      if (
        target === "_blank" &&
        (!rel.split(/\s+/).includes("noopener") ||
          !rel.split(/\s+/).includes("noreferrer"))
      ) {
        errors.push(
          `${relative}: target="_blank" sem noopener e noreferrer.`
        );
      }
    }
  }

  return errors;
}

async function main() {
  await assertPublicCandidateBoundary(rootDirectory);

  const [
    moduleFiles,
    htmlFiles,
    affiliateData,
    candidateSource,
    publicLanguageIssues
  ] =
    await Promise.all([
      collectFiles(rootDirectory, new Set([".mjs"])),
      collectFiles(rootDirectory, new Set([".html"])),
      readAffiliateData(rootDirectory),
      readFile(
        path.join(
          rootDirectory,
          "data",
          "inbox",
          "promotion-candidate.example.json"
        ),
        "utf8"
      ),
      inspectPublicAffiliateLanguage(rootDirectory)
    ]);

  const errors = [
    ...lintJavaScript(moduleFiles),
    ...(await lintHtml(htmlFiles))
  ];

  const affiliateReport = validateAffiliateData(affiliateData);
  const candidateReport = validatePromotionCandidate(
    JSON.parse(candidateSource),
    {
      knownProgramIds: affiliateData.affiliatePrograms.map(
        (program) => program.id
      )
    }
  );

  errors.push(
    ...publicLanguageIssues.map(
      (issue) =>
        `${issue.file}:${issue.line}: texto público em português encontrado (${issue.term}): ${issue.text}`
    ),
    ...affiliateReport.errors.map(
      (issue) =>
        `${issue.code} ${issue.location}: ${issue.message}`
    ),
    ...candidateReport.errors.map(
      (issue) =>
        `${issue.code} ${issue.location}: ${issue.message}`
    )
  );

  if (affiliateReport.warnings.length > 0) {
    console.log(formatValidationReport({
      errors: [],
      warnings: affiliateReport.warnings
    }));
  }

  if (candidateReport.warnings.length > 0) {
    console.log(formatCandidateReport({
      errors: [],
      warnings: candidateReport.warnings
    }));
  }

  if (errors.length > 0) {
    for (const message of errors) {
      console.error(`ERROR ${message}`);
    }
    console.error(`Lint falhou com ${errors.length} erro(s).`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `Lint concluído: ${moduleFiles.length} módulo(s), ${htmlFiles.length} página(s), copy pública afiliada em inglês, dados afiliados e candidato de exemplo válidos.`
  );
}

main().catch((error) => {
  console.error(`ERROR LINT: ${error.stack ?? error.message}`);
  process.exitCode = 1;
});
