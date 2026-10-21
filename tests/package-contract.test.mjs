import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  CONTRACT_PATH,
  buildContract,
  extractValidatorCodes,
  normalizeNewlines,
  parseArgs,
  renderContract
} from "../scripts/package-contract.mjs";
import {
  COPY_STATUSES,
  COUPON_SCOPES,
  EVIDENCE_ROLES,
  FORBIDDEN_EDITORIAL_KEYS,
  FREE_QUALIFICATIONS,
  KNOWN_FACT_NAMES,
  LIMITED_BY,
  OFFER_NATURES
} from "../scripts/evidence-package-validation.mjs";

test("severity comes from the add() call that precedes the code", () => {
  const source = `
    add("errors", "FIRST_PROBLEM", location, "x");
    add("warnings", "SOFT_PROBLEM", location, "y");
    add(
      "errors",
      "MULTILINE_PROBLEM",
      location,
      "z"
    );
  `;

  const codes = extractValidatorCodes(source);
  const byCode = Object.fromEntries(codes.map((entry) => [entry.code, entry.severity]));

  assert.equal(byCode.FIRST_PROBLEM, "error");
  assert.equal(byCode.SOFT_PROBLEM, "warning");
  assert.equal(byCode.MULTILINE_PROBLEM, "error");
});

test("the extracted set is lexicographically stable", () => {
  const source = 'add("errors", "B_CODE", l, "x"); add("errors", "A_CODE", l, "x");';
  const codes = extractValidatorCodes(source).map((entry) => entry.code);

  assert.deepEqual(codes, ["A_CODE", "B_CODE"]);
});

test("the real validator yields only rule codes, never constant values", async () => {
  const { codes } = await buildContract();

  assert.ok(codes.length > 50, `expected many rules, got ${codes.length}`);
  for (const entry of codes) {
    assert.match(entry.code, /^[A-Z][A-Z0-9_]+$/, `${entry.code} is not a rule code`);
    assert.ok(
      entry.severity === "error" || entry.severity === "warning",
      `${entry.code} has severity ${entry.severity}`
    );
  }
  assert.ok(codes.some((entry) => entry.severity === "error"));
  assert.ok(codes.some((entry) => entry.severity === "warning"));
});

test("the committed contract matches what the validator would generate", async () => {
  // This is the whole point: the document cannot describe rules that the code
  // does not enforce, or miss rules that it does.
  const committed = await readFile(CONTRACT_PATH, "utf8");
  const { markdown } = await buildContract();

  assert.equal(
    normalizeNewlines(committed),
    normalizeNewlines(markdown),
    "docs/evidence-package-contract.md is stale — run: npm run contract:package"
  );
});

test("every allowed value in the code reaches the contract", async () => {
  const { markdown } = await buildContract();

  for (const value of [
    ...OFFER_NATURES,
    ...LIMITED_BY,
    ...EVIDENCE_ROLES,
    ...COUPON_SCOPES,
    ...COPY_STATUSES,
    ...FREE_QUALIFICATIONS
  ]) {
    assert.ok(markdown.includes(`\`${value}\``), `contract is missing the value ${value}`);
  }

  for (const fact of KNOWN_FACT_NAMES) {
    assert.ok(markdown.includes(`\`${fact}\``), `contract is missing the fact name ${fact}`);
  }

  for (const key of FORBIDDEN_EDITORIAL_KEYS) {
    assert.ok(markdown.includes(`\`${key}\``), `contract is missing the forbidden key ${key}`);
  }
});

test("the contract names every rule the validator can emit", async () => {
  const { markdown, codes } = await buildContract();

  for (const entry of codes) {
    assert.ok(markdown.includes(`\`${entry.code}\``), `contract is missing rule ${entry.code}`);
  }

  const label = codes.length === 1 ? "código" : "códigos";
  assert.ok(markdown.includes(`${codes.length} ${label}`), "the rule total should be stated");
});

test("the contract states the copy contract explicitly", async () => {
  const { markdown } = await buildContract();

  assert.match(markdown, /copyStatus.*obrigatório/i);
  assert.match(markdown, /`missing`.*ausente/i);
  assert.match(markdown, /`draft`/);
  assert.match(markdown, /`final`/);
});

test("a rule added to the validator without regenerating is caught", async () => {
  const { codes } = await buildContract();
  const source = await readFile(
    new URL("../scripts/evidence-package-validation.mjs", import.meta.url),
    "utf8"
  );

  // Simulate the drift: a code that exists in the source but not in the doc.
  const withNewRule = extractValidatorCodes(
    `${source}\nadd("errors", "BRAND_NEW_RULE", location, "x");`
  );

  assert.equal(withNewRule.length, codes.length + 1);
  assert.ok(!codes.some((entry) => entry.code === "BRAND_NEW_RULE"));
});

test("parseArgs defaults to the documented path and supports --check", () => {
  const defaults = parseArgs([]);
  assert.equal(defaults.check, false);
  assert.match(defaults.output, /evidence-package-contract\.md$/);

  assert.equal(parseArgs(["--check"]).check, true);
  assert.throws(() => parseArgs(["--output"]), /requires a path/);
  assert.throws(() => parseArgs(["--bogus"]), /Unrecognized argument/);
  assert.equal(parseArgs(["--help"]).help, true);
});

test("renderContract handles an empty rule set without breaking", () => {
  const markdown = renderContract({ codes: [] });

  assert.match(markdown, /0 códigos/);
  assert.match(markdown, /GERADO POR/);
});
