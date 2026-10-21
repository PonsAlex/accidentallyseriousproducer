import test from "node:test";
import assert from "node:assert/strict";
import {
  INTAKE_STATES,
  INTAKE_VERDICTS,
  checkIntake,
  classifyRecord,
  formatIntakeReport,
  intakeVerdict,
  parseArgs,
  verifyAcquisitionUrls,
  verifyUrl
} from "../scripts/intake-check.mjs";

function record(overrides = {}) {
  return {
    recordId: "acme-widget",
    primarySourceFound: true,
    acquisitionUrl: "https://acme.test/widget",
    product: { name: "Widget", category: "plugin" },
    ...overrides
  };
}

const product = (overrides = {}) => ({
  id: "acme-widget",
  name: "Widget",
  category: "plugin",
  ...overrides
});

const link = (overrides = {}) => ({
  id: "link-acme-widget",
  productId: "acme-widget",
  destinationUrl: "https://acme.test/widget",
  ...overrides
});

test("a clean record that is not published yet is publishable", () => {
  const result = classifyRecord(record(), { products: [], links: [] });

  assert.equal(result.state, INTAKE_STATES.PUBLISHABLE);
  assert.deepEqual(result.reasons, []);
});

test("a record without a confirmed primary source is blocked", () => {
  const result = classifyRecord(record({ primarySourceFound: false }), {});

  assert.equal(result.state, INTAKE_STATES.BLOCKED);
  assert.match(result.reasons.join(" "), /fonte primária/);
});

test("a redacted acquisition URL blocks the record instead of publishing a placeholder", () => {
  const result = classifyRecord(
    record({ acquisitionUrl: "[suspicious link removed]" }),
    {}
  );

  assert.equal(result.state, INTAKE_STATES.BLOCKED);
  assert.match(result.reasons.join(" "), /redigida/);
});

test("a missing or non-https acquisition URL is blocked", () => {
  assert.equal(
    classifyRecord(record({ acquisitionUrl: "" }), {}).state,
    INTAKE_STATES.BLOCKED
  );
  assert.equal(
    classifyRecord(record({ acquisitionUrl: "http://acme.test/widget" }), {}).state,
    INTAKE_STATES.BLOCKED
  );
});

test("blocking wins over being published already", () => {
  const result = classifyRecord(
    record({ primarySourceFound: false }),
    { products: [product()], links: [link()] }
  );

  assert.equal(result.state, INTAKE_STATES.BLOCKED);
});

test("a record that is already published and unchanged is reported as such", () => {
  const result = classifyRecord(record(), { products: [product()], links: [link()] });

  assert.equal(result.state, INTAKE_STATES.ALREADY_LIVE);
  assert.deepEqual(result.changes, []);
});

test("a category that differs from the catalogue is a regression", () => {
  const result = classifyRecord(
    record({ product: { name: "Widget", category: "plugin" } }),
    { products: [product({ category: "bundle" })], links: [link()] }
  );

  assert.equal(result.state, INTAKE_STATES.ALREADY_LIVE);
  const [change] = result.changes;
  assert.equal(change.kind, "regression");
  assert.equal(change.field, "category");
  assert.equal(change.from, "bundle");
  assert.equal(change.to, "plugin");
});

test("a checkout deep-link would regress a readable destination", () => {
  const result = classifyRecord(
    record({ acquisitionUrl: "https://acme.test/checkout/review-and-submit?cart=1" }),
    { products: [product()], links: [link({ destinationUrl: "https://acme.test/widget" })] }
  );

  const [change] = result.changes;
  assert.equal(change.kind, "regression");
  assert.match(change.note, /checkout/);
});

test("a homepage URL would regress a specific destination", () => {
  const result = classifyRecord(
    record({ acquisitionUrl: "https://acme.test/" }),
    {
      products: [product()],
      links: [link({ destinationUrl: "https://acme.test/vst-instruments/widget/" })]
    }
  );

  const [change] = result.changes;
  assert.equal(change.kind, "regression");
  assert.match(change.note, /genérica/);
});

test("a different destination at the same depth is a neutral change, not a regression", () => {
  const result = classifyRecord(
    record({ acquisitionUrl: "https://acme.test/new-widget-page" }),
    {
      products: [product()],
      links: [link({ destinationUrl: "https://acme.test/old-widget-page" })]
    }
  );

  const [change] = result.changes;
  assert.equal(change.kind, "change");
  assert.equal(change.note, null);
});

test("a record without a catalogue link still reports already live", () => {
  const result = classifyRecord(record(), { products: [product()], links: [] });

  assert.equal(result.state, INTAKE_STATES.ALREADY_LIVE);
  assert.deepEqual(result.changes, []);
});

test("the summary counts each record once and totals regressions", () => {
  const pkg = {
    records: [
      record({ recordId: "fresh" }),
      record({ recordId: "acme-widget" }),
      record({ recordId: "broken", primarySourceFound: false })
    ]
  };

  const result = checkIntake(pkg, {
    products: [product({ category: "bundle" })],
    links: [link()]
  });

  assert.equal(result.summary.total, 3);
  assert.equal(result.summary.publishable, 1);
  assert.equal(result.summary.alreadyLive, 1);
  assert.equal(result.summary.blocked, 1);
  // category regression + a destination that is unchanged but for the category
  assert.equal(result.summary.regressions, 1);
  assert.equal(result.verdict, INTAKE_VERDICTS.NEW_MATERIAL);
});

test("the verdict orders new material above regressions above nothing new", () => {
  assert.equal(
    intakeVerdict({ publishable: 1, alreadyLive: 5, blocked: 0, regressions: 3 }),
    INTAKE_VERDICTS.NEW_MATERIAL
  );
  assert.equal(
    intakeVerdict({ publishable: 0, alreadyLive: 5, blocked: 0, regressions: 1 }),
    INTAKE_VERDICTS.REGRESSION_ONLY
  );
  assert.equal(
    intakeVerdict({ publishable: 0, alreadyLive: 5, blocked: 0, regressions: 0 }),
    INTAKE_VERDICTS.NOTHING_NEW
  );
  assert.equal(
    intakeVerdict({ publishable: 0, alreadyLive: 0, blocked: 2, regressions: 0 }),
    INTAKE_VERDICTS.NOTHING_USABLE
  );
});

test("an empty package is nothing usable rather than an error", () => {
  const result = checkIntake({ records: [] }, {});

  assert.equal(result.summary.total, 0);
  assert.equal(result.verdict, INTAKE_VERDICTS.NOTHING_USABLE);
  assert.doesNotThrow(() => formatIntakeReport(result));
});

test("the report names the state, the reason and the regression direction", () => {
  const result = checkIntake(
    {
      records: [
        record({ recordId: "acme-widget" }),
        record({ recordId: "broken", primarySourceFound: false })
      ]
    },
    { products: [product({ category: "bundle" })], links: [link()] }
  );

  const text = formatIntakeReport(result);
  assert.match(text, /JÁ PUBLICADO\s+acme-widget/);
  assert.match(text, /BLOQUEADO\s+broken/);
  assert.match(text, /REGRIDE category: bundle -> plugin/);
  assert.match(text, /VEREDITO: nada novo, e importar reverteria o que está publicado/);
});

test("parseArgs defaults to the repository catalogue and requires --input", () => {
  const options = parseArgs(["--input", "pkg.json"]);

  assert.equal(options.input, "pkg.json");
  assert.match(options.products, /data[\\/]products\.json$/);
  assert.match(options.links, /data[\\/]affiliate-links\.json$/);
  assert.throws(() => parseArgs(["--nope"]), /Unrecognized argument/);
  assert.throws(() => parseArgs(["--input"]), /requires a path/);
  assert.equal(parseArgs(["--help"]).help, true);
});

test("verification is opt-in: the default triage stays offline", () => {
  assert.equal(parseArgs(["--input", "pkg.json"]).verify, false);
  assert.equal(parseArgs(["--input", "pkg.json", "--verify"]).verify, true);
});

test("verifyUrl reports a reachable destination and whether it redirected", async () => {
  const fakeFetch = async () => ({
    ok: true,
    status: 200,
    url: "https://acme.test/widget"
  });

  const direct = await verifyUrl("https://acme.test/widget", { fetchImpl: fakeFetch });
  assert.equal(direct.ok, true);
  assert.equal(direct.redirected, false);

  const moved = await verifyUrl("https://acme.test/widget", {
    fetchImpl: async () => ({ ok: true, status: 200, url: "https://acme.test/widget-v2" })
  });
  assert.equal(moved.redirected, true);
  assert.equal(moved.finalUrl, "https://acme.test/widget-v2");
});

test("a certificate for another domain is reported as a failure, not a status code", async () => {
  const fakeFetch = async () => {
    const error = new Error("fetch failed");
    error.cause = { code: "SEC_E_WRONG_PRINCIPAL" };
    throw error;
  };

  const result = await verifyUrl("https://acme.test/", { fetchImpl: fakeFetch });

  assert.equal(result.ok, false);
  assert.equal(result.status, 0);
  assert.match(result.reason, /SEC_E_WRONG_PRINCIPAL/);
});

test("a non-2xx response does not count as reachable", async () => {
  const result = await verifyUrl("https://acme.test/", {
    fetchImpl: async () => ({ ok: false, status: 404, url: "https://acme.test/" })
  });

  assert.equal(result.ok, false);
  assert.match(result.reason, /HTTP 404/);
});

test("verification skips URLs that are redacted or not https", async () => {
  let calls = 0;
  const pkg = {
    records: [
      record({ recordId: "a", acquisitionUrl: "[suspicious link removed]" }),
      record({ recordId: "b", acquisitionUrl: "http://acme.test/x" }),
      record({ recordId: "c" })
    ]
  };

  const verifications = await verifyAcquisitionUrls(pkg, {
    fetchImpl: async () => {
      calls += 1;
      return { ok: true, status: 200, url: "https://acme.test/widget" };
    }
  });

  assert.equal(calls, 1);
  assert.deepEqual(Object.keys(verifications), ["c"]);
});

test("a destination that does not open blocks an otherwise publishable record", () => {
  const pkg = { records: [record()] };
  const offline = checkIntake(pkg, { products: [], links: [] });
  assert.equal(offline.summary.publishable, 1);

  const online = checkIntake(pkg, {
    products: [],
    links: [],
    verifications: { "acme-widget": { ok: false, status: 0, reason: "SEC_E_WRONG_PRINCIPAL" } }
  });

  assert.equal(online.summary.publishable, 0);
  assert.equal(online.summary.blocked, 1);
  assert.equal(online.records[0].state, INTAKE_STATES.BLOCKED);
  assert.match(online.records[0].reasons.join(" "), /destino não responde/);
  assert.equal(online.verdict, INTAKE_VERDICTS.NOTHING_USABLE);
});

test("a redirect is reported without blocking the record", () => {
  const result = checkIntake(
    { records: [record()] },
    {
      products: [],
      links: [],
      verifications: {
        "acme-widget": {
          ok: true,
          status: 200,
          redirected: true,
          finalUrl: "https://acme.test/widget-v2"
        }
      }
    }
  );

  assert.equal(result.summary.publishable, 1);
  const text = formatIntakeReport({ ...result, verifications: {
    "acme-widget": { ok: true, status: 200, redirected: true, finalUrl: "https://acme.test/widget-v2" }
  } });
  assert.match(text, /destino redireciona para https:\/\/acme\.test\/widget-v2/);
});

test("a destination that is the bare domain is a homepage, a www hop is not", async () => {
  const homepage = await verifyUrl("https://acme.test/widget", {
    fetchImpl: async () => ({ ok: true, status: 200, url: "https://acme.test/" })
  });
  assert.equal(homepage.finalIsHomepage, true);

  // Already the homepage before any redirect: still a homepage destination.
  const alreadyHome = await verifyUrl("https://acme.test/", {
    fetchImpl: async () => ({ ok: true, status: 200, url: "https://acme.test/" })
  });
  assert.equal(alreadyHome.finalIsHomepage, true);

  const www = await verifyUrl("https://acme.test/widget", {
    fetchImpl: async () => ({ ok: true, status: 200, url: "https://www.acme.test/widget" })
  });
  assert.equal(www.finalIsHomepage, false);
});

test("the report says when a destination is the brand homepage", () => {
  const result = checkIntake({ records: [record()] }, { products: [], links: [] });
  const text = formatIntakeReport({
    ...result,
    verifications: {
      "acme-widget": {
        ok: true,
        status: 200,
        redirected: true,
        finalIsHomepage: true,
        finalUrl: "https://acme.test/"
      }
    }
  });

  assert.match(text, /destino é a home da marca: https:\/\/acme\.test\//);
  // A homepage destination is surfaced, not treated as unpublishable.
  assert.equal(result.summary.publishable, 1);
});
