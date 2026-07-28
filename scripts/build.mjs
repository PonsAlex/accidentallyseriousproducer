import {
  copyFile,
  cp,
  mkdir,
  rm
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  formatValidationReport,
  readAffiliateData,
  validateAffiliateData
} from "./affiliate-validation.mjs";
import { assertPublicCandidateBoundary } from "./public-boundary.mjs";

const rootDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const outputDirectory = path.join(rootDirectory, "dist");

const productionFiles = [
  "404.html",
  "_headers",
  "_redirects",
  "about.html",
  "affiliate-disclosure.html",
  "index.html",
  "lab.html",
  "privacy.html",
  "styles.css"
];

const productionDirectories = [
  "affiliate-redirect",
  "articles",
  "assets",
  "deals"
];

const publicDataFiles = [
  "affiliate-programs.json",
  "affiliate-links.json",
  "products.json",
  "promotions.json"
];

async function main() {
  await assertPublicCandidateBoundary(rootDirectory);
  const data = await readAffiliateData(rootDirectory);
  const report = validateAffiliateData(data);
  console.log(formatValidationReport(report));

  if (report.errors.length > 0) {
    throw new Error(
      "Build interrompido por erros críticos nos dados afiliados."
    );
  }

  if (
    path.dirname(outputDirectory) !== rootDirectory ||
    path.basename(outputDirectory) !== "dist"
  ) {
    throw new Error("Diretório de saída inválido.");
  }

  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true });

  await Promise.all(
    productionFiles.map((filename) =>
      copyFile(
        path.join(rootDirectory, filename),
        path.join(outputDirectory, filename)
      )
    )
  );

  await Promise.all(
    productionDirectories.map((directory) =>
      cp(
        path.join(rootDirectory, directory),
        path.join(outputDirectory, directory),
        { recursive: true }
      )
    )
  );

  const outputDataDirectory = path.join(outputDirectory, "data");
  await mkdir(outputDataDirectory, { recursive: true });
  await Promise.all(
    publicDataFiles.map((filename) =>
      copyFile(
        path.join(rootDirectory, "data", filename),
        path.join(outputDataDirectory, filename)
      )
    )
  );

  console.log(
    `Build de produção concluído em ${path.relative(rootDirectory, outputDirectory)}.`
  );
}

main().catch((error) => {
  console.error(`ERROR BUILD: ${error.message}`);
  process.exitCode = 1;
});
