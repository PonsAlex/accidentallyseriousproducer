import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { aggregateGaps, renderPackageReport } from "../scripts/package-report.mjs";
import { validateEvidencePackage } from "../scripts/evidence-package-validation.mjs";

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = path.join(rootDirectory, "docs", "examples", "evidence-package.example.json");
const fixture = JSON.parse(await readFile(FIXTURE, "utf8"));

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function report(pkg, options) {
  return renderPackageReport(pkg, validateEvidencePackage(pkg), options);
}

test("a valid package is announced as valid, but its gaps are still listed", () => {
  const markdown = report(fixture, { inputPath: "pacote.json" });
  assert.match(markdown, /PACOTE VÁLIDO/);
  assert.match(markdown, /Pode seguir para `jev:adapt`/);
  assert.equal(markdown.includes("PACOTE INVÁLIDO"), false);

  // Valid is not the same as complete: the fixture is schema-valid and still has
  // editorial gaps, which the report must show.
  assert.match(markdown, /## Pendências agregadas/);
  assert.match(markdown, /Cupom não liberado para publicação \| unitedplugins-firemaximizer/);
  assert.match(markdown, /Sem fonte primária \| sonic-labs-audio-the-josie-td3/);
});

test("an invalid package leads with the verdict and lists every error", () => {
  const broken = clone(fixture);
  broken.records[0].evidence[0].url = null;
  broken.records[1].evidence[0].url = null;

  const validation = validateEvidencePackage(broken);
  const markdown = renderPackageReport(broken, validation, { inputPath: "quebrado.json" });

  assert.match(markdown, /PACOTE INVÁLIDO/);
  assert.match(markdown, /Não será adaptado para o Console/);
  assert.match(markdown, /`MISSING_URL`/);
  const missingUrlCount = validation.errors.filter((issue) => issue.code === "MISSING_URL").length;
  assert.equal(missingUrlCount, 2);
  assert.equal(markdown.includes("q u e b r a d o"), false);
});

test("the record table exposes the fields a prose summary hides", () => {
  const withCoupon = clone(fixture);
  const record = withCoupon.records[0];
  record.offer.couponCode = "CODECODE";
  record.offer.couponScope = "creator-affiliated";
  record.offer.couponOwner = "Someone";
  record.offer.couponPublishable = false;
  record.developer.name = "A Store, Not A Developer";

  const markdown = report(withCoupon, { inputPath: "p.json" });

  // The coupon and its publication state.
  assert.match(markdown, /CODECODE \(não publ\.\)/);
  assert.match(markdown, /publicável: false/);
  // The developer is visible, so a store standing in for a manufacturer shows up.
  assert.match(markdown, /A Store, Not A Developer/);
});

test("an evidence entry without a URL is called out per record", () => {
  const broken = clone(fixture);
  broken.records[0].evidence[0].url = null;
  const markdown = report(broken, { inputPath: "p.json" });
  assert.match(markdown, /\*\*URL AUSENTE\*\*/);
});

test("the rejected summary is reconciled explicitly", () => {
  const mismatched = clone(fixture);
  mismatched.candidatesRejected = 9; // the fixture lists 3 reasons
  const markdown = report(mismatched, { inputPath: "p.json" });
  assert.match(markdown, /\*\*Não fecham\*\*/);
  assert.match(markdown, /a lista não explica o total/);

  const reconciled = report(fixture, { inputPath: "p.json" });
  assert.match(reconciled, /Fecham\./);
});

test("gaps are aggregated across records instead of repeated", () => {
  const gaps = aggregateGaps([
    { recordId: "a", evidence: [{ url: null }], developer: {}, acquisitionUrl: null, copyStatus: "missing", primarySourceFound: false, offer: {} },
    { recordId: "b", evidence: [], developer: {}, acquisitionUrl: null, copyStatus: "missing", primarySourceFound: false, offer: {} }
  ]);

  const byLabel = new Map(gaps.map((gap) => [gap.label, gap.recordIds]));
  assert.deepEqual(byLabel.get("Sem URL de evidência (nada citável)"), ["a"]);
  assert.deepEqual(byLabel.get("Sem nenhuma entrada de evidência"), ["b"]);
  assert.deepEqual(byLabel.get("Sem URL de aquisição"), ["a", "b"]);
  assert.deepEqual(byLabel.get("Copy de leitura ainda não escrita"), ["a", "b"]);
  assert.deepEqual(byLabel.get("Sem fonte primária"), ["a", "b"]);
});

test("aggregateGaps flags a coupon that is not cleared for publication", () => {
  const gaps = aggregateGaps([
    { recordId: "x", evidence: [{ url: "https://a.example/x" }], developer: { developerOfficialUrl: "https://a.example" }, acquisitionUrl: "https://a.example/x", copyStatus: "draft", primarySourceFound: true, limitedBy: "none", offer: { couponCode: "C", couponPublishable: false } }
  ]);
  assert.deepEqual(gaps.map((gap) => gap.label), ["Cupom não liberado para publicação"]);
});

test("the report CLI writes the file and exits non-zero on an invalid package", async () => {
  const ok = spawnSync(
    process.execPath,
    ["scripts/package-report.mjs", "--input", "docs/examples/evidence-package.example.json", "--output", path.join(await mkdtemp(path.join(os.tmpdir(), "asp-rep-")), "r.md")],
    { cwd: rootDirectory, encoding: "utf8" }
  );
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /0 erro\(s\) crítico\(s\)/);

  const directory = await mkdtemp(path.join(os.tmpdir(), "asp-rep-"));
  const brokenPath = path.join(directory, "broken.json");
  const broken = clone(fixture);
  broken.records[0].evidence[0].url = null;
  await writeFile(brokenPath, JSON.stringify(broken), "utf8");
  const outPath = path.join(directory, "report.md");

  const bad = spawnSync(
    process.execPath,
    ["scripts/package-report.mjs", "--input", brokenPath, "--output", outPath],
    { cwd: rootDirectory, encoding: "utf8" }
  );
  assert.equal(bad.status, 1);
  const written = await readFile(outPath, "utf8");
  assert.match(written, /PACOTE INVÁLIDO/);
});
