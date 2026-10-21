import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateEditorialState } from "../assets/content-blocks.mjs";
import {
  EDITORIAL_INPUT_VERSION,
  applyEditorialRecords,
  buildBlockFromRecord,
  buildProductKey,
  hasUsableCopy,
  missingRecordValues,
  resolveRecordType,
  validateEditorialInputRecord
} from "../scripts/content-fill.mjs";
import { buildJevFillRequest, interpretJevFillAnswers } from "../scripts/jev-judgments.mjs";

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const PUBLIC_PROMOTION_ID = "promo-acustica-sep26";

test("the demo video travels from the product facts to the block content", () => {
  const base = {
    recordId: "acme-widget",
    type: "product-review",
    section: "articles",
    position: 0,
    facts: {
      product: {
        name: "Widget",
        developer: "Acme",
        category: "plugin",
        demoUrl: "https://www.youtube.com/watch?v=BoCl2BoZwas"
      },
      offer: { promoPrice: 0, permanent: true },
      sources: []
    },
    draftCopy: { title: "Widget", body: "A widget." }
  };

  const block = {
    id: "product-review-acme-widget",
    type: "product-review",
    section: "articles",
    position: 0,
    content: {},
    metadata: {}
  };
  buildBlockFromRecord(base, block, { type: "product-review" });
  assert.equal(block.content.demoUrl, "https://www.youtube.com/watch?v=BoCl2BoZwas");

  // Absent stays absent: a review without a vendor video gets no placeholder.
  const bare = {
    ...base,
    facts: { ...base.facts, product: { ...base.facts.product, demoUrl: null } }
  };
  const bareBlock = { ...block, content: {}, metadata: {} };
  buildBlockFromRecord(bare, bareBlock, { type: "product-review" });
  assert.equal("demoUrl" in bareBlock.content, false);
});

function makeMetadata() {
  return {
    enabled: true,
    editorialStage: "RADAR",
    sources: [],
    evidence: {
      sourceConfirmed: false,
      productConfirmed: false,
      priceConfirmed: false,
      datesConfirmed: false,
      termsConfirmed: false,
      sufficient: false
    },
    selection: "",
    verdict: "",
    editorialStatus: "",
    validation: {
      claims: false,
      price: false,
      dates: false,
      terms: false,
      status: false,
      recut: false,
      verdict: false,
      links: false,
      previewApproved: false
    },
    publication: { state: "unpublished", approvedAt: null, publishedAt: null },
    advance: { selected: true, ready: true, requestedAt: "2026-10-14T12:00:00.000Z" }
  };
}

function makeState() {
  return {
    schemaVersion: 2,
    revision: 1,
    updatedAt: "2026-10-14T12:00:00.000Z",
    blocks: [
      {
        id: "radar-gold-6-review",
        type: "product-review",
        section: "articles",
        position: 10,
        status: "published",
        content: { title: "Previous title", body: "Previous body", verdict: "Previous note" },
        metadata: makeMetadata()
      },
      {
        id: "home-hero",
        type: "hero",
        section: "home",
        position: 10,
        status: "published",
        content: { title: "Started as a hobby." },
        metadata: makeMetadata()
      }
    ]
  };
}

function makeRecord(overrides = {}) {
  return {
    inputVersion: EDITORIAL_INPUT_VERSION,
    recordId: "gold-6-intro",
    type: "product-review",
    facts: {
      product: { name: "Acustica Audio GOLD 6", developer: "Acustica Audio", category: "plugin" },
      offer: {
        promoPrice: 99,
        regularPrice: 149,
        currency: "EUR",
        startsAt: null,
        endsAt: "2026-09-25T23:59:59Z"
      },
      sources: ["https://www.acusticaaudio.com/gold6"]
    },
    draftCopy: {
      title: "Acustica Audio GOLD 6",
      body: "GOLD 6 arrives with a confirmed introductory price of EUR 99 through September 25.",
      verdict: "A serious sound investment.",
      href: "/go/link-acustica-gold6-26",
      linkLabel: "View Intro Offer"
    },
    editorial: {
      verdict: "Fire",
      editorialStatus: "New Release",
      selection: "Develop"
    },
    evidence: {
      sourceConfirmed: true,
      productConfirmed: true,
      priceConfirmed: true,
      datesConfirmed: true,
      termsConfirmed: false,
      sufficient: true
    },
    ...overrides
  };
}

test("a complete validated record passes input validation", () => {
  const report = validateEditorialInputRecord(makeRecord());
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.warnings, []);
});

test("input validation rejects a wrong version, a bad id and an unknown copy field", () => {
  const wrongVersion = validateEditorialInputRecord(makeRecord({ inputVersion: "2.0" }));
  assert.equal(wrongVersion.errors.some((issue) => issue.code === "UNSUPPORTED_INPUT_VERSION"), true);

  const badId = validateEditorialInputRecord(makeRecord({ recordId: "Bad ID" }));
  assert.equal(badId.errors.some((issue) => issue.code === "INVALID_RECORD_ID"), true);

  const badCopy = validateEditorialInputRecord(
    makeRecord({ draftCopy: { title: "x", deck: "not a product-review field" } })
  );
  assert.equal(badCopy.errors.some((issue) => issue.code === "UNKNOWN_COPY_FIELD"), true);
});

test("input validation rejects invented taxonomies and unknown evidence flags", () => {
  const badVerdict = validateEditorialInputRecord(makeRecord({ editorial: { verdict: "Awesome" } }));
  assert.equal(badVerdict.errors.some((issue) => issue.code === "INVALID_EDITORIAL_VERDICT"), true);

  const badStatus = validateEditorialInputRecord(makeRecord({ editorial: { editorialStatus: "Hot" } }));
  assert.equal(badStatus.errors.some((issue) => issue.code === "INVALID_EDITORIAL_STATUS"), true);

  const badEvidence = validateEditorialInputRecord(makeRecord({ evidence: { priceConfirmed: true, vibes: true } }));
  assert.equal(badEvidence.errors.some((issue) => issue.code === "UNKNOWN_EVIDENCE_KEY"), true);

  const nonBoolean = validateEditorialInputRecord(makeRecord({ evidence: { priceConfirmed: "yes" } }));
  assert.equal(nonBoolean.errors.some((issue) => issue.code === "INVALID_EVIDENCE_VALUE"), true);
});

test("input validation requires facts a block cannot be filled without", () => {
  const noName = validateEditorialInputRecord(
    makeRecord({ facts: { product: { name: "" }, offer: { promoPrice: 1 } } })
  );
  assert.equal(noName.errors.some((issue) => issue.code === "MISSING_PRODUCT_NAME"), true);

  const dealWithoutOffer = validateEditorialInputRecord(
    makeRecord({ type: "deal", draftCopy: {}, facts: { product: { name: "X" } } })
  );
  assert.equal(dealWithoutOffer.errors.some((issue) => issue.code === "MISSING_DEAL_OFFER"), true);

  const unknownPromotion = validateEditorialInputRecord(
    makeRecord({ type: "deal", draftCopy: {}, facts: { product: { name: "X" }, offer: { promotionId: "ghost" } } }),
    { knownPromotionIds: new Map([["real", {}]]) }
  );
  assert.equal(unknownPromotion.errors.some((issue) => issue.code === "UNKNOWN_PROMOTION"), true);
});

test("the declared type wins and the undeclared case is resolved deterministically", () => {
  assert.deepEqual(resolveRecordType(makeRecord(), { offerKind: "bundle" }), {
    type: "product-review",
    source: "record"
  });

  // offer_kind is a product category, not a block type: a bundle is still
  // presented as a product review unless the record references a promotion.
  const undeclared = makeRecord({ type: undefined });
  assert.deepEqual(resolveRecordType(undeclared, { offerKind: "bundle" }), {
    type: "product-review",
    source: "facts"
  });

  const withPromotion = makeRecord({
    type: undefined,
    draftCopy: {},
    facts: { product: { name: "X" }, offer: { promotionId: PUBLIC_PROMOTION_ID } }
  });
  assert.deepEqual(resolveRecordType(withPromotion, { offerKind: "plugin" }), { type: "deal", source: "facts" });

  // Only Jev's "not an offer" judgment can stop the fill.
  assert.deepEqual(resolveRecordType(undeclared, { offerKind: "not-a-product-offer" }), {
    type: null,
    source: "jev"
  });
});

test("the fill copies validated values verbatim and carries the human Verdict and Status", () => {
  const state = makeState();
  const untouchedBefore = JSON.stringify(state.blocks[1]);

  const { state: filled, results } = applyEditorialRecords(
    state,
    [{ record: makeRecord(), type: "product-review", jev: { model: "jev-latest", route: "typesafe" } }],
    { updatedAt: "2026-10-14T15:00:00.000Z" }
  );

  assert.equal(results.length, 1);
  assert.equal(results[0].action, "created");
  assert.equal(results[0].blockId, "product-review-gold-6-intro");

  const block = filled.blocks.find((entry) => entry.id === "product-review-gold-6-intro");
  assert.equal(block.content.title, "Acustica Audio GOLD 6");
  assert.equal(block.content.body, "GOLD 6 arrives with a confirmed introductory price of EUR 99 through September 25.");
  assert.equal(block.content.href, "/go/link-acustica-gold6-26");
  assert.equal(block.metadata.verdict, "Fire");
  assert.equal(block.metadata.editorialStatus, "New Release");
  assert.equal(block.metadata.selection, "Develop");
  assert.deepEqual(block.metadata.sources, ["https://www.acusticaaudio.com/gold6"]);
  assert.equal(block.metadata.evidence.priceConfirmed, true);
  assert.equal(block.metadata.evidence.termsConfirmed, false);

  // Provenance: the editorial values were carried from validated input.
  assert.equal(block.metadata.jev.filledBy, "code");
  assert.equal(block.metadata.jev.source, "validated-editorial-record");
  assert.deepEqual(block.metadata.jev.carriedEditorial, {
    verdict: true,
    editorialStatus: true,
    selection: true
  });

  // A filled block cannot keep an earlier /advance confirmation.
  assert.equal(block.metadata.advance.ready, false);
  assert.equal(block.metadata.advance.selected, false);

  // An unrelated block survives byte for byte.
  assert.equal(JSON.stringify(filled.blocks[1]), untouchedBefore);
  assert.equal(filled.revision, state.revision + 1);

  validateEditorialState(filled);
});

test("the fill leaves absent values empty and reports the gap instead of inventing copy", () => {
  const record = makeRecord({
    draftCopy: { href: "/go/link-acustica-gold6-26" },
    facts: { product: { name: "Acustica Audio GOLD 6" } },
    editorial: {}
  });
  const state = makeState();
  const { state: filled, results } = applyEditorialRecords(state, [{ record, type: "product-review" }]);

  const block = filled.blocks.find((entry) => entry.id === "product-review-gold-6-intro");
  assert.equal(block.content.title, "");
  assert.equal(block.content.body, "");
  assert.equal(block.metadata.verdict, "");
  assert.equal(block.metadata.editorialStatus, "");

  assert.deepEqual(results[0].missing, [
    "draftCopy.title",
    "draftCopy.body",
    "facts.offer.promoPrice",
    "facts.offer.endsAt",
    "facts.sources"
  ]);
  assert.deepEqual(block.metadata.jev.copyFields, ["href"]);
});

test("the fill updates an existing block when the record targets its id", () => {
  const state = makeState();
  const record = makeRecord({ blockId: "radar-gold-6-review", type: "product-review" });
  const { state: filled, results } = applyEditorialRecords(state, [{ record, type: "product-review" }]);

  assert.equal(results[0].action, "updated");
  assert.equal(results[0].blockId, "radar-gold-6-review");
  assert.equal(filled.blocks.length, state.blocks.length);

  const block = filled.blocks.find((entry) => entry.id === "radar-gold-6-review");
  assert.equal(block.content.title, "Acustica Audio GOLD 6");
  assert.equal(block.status, "draft");
});

test("the fill refuses a deal whose promotion is not an approved public record", () => {
  const state = makeState();
  const record = makeRecord({
    recordId: "deal-test",
    type: "deal",
    draftCopy: {},
    facts: { product: { name: "X" }, offer: { promotionId: PUBLIC_PROMOTION_ID } }
  });

  assert.throws(
    () =>
      applyEditorialRecords(state, [{ record, type: "deal" }], {
        promotionsById: new Map([[PUBLIC_PROMOTION_ID, { id: PUBLIC_PROMOTION_ID, publicationStatus: "draft", requiresReview: true }]])
      }),
    /not an approved public promotion/
  );
});

test("the fill refuses a record with no resolvable block type", () => {
  const state = makeState();
  assert.throws(
    () => applyEditorialRecords(state, [{ record: makeRecord(), type: null }]),
    /no resolvable content block type/
  );
});

test("a fact declared notApplicable is not reported as a gap", () => {
  const record = makeRecord({
    draftCopy: { title: "Title", body: "Body" },
    facts: { product: { name: "X" } },
    notApplicable: ["endsAt", "promoPrice"],
    editorial: {}
  });

  const { state: filled, results } = applyEditorialRecords(makeState(), [{ record, type: "product-review" }]);

  assert.deepEqual(results[0].missing, ["facts.sources"]);

  const block = filled.blocks.find((entry) => entry.id === "product-review-gold-6-intro");
  assert.deepEqual(block.metadata.jev.notApplicable, ["endsAt", "promoPrice"]);
  assert.deepEqual(block.metadata.jev.missing, ["facts.sources"]);
});

test("notApplicable must be an array of non-empty strings", () => {
  const notAnArray = validateEditorialInputRecord(makeRecord({ notApplicable: "endsAt" }));
  assert.equal(notAnArray.errors.some((issue) => issue.code === "INVALID_NOT_APPLICABLE"), true);

  const badEntry = validateEditorialInputRecord(makeRecord({ notApplicable: [""] }));
  assert.equal(badEntry.errors.some((issue) => issue.code === "INVALID_NOT_APPLICABLE"), true);

  const fine = validateEditorialInputRecord(makeRecord({ notApplicable: ["endsAt"] }));
  assert.deepEqual(fine.errors, []);
});

test("re-delivering the same record merges instead of creating a duplicate", () => {
  const state = makeState();
  const record = makeRecord({ type: "product-review" });

  const first = applyEditorialRecords(state, [{ record, type: "product-review" }]);
  assert.equal(first.results[0].action, "created");
  assert.equal(first.results[0].matchedBy, "created");
  assert.equal(first.state.blocks.length, state.blocks.length + 1);

  const second = applyEditorialRecords(first.state, [{ record, type: "product-review" }]);
  assert.equal(second.results.length, 1);
  assert.equal(second.results[0].action, "updated");
  assert.equal(second.results[0].matchedBy, "recordId");
  assert.equal(second.state.blocks.length, first.state.blocks.length, "no duplicate block appears");
});

test("a merge keeps the Verdict, Status and selection a human assigned", () => {
  const state = makeState();
  // A source with no editorial authority: the package format carries none.
  const record = makeRecord({ type: "product-review", editorial: {} });

  const first = applyEditorialRecords(state, [{ record, type: "product-review" }]);
  const block = first.state.blocks.find((entry) => entry.id === "product-review-gold-6-intro");
  block.metadata.verdict = "Stash";
  block.metadata.editorialStatus = "Last Chance";
  block.metadata.selection = "Monitor";

  const second = applyEditorialRecords(first.state, [{ record, type: "product-review" }]);
  const after = second.state.blocks.find((entry) => entry.id === "product-review-gold-6-intro");

  assert.deepEqual(second.results[0].carried, {}, "nothing editorial was carried");
  assert.equal(after.metadata.verdict, "Stash");
  assert.equal(after.metadata.editorialStatus, "Last Chance");
  assert.equal(after.metadata.selection, "Monitor");
});

test("a record that does carry editorial values still applies them on merge", () => {
  const state = makeState();
  const withEditorial = makeRecord({ type: "product-review" });
  const withoutEditorial = makeRecord({ type: "product-review", editorial: {} });

  const first = applyEditorialRecords(state, [{ record: withEditorial, type: "product-review" }]);
  const second = applyEditorialRecords(first.state, [{ record: withoutEditorial, type: "product-review" }]);
  const third = applyEditorialRecords(second.state, [{ record: withEditorial, type: "product-review" }]);

  const block = third.state.blocks.find((entry) => entry.id === "product-review-gold-6-intro");
  assert.equal(second.state.blocks.find((e) => e.id === block.id).metadata.verdict, "Fire", "kept from the first fill");
  assert.equal(block.metadata.verdict, "Fire", "re-applied by the validated record");
});

test("a block not created by this pipeline is never overwritten by accident", () => {
  const state = makeState();
  const record = makeRecord({ type: "product-review", editorial: {} });

  // The derived id collides with a hand-authored block.
  const handAuthored = state.blocks.find((entry) => entry.id === "radar-gold-6-review");
  handAuthored.id = "product-review-gold-6-intro";
  assert.equal(handAuthored.metadata.jev, undefined);

  assert.throws(
    () => applyEditorialRecords(state, [{ record, type: "product-review" }]),
    /was not created by this pipeline/
  );

  // The explicit escape hatch still works.
  const targeted = applyEditorialRecords(state, [
    { record: makeRecord({ blockId: "product-review-gold-6-intro", type: "product-review" }), type: "product-review" }
  ]);
  assert.equal(targeted.results[0].matchedBy, "blockId");
});

test("buildProductKey normalizes developer and product so sources can agree", () => {
  assert.equal(buildProductKey(makeRecord()), "acustica audio|acustica audio gold 6");
  assert.equal(
    buildProductKey(makeRecord({ facts: { product: { name: "GOLD-6", developer: "Acustica  Audio" } } })),
    "acustica audio|gold 6"
  );
  assert.equal(buildProductKey(makeRecord({ facts: { product: { name: "" } } })), null);
});

test("two sources naming the same product under different recordIds are reported", () => {
  const state = makeState();

  const { duplicateWarnings, state: filled } = applyEditorialRecords(state, [
    { record: makeRecord({ recordId: "gold-6-intro", type: "product-review" }), type: "product-review" },
    { record: makeRecord({ recordId: "acustica-gold-6-free", type: "product-review" }), type: "product-review" }
  ]);

  // Both blocks are still created: the warning informs, it does not decide.
  assert.equal(filled.blocks.length, state.blocks.length + 2);
  assert.equal(duplicateWarnings.length, 1);
  assert.equal(duplicateWarnings[0].productKey, "acustica audio|acustica audio gold 6");
  assert.equal(duplicateWarnings[0].existingRecordId, "gold-6-intro");
  assert.equal(duplicateWarnings[0].incomingRecordId, "acustica-gold-6-free");
});

test("a duplicate arriving in a later run is reported against the existing block", () => {
  const state = makeState();

  const first = applyEditorialRecords(state, [
    { record: makeRecord({ recordId: "gold-6-intro", type: "product-review" }), type: "product-review" }
  ]);
  assert.deepEqual(first.duplicateWarnings, []);

  const second = applyEditorialRecords(first.state, [
    { record: makeRecord({ recordId: "acustica-gold-6-free", type: "product-review" }), type: "product-review" }
  ]);
  assert.equal(second.duplicateWarnings.length, 1);
  assert.equal(second.duplicateWarnings[0].existingRecordId, "gold-6-intro");
  assert.equal(second.duplicateWarnings[0].incomingRecordId, "acustica-gold-6-free");

  // Re-delivering the same recordId is a merge, not a duplicate.
  const third = applyEditorialRecords(second.state, [
    { record: makeRecord({ recordId: "gold-6-intro", type: "product-review" }), type: "product-review" }
  ]);
  assert.deepEqual(third.duplicateWarnings, []);
});

test("missing-value detection and usable-copy detection drive the Jev questions", () => {  assert.equal(hasUsableCopy(makeRecord(), "product-review"), true);
  assert.equal(hasUsableCopy(makeRecord({ draftCopy: {} }), "product-review"), false);
  assert.equal(hasUsableCopy(makeRecord({ type: "deal", draftCopy: {} }), "deal"), false);
  assert.deepEqual(missingRecordValues(makeRecord(), "product-review"), []);
  assert.deepEqual(missingRecordValues(makeRecord({ draftCopy: {} }), "product-review"), [
    "draftCopy.title",
    "draftCopy.body"
  ]);
});

test("the fill request asks for a type only when the record does not declare one", () => {
  const declared = buildJevFillRequest(makeRecord(), { hasCopy: true, needsType: false });
  assert.equal(Object.hasOwn(declared.questions, "offer_kind"), false);
  assert.equal(Object.hasOwn(declared.questions, "copy_matches_facts"), true);
  assert.equal(declared.questions.facts_sufficient.type, "noul");
  assert.equal(Object.hasOwn(declared.questions, "offer_record_consistency"), false);

  const undeclared = buildJevFillRequest(makeRecord({ type: undefined }), { needsType: true });
  assert.equal(undeclared.questions.offer_kind.type, "choice");
  assert.ok(Object.hasOwn(undeclared.questions.offer_kind.criteria, "not-a-product-offer"));
  assert.equal(Object.hasOwn(undeclared.questions, "copy_matches_facts"), false);

  const withRecord = buildJevFillRequest(makeRecord({ type: "deal" }), { hasPromotionRecord: true });
  assert.equal(Object.hasOwn(withRecord.questions, "offer_record_consistency"), true);
});

test("fill answers become advisories that flag misplacement and gaps", () => {
  const advisories = interpretJevFillAnswers(
    makeRecord(),
    {
      offer_kind: { type: "choice", choice: "plugin", probabilities: {}, confidence: 0.9 },
      reader_facing_language: { type: "choice", choice: "portuguese", probabilities: {}, confidence: 0.9 },
      copy_matches_facts: { type: "noul", noul: 0.1 },
      product_identified: { type: "noul", noul: 0.97 },
      price_stated: { type: "noul", noul: 0.9 },
      dates_stated: { type: "noul", noul: 0.2 },
      source_cited: { type: "noul", noul: 0.95 },
      facts_sufficient: { type: "noul", noul: 0.4 }
    },
    { model: "jev-latest", route: "typesafe", evaluatedAt: "2026-10-14T15:00:00.000Z" }
  );

  assert.equal(advisories.advisories.signals.copyMatchesFacts, false);
  assert.equal(advisories.advisories.signals.datesStated, false);
  assert.equal(advisories.advisories.signals.factsSufficient, false);
  assert.equal(advisories.advisories.probabilities.datesStated, 0.2);
  assert.ok(advisories.advisories.reviewNotes.some((note) => /does not appear to describe the product/.test(note)));
  assert.ok(advisories.advisories.reviewNotes.some((note) => /publishes in English/.test(note)));
  assert.equal(advisories.advisories.suggestedVerdict, undefined);
});

async function writeFixture(record) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "asp-fill-"));
  const statePath = path.join(directory, "state.json");
  const recordsPath = path.join(directory, "records.json");
  await writeFile(statePath, JSON.stringify(makeState()), "utf8");
  await writeFile(recordsPath, JSON.stringify(Array.isArray(record) ? record : [record]), "utf8");
  return { directory, statePath, recordsPath };
}

function cleanEnv() {
  const env = { ...process.env };
  for (const key of ["TYPESAFE_API_KEY", "AI_GATEWAY_API_KEY", "JEV_API_KEY", "JEV_BASE_URL", "JEV_MODEL", "JEV_ROUTE"]) {
    delete env[key];
  }
  return env;
}

test("the fill CLI prints requests offline and needs no credential", async () => {
  const { statePath, recordsPath } = await writeFixture(makeRecord({ type: undefined }));
  const result = spawnSync(
    process.execPath,
    ["scripts/jev-fill.mjs", "--print-request", "--state", statePath, "--records", recordsPath],
    { cwd: rootDirectory, encoding: "utf8", env: cleanEnv() }
  );

  assert.equal(result.status, 0, result.stderr);
  const printed = JSON.parse(result.stdout);
  assert.equal(printed.length, 1);
  assert.equal(printed[0].recordId, "gold-6-intro");
  assert.equal(printed[0].body.questions.offer_kind.type, "choice");
});

test("the fill CLI fills deterministically with --no-jev and writes an importable export", async () => {
  const { directory, statePath, recordsPath } = await writeFixture(makeRecord({ type: undefined }));
  const outputPath = path.join(directory, "filled.json");
  const reportPath = path.join(directory, "report.json");

  const result = spawnSync(
    process.execPath,
    [
      "scripts/jev-fill.mjs",
      "--no-jev",
      "--state", statePath,
      "--records", recordsPath,
      "--output", outputPath,
      "--report", reportPath
    ],
    { cwd: rootDirectory, encoding: "utf8", env: cleanEnv() }
  );

  // A missing type is fatal without a classifier, so this run must fail closed.
  assert.equal(result.status, 1);
  assert.match(result.stderr, /must declare a type when --no-jev is used/);

  const declared = await writeFixture(makeRecord());
  const okOutput = path.join(declared.directory, "filled.json");
  const okReport = path.join(declared.directory, "report.json");
  const ok = spawnSync(
    process.execPath,
    [
      "scripts/jev-fill.mjs",
      "--no-jev",
      "--state", declared.statePath,
      "--records", declared.recordsPath,
      "--output", okOutput,
      "--report", okReport
    ],
    { cwd: rootDirectory, encoding: "utf8", env: cleanEnv() }
  );

  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /Filled 1 block\(s\) \(1 created, 0 updated\)/);

  const envelope = JSON.parse(await readFile(okOutput, "utf8"));
  assert.equal(envelope.format, "asp-console-export");
  assert.equal(envelope.formatVersion, 1);
  validateEditorialState(envelope.state);

  const filled = envelope.state.blocks.find((block) => block.id === "product-review-gold-6-intro");
  assert.equal(filled.metadata.verdict, "Fire");
  assert.equal(filled.metadata.editorialStatus, "New Release");

  const report = JSON.parse(await readFile(okReport, "utf8"));
  assert.equal(report.format, "asp-jev-fill-report");
  assert.equal(report.route, "none");
  assert.equal(report.results[0].blockId, "product-review-gold-6-intro");
});

test("the fill CLI fails with a contextual message when an input record is invalid", async () => {
  const { statePath, recordsPath } = await writeFixture(makeRecord({ recordId: "Bad ID" }));
  const result = spawnSync(
    process.execPath,
    ["scripts/jev-fill.mjs", "--no-jev", "--state", statePath, "--records", recordsPath],
    { cwd: rootDirectory, encoding: "utf8", env: cleanEnv() }
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Invalid editorial input/);
  assert.match(result.stderr, /recordId must use lowercase letters/);
});

test("the fill CLI fails closed when Jev is needed but no credential is configured", async () => {
  const { statePath, recordsPath } = await writeFixture(makeRecord({ type: undefined }));
  const result = spawnSync(
    process.execPath,
    ["scripts/jev-fill.mjs", "--state", statePath, "--records", recordsPath],
    { cwd: rootDirectory, encoding: "utf8", env: cleanEnv() }
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /requires a credential/);
});
