import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  formatValidationReport,
  readAffiliateData,
  validateAffiliateData
} from "./affiliate-validation.mjs";
import { assertPublicCandidateBoundary } from "./public-boundary.mjs";

export async function validateAffiliateDataAtRoot(rootDirectory) {
  await assertPublicCandidateBoundary(rootDirectory);
  const data = await readAffiliateData(rootDirectory);
  const report = validateAffiliateData(data);
  return { data, report };
}

async function main() {
  const rootDirectory = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    ".."
  );
  const { report } = await validateAffiliateDataAtRoot(rootDirectory);
  console.log(formatValidationReport(report));

  if (report.errors.length > 0) {
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1]
  ? path.resolve(process.argv[1])
  : null;

if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`ERROR DATA_VALIDATION: ${error.message}`);
    process.exitCode = 1;
  });
}
