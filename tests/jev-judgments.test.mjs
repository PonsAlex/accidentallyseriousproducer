import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateEditorialState } from "../assets/content-blocks.mjs";
import {
  JEV_ADVISORY_KEY,
  JEV_AI_GATEWAY_BASE_URL,
  JEV_AI_GATEWAY_MODEL,
  JEV_SKIP_REASONS,
  JEV_TYPESAFE_BASE_URL,
  JEV_TYPESAFE_MODEL,
  JEV_UNDETERMINED,
  applyJevSuggestions,
  assertEditorialAuthorityPreserved,
  buildJevRequest,
  buildJevRequests,
  callSystemOne,
  interpretJevAnswers,
  joinSystemOneEndpoint,
  resolveJevEndpoint
} from "../scripts/jev-judgments.mjs";

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function makeMetadata(overrides = {}) {
  return {
    enabled: true,
    editorialStage: "PREVIEW / HUMAN REVIEW",
    sources: ["https://example.invalid/official-offer"],
    evidence: {
      sourceConfirmed: true,
      productConfirmed: true,
      priceConfirmed: true,
      datesConfirmed: true,
      termsConfirmed: true,
      sufficient: true
    },
    selection: "Develop",
    verdict: "Fire",
    editorialStatus: "Last Chance",
    validation: {
      claims: true,
      price: true,
      dates: true,
      terms: true,
      status: false,
      recut: false,
      verdict: false,
      links: true,
      previewApproved: false
    },
    publication: { state: "unpublished", approvedAt: null, publishedAt: null },
    advance: {
      selected: true,
      ready: true,
      requestedAt: "2026-10-14T12:00:00.000Z",
      fromStage: "SELEÇÃO EDITORIAL",
      toStage: "PREVIEW / HUMAN REVIEW"
    },
    ...overrides
  };
}

function makeState() {
  return {
    schemaVersion: 2,
    revision: 1,
    updatedAt: "2026-10-14T12:00:00.000Z",
    blocks: [
      {
        id: "review-gold-6",
        type: "product-review",
        section: "articles",
        position: 10,
        status: "review",
        content: {
          title: "Acustica Audio GOLD 6",
          body: "GOLD 6 arrives with a confirmed introductory price of EUR 99 through September 25.",
          verdict: "A serious sound investment.",
          href: "/go/link-acustica-gold6-26",
          linkLabel: "View Intro Offer"
        },
        metadata: makeMetadata()
      },
      {
        id: "deal-gold-6",
        type: "deal",
        section: "deals",
        position: 10,
        status: "published",
        content: { promotionId: "promo-gold-6" },
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

const promotion = {
  id: "promo-gold-6",
  productId: "product-gold-6",
  promoPrice: 99,
  regularPrice: 149,
  currency: "EUR",
  endsAt: "2026-09-25T23:59:59Z",
  status: "New Release",
  verdict: "Fire"
};

const product = {
  id: "product-gold-6",
  name: "GOLD 6",
  category: "plugin",
  description: "Sampled channel strip."
};

function makeIndexes() {
  return {
    productsById: new Map([[product.id, product]]),
    promotionsById: new Map([[promotion.id, promotion]])
  };
}

function answers({
  offerKind = "plugin",
  language = "english",
  price = 0.95,
  dates = 0.9,
  terms = 0.2,
  source = 0.88,
  sufficient = 0.8,
  consistency = 0.9,
  status = "New Release",
  verdict = "Fire",
  includeConsistency = true,
  includeLanguage = true
} = {}) {
  const result = {
    offer_kind: { type: "choice", choice: offerKind, probabilities: {}, confidence: 0.9 },
    states_specific_price: { type: "noul", noul: price },
    states_specific_dates: { type: "noul", noul: dates },
    states_terms: { type: "noul", noul: terms },
    cites_identifiable_source: { type: "noul", noul: source },
    evidence_sufficient: { type: "noul", noul: sufficient },
    suggested_status: { type: "choice", choice: status, probabilities: {}, confidence: 0.7 },
    suggested_verdict: { type: "choice", choice: verdict, probabilities: {}, confidence: 0.6 }
  };
  if (includeLanguage) {
    result.reader_facing_language = { type: "choice", choice: language, probabilities: {}, confidence: 0.95 };
  }
  if (includeConsistency) {
    result.offer_record_consistency = { type: "noul", noul: consistency };
  }
  return result;
}

test("buildJevRequest asks one System One call per block with typed questions", () => {
  const state = makeState();
  const review = state.blocks[0];
  const request = buildJevRequest(review);

  assert.equal(request.model, JEV_TYPESAFE_MODEL);
  assert.equal(request.questions.offer_kind.type, "choice");
  assert.equal(request.questions.suggested_verdict.type, "choice");
  assert.equal(request.questions.evidence_sufficient.type, "noul");
  assert.ok(Object.hasOwn(request.questions.offer_kind.criteria, "plugin"));
  assert.ok(Object.hasOwn(request.questions.offer_kind.criteria, "not-a-product-offer"));
  assert.ok(Object.hasOwn(request.questions.suggested_verdict.criteria, JEV_UNDETERMINED));
  assert.ok(Object.hasOwn(request.questions.suggested_status.criteria, "Call an Ambulance"));

  // A review block carries reader-facing copy but has no referenced promotion.
  assert.ok(Object.hasOwn(request.questions, "reader_facing_language"));
  assert.equal(Object.hasOwn(request.questions, "offer_record_consistency"), false);

  assert.equal(request.state.editorialContext.blockId, "review-gold-6");
  assert.equal(request.state.submission.readerFacing.title, "Acustica Audio GOLD 6");
  assert.deepEqual(request.state.submission.sources, ["https://example.invalid/official-offer"]);
});

test("buildJevRequest includes the referenced offer record for a deal block", () => {
  const state = makeState();
  const deal = state.blocks.find((block) => block.id === "deal-gold-6");
  const request = buildJevRequest(deal, { product, promotion });

  assert.ok(Object.hasOwn(request.questions, "offer_record_consistency"));
  assert.equal(Object.hasOwn(request.questions, "reader_facing_language"), false);
  assert.equal(
    request.state.submission.referencedOffer.promotion.currentPrice,
    99
  );
  assert.equal(request.state.submission.referencedOffer.product.name, "GOLD 6");
});

test("buildJevRequest refuses block types Jev must not judge", () => {
  const state = makeState();
  const hero = state.blocks.find((block) => block.id === "home-hero");
  assert.throws(() => buildJevRequest(hero), /not a Jev-evaluated block type/);
});

test("buildJevRequests records skipped blocks with a reason instead of dropping them", () => {
  const state = makeState();
  const { requests, skipped } = buildJevRequests(state, makeIndexes());

  assert.deepEqual(
    requests.map((entry) => entry.blockId).sort(),
    ["deal-gold-6", "review-gold-6"]
  );
  const hero = skipped.find((entry) => entry.blockId === "home-hero");
  assert.equal(hero.reason, JEV_SKIP_REASONS.unsupportedType);

  const orphaned = buildJevRequests(
    {
      ...state,
      blocks: state.blocks.map((block) =>
        block.id === "deal-gold-6" ? { ...block, content: { promotionId: "missing" } } : block
      )
    },
    makeIndexes()
  );
  assert.equal(
    orphaned.skipped.find((entry) => entry.blockId === "deal-gold-6").reason,
    JEV_SKIP_REASONS.missingPromotion
  );
});

test("interpretJevAnswers keeps raw probabilities and flags below-threshold evidence", () => {
  const state = makeState();
  const review = state.blocks[0];
  const result = interpretJevAnswers(review, answers({ terms: 0.2 }), {
    model: "jev-1.13.0",
    evaluatedAt: "2026-10-14T13:00:00.000Z",
    route: "ai-gateway"
  });

  assert.equal(result.type, "evaluated");
  assert.equal(result.advisory, true);
  assert.equal(result.requiresHumanReview, true);
  assert.equal(result.model, "jev-1.13.0");
  assert.equal(result.route, "ai-gateway");

  assert.equal(result.advisories.signals.statesTerms, false);
  assert.equal(result.advisories.signals.evidenceSufficient, true);
  assert.equal(result.advisories.probabilities.statesTerms, 0.2);
  assert.equal(result.advisories.suggestedVerdict, "Fire");
  assert.equal(result.advisories.suggestedVerdictConfidence, 0.6);

  assert.ok(result.advisories.reviewNotes.some((note) => /conditions are not stated/.test(note)));
  assert.ok(
    result.advisories.reviewNotes.some((note) => /editorial Verdict remains a human decision/.test(note))
  );
});

test("interpretJevAnswers reports an undetermined verdict and a non-English block", () => {
  const state = makeState();
  const review = state.blocks[0];
  const result = interpretJevAnswers(
    review,
    answers({ verdict: JEV_UNDETERMINED, language: "mixed", sufficient: 0.4, includeConsistency: false }),
    { model: JEV_TYPESAFE_MODEL, evaluatedAt: "2026-10-14T13:00:00.000Z" }
  );

  assert.equal(result.advisories.suggestedVerdict, JEV_UNDETERMINED);
  assert.equal(result.advisories.probabilities.offerRecordConsistency, null);
  assert.equal(result.advisories.signals.offerRecordConsistency, null);
  assert.ok(result.advisories.reviewNotes.some((note) => /publishes in English/.test(note)));
  assert.ok(
    result.advisories.reviewNotes.some((note) => /without inventing at least one fact/.test(note))
  );
  assert.equal(
    result.advisories.reviewNotes.some((note) => /proposes the Verdict/.test(note)),
    false
  );
});

test("interpretJevAnswers refuses block types outside the advisory scope", () => {
  const state = makeState();
  const hero = state.blocks.find((block) => block.id === "home-hero");
  assert.throws(() => interpretJevAnswers(hero, answers(), {}), /not a Jev-evaluated block type/);
});

test("applyJevSuggestions adds only metadata.jev and never touches editorial authority", () => {
  const state = makeState();
  const review = state.blocks[0];
  const report = {
    results: [
      interpretJevAnswers(review, answers(), {
        model: "jev-1.13.0",
        route: "typesafe",
        evaluatedAt: "2026-10-14T13:00:00.000Z"
      })
    ]
  };

  const { state: merged, applied } = applyJevSuggestions(state, report, {
    updatedAt: "2026-10-14T14:00:00.000Z"
  });

  assert.equal(applied, 1);
  assert.equal(merged.revision, state.revision + 1);
  assert.equal(merged.updatedAt, "2026-10-14T14:00:00.000Z");

  const mergedReview = merged.blocks[0];
  assert.ok(mergedReview.metadata[JEV_ADVISORY_KEY]);
  assert.equal(mergedReview.metadata[JEV_ADVISORY_KEY].advisories.suggestedVerdict, "Fire");

  // Editorial authority is preserved byte for byte.
  assert.equal(mergedReview.metadata.verdict, "Fire");
  assert.equal(mergedReview.metadata.editorialStatus, "Last Chance");
  assert.equal(mergedReview.metadata.selection, "Develop");
  assert.equal(mergedReview.metadata.editorialStage, "PREVIEW / HUMAN REVIEW");
  assert.deepEqual(mergedReview.metadata.evidence, state.blocks[0].metadata.evidence);
  assert.deepEqual(mergedReview.metadata.validation, state.blocks[0].metadata.validation);
  assert.deepEqual(mergedReview.metadata.publication, state.blocks[0].metadata.publication);
  assert.deepEqual(mergedReview.content, state.blocks[0].content);

  // A changed block invalidates an outstanding /advance confirmation.
  assert.equal(mergedReview.metadata.advance.selected, false);
  assert.equal(mergedReview.metadata.advance.ready, false);
  assert.equal(mergedReview.metadata.advance.requestedAt, "2026-10-14T12:00:00.000Z");

  // Untouched blocks keep their confirmation.
  assert.equal(merged.blocks[1].metadata.advance.ready, true);
  assert.equal(merged.blocks[1].metadata[JEV_ADVISORY_KEY], undefined);

  validateEditorialState(merged);
});

test("the authority guard rejects any advisory merge that changes an editorial field", () => {
  const state = makeState();
  const tampered = JSON.parse(JSON.stringify(state));
  tampered.blocks[0].metadata.verdict = "Nah";

  assert.throws(
    () => assertEditorialAuthorityPreserved(state, tampered),
    /must not change editorial authority fields/
  );
});

test("applyJevSuggestions rejects a report that references an unknown block", () => {
  const state = makeState();
  const review = state.blocks[0];
  const report = {
    results: [
      { ...interpretJevAnswers(review, answers(), { model: JEV_TYPESAFE_MODEL }), blockId: "ghost" }
    ]
  };
  assert.throws(() => applyJevSuggestions(state, report), /unknown content block ghost/);
});

test("resolveJevEndpoint routes to the Vercel AI Gateway when only the gateway key is set", () => {
  const endpoint = resolveJevEndpoint({ AI_GATEWAY_API_KEY: "gateway-key" });

  assert.equal(endpoint.route, "ai-gateway");
  assert.equal(endpoint.baseUrl, JEV_AI_GATEWAY_BASE_URL);
  assert.equal(endpoint.model, JEV_AI_GATEWAY_MODEL);
  assert.equal(endpoint.endpoint, `${JEV_AI_GATEWAY_BASE_URL}/v1/systemone`);
});

test("resolveJevEndpoint prefers the direct TypeSafe route and honours overrides", () => {
  const direct = resolveJevEndpoint({ TYPESAFE_API_KEY: "typesafe-key", AI_GATEWAY_API_KEY: "gateway-key" });
  assert.equal(direct.route, "typesafe");
  assert.equal(direct.model, JEV_TYPESAFE_MODEL);
  assert.equal(direct.baseUrl, JEV_TYPESAFE_BASE_URL);

  const forced = resolveJevEndpoint({ TYPESAFE_API_KEY: "typesafe-key", JEV_ROUTE: "ai-gateway" });
  assert.equal(forced.route, "ai-gateway");
  assert.equal(forced.model, JEV_AI_GATEWAY_MODEL);

  const custom = resolveJevEndpoint({
    TYPESAFE_API_KEY: "typesafe-key",
    JEV_BASE_URL: "https://gateway.internal/typesafe/",
    JEV_MODEL: "typesafe-ai/jev-custom"
  });
  assert.equal(custom.route, "custom");
  assert.equal(custom.model, "typesafe-ai/jev-custom");
  assert.equal(custom.endpoint, "https://gateway.internal/typesafe/v1/systemone");
});

test("resolveJevEndpoint fails closed without a credential", () => {
  assert.throws(() => resolveJevEndpoint({}), /requires a credential/);
  assert.throws(() => resolveJevEndpoint({ JEV_ROUTE: "telepathy" }), /requires a credential/);
  assert.throws(
    () => resolveJevEndpoint({ TYPESAFE_API_KEY: "k", JEV_ROUTE: "telepathy" }),
    /Unsupported Jev route/
  );
});

test("joinSystemOneEndpoint normalizes the base URL", () => {
  assert.equal(joinSystemOneEndpoint("https://example.invalid/"), "https://example.invalid/v1/systemone");
  assert.throws(() => joinSystemOneEndpoint(""), /base URL is required/);
});

test("callSystemOne retries the documented overload statuses and returns typed answers", async () => {
  const statuses = [429, 529, 200];
  const seen = [];
  const fetchImpl = async (endpoint, init) => {
    seen.push({ endpoint, authorization: init.headers.Authorization });
    const status = statuses.shift();
    if (status !== 200) {
      return { ok: false, status, text: async () => "overloaded" };
    }
    return {
      ok: true,
      status,
      json: async () => ({ model: "typesafe-ai/jev", answers: { evidence_sufficient: { type: "noul", noul: 0.9 } } })
    };
  };

  const response = await callSystemOne({
    endpoint: "https://example.invalid/v1/systemone",
    apiKey: "secret-key",
    body: { model: "typesafe-ai/jev", state: {}, questions: {} },
    fetchImpl,
    sleep: async () => {}
  });

  assert.equal(seen.length, 3);
  assert.equal(seen[0].authorization, "Bearer secret-key");
  assert.equal(response.answers.evidence_sufficient.noul, 0.9);
});

test("callSystemOne surfaces the API error without leaking the credential", async () => {
  const fetchImpl = async () => ({
    ok: false,
    status: 422,
    text: async () => JSON.stringify({ message: "questions.offer_kind.type: expected one of 'noul'", error_type: "invalid_request" })
  });

  await assert.rejects(
    () =>
      callSystemOne({
        endpoint: "https://example.invalid/v1/systemone",
        apiKey: "super-secret",
        body: {},
        fetchImpl,
        sleep: async () => {}
      }),
    (error) => {
      assert.match(error.message, /HTTP 422/);
      assert.match(error.message, /expected one of/);
      assert.equal(error.message.includes("super-secret"), false);
      return true;
    }
  );
});

test("the CLI prints requests offline and skips a deal with no real promotion record", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "asp-jev-"));
  const inputPath = path.join(directory, "state.json");
  await writeFile(inputPath, JSON.stringify(makeState()), "utf8");

  const env = { ...process.env };
  delete env.TYPESAFE_API_KEY;
  delete env.AI_GATEWAY_API_KEY;
  delete env.JEV_API_KEY;
  delete env.JEV_BASE_URL;
  delete env.JEV_MODEL;
  delete env.JEV_ROUTE;

  const result = spawnSync(
    process.execPath,
    ["scripts/jev-review.mjs", "--print-request", "--input", inputPath],
    { cwd: rootDirectory, encoding: "utf8", env }
  );

  assert.equal(result.status, 0, result.stderr);
  const printed = JSON.parse(result.stdout);

  // The synthetic deal references a promotion that does not exist in the
  // repository catalog, so the CLI must skip it rather than invent offer facts.
  assert.deepEqual(printed.map((entry) => entry.blockId), ["review-gold-6"]);
  assert.equal(printed[0].body.questions.evidence_sufficient.type, "noul");
  assert.equal(Object.hasOwn(printed[0].body.questions, "offer_record_consistency"), false);
});

test("the CLI fails with a contextual message when no credential is configured", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "asp-jev-"));
  const inputPath = path.join(directory, "state.json");
  await writeFile(inputPath, JSON.stringify(makeState()), "utf8");

  const env = { ...process.env };
  for (const key of ["TYPESAFE_API_KEY", "AI_GATEWAY_API_KEY", "JEV_API_KEY", "JEV_BASE_URL", "JEV_MODEL", "JEV_ROUTE"]) {
    delete env[key];
  }

  const result = spawnSync(
    process.execPath,
    ["scripts/jev-review.mjs", "--input", inputPath],
    { cwd: rootDirectory, encoding: "utf8", env }
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /requires a credential/);
});
