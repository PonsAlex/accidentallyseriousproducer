import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  formatCandidateReport,
  validatePromotionCandidate
} from "./candidate-validation.mjs";
import { readAffiliateData } from "./affiliate-validation.mjs";
import {
  assertPublicCandidateBoundary,
  classifyCandidateValidationPath
} from "./public-boundary.mjs";

async function main() {
  const rootDirectory = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    ".."
  );
  const requestedPath = process.argv[2];

  if (!requestedPath) {
    throw new Error(
      "Informe o exemplo anonimizado ou um candidato no armazenamento privado do Odysseus."
    );
  }

  const candidatePath = path.resolve(rootDirectory, requestedPath);
  const pathClassification = classifyCandidateValidationPath(
    rootDirectory,
    candidatePath
  );

  if (pathClassification === "forbidden-public-repository") {
    throw new Error(
      "Candidatos reais não podem ser lidos de dentro do repositório público do ASP. Use o armazenamento privado do Odysseus; somente o exemplo anonimizado em data/inbox é permitido."
    );
  }

  await assertPublicCandidateBoundary(rootDirectory);

  const [source, affiliateData] = await Promise.all([
    readFile(candidatePath, "utf8"),
    readAffiliateData(rootDirectory)
  ]);
  const candidate = JSON.parse(source);
  const report = validatePromotionCandidate(candidate, {
    knownProgramIds: affiliateData.affiliatePrograms.map(
      (program) => program.id
    )
  });

  console.log(formatCandidateReport(report));
  if (report.errors.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`ERROR CANDIDATE_VALIDATION: ${error.message}`);
  process.exitCode = 1;
});
