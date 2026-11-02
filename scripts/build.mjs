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
import { applyExpiry } from "./expire-offers.mjs";
import { buildDiscovery } from "./discovery.mjs";

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
  "classic-house-template.html",
  "console.html",
  "fire-or-nah.html",
  "favicon.svg",
  "index.html",
  "privacy.html",
  "styles.css"
];

const productionDirectories = [
  "affiliate-redirect",
  "articles",
  "assets",
  "deals",
  "downloads"
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

  // Derived here, not remembered from the day the page was generated: an offer
  // whose end date has passed loses its Status and its button in the built page.
  const expiry = await applyExpiry({
    directory: outputDirectory,
    ledgerPath: path.join(rootDirectory, "data", "reviews.json")
  });
  if (expiry.patched.length > 0) {
    console.log(
      `Expiração: ${expiry.patched.length} oferta(s) marcada(s) como Expired — ${expiry.patched.join(", ")}.`
    );
  }
  if (expiry.pending.length > 0) {
    console.warn(
      `WARN ${expiry.pending.length} oferta(s) vencida(s) sem página publicada: ${expiry.pending.join(", ")}.`
    );
  }

  // The archive index, feed, sitemap and robots are derived from the pages just
  // copied, so a published post cannot be missing from them.
  const discovery = await buildDiscovery({ outputDirectory });
  console.log(
    `Descoberta: ${discovery.articles} artigo(s) no arquivo, feed e sitemap gerados.`
  );
  if (discovery.home?.promoted === false) {
    console.warn(
      `WARN A home não aponta para o post mais recente (${discovery.home.newest}). ` +
        `O arquivo, o feed e o sitemap atualizam sozinhos; o index.html não.`
    );
  }

  console.log(
    `Build de produção concluído em ${path.relative(rootDirectory, outputDirectory)}.`
  );
}

main().catch((error) => {
  console.error(`ERROR BUILD: ${error.message}`);
  process.exitCode = 1;
});
