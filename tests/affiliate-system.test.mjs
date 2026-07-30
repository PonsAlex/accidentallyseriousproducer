import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  AFFILIATE_DISCLOSURE,
  PROMOTION_STATES,
  buildAffiliateContext,
  getPromotionState,
  isIsoDateTimeWithTimezone,
  isSafeHttpsUrl,
  renderAffiliateOffer,
  resolveAffiliateDestination,
  shouldShowAffiliateDisclosure
} from "../assets/affiliate-core.mjs";
import {
  validateAffiliateData
} from "../scripts/affiliate-validation.mjs";
import {
  classifyCandidateValidationPath,
  inspectPublicCandidateBoundary
} from "../scripts/public-boundary.mjs";
import {
  findKnownPortuguesePublicCopy
} from "../scripts/public-affiliate-language.mjs";

const NOW = "2026-07-28T12:00:00-03:00";

const program = {
  id: "plugin-boutique",
  name: "Plugin Boutique",
  group: "Beatport Group",
  homepage: "https://www.pluginboutique.com/",
  affiliateDisclosureRequired: true,
  paidTrafficAllowed: false,
  status: "active"
};

const product = {
  id: "test-product",
  slug: "test-product",
  name: "Produto de teste",
  developer: "Desenvolvedor de teste",
  category: "plugin",
  description: "Fixture usada apenas em testes.",
  image: null,
  status: "active",
  createdAt: "2026-07-20T00:00:00-03:00",
  updatedAt: "2026-07-28T00:00:00-03:00"
};

const affiliateLink = {
  id: "test-product-plugin-boutique",
  productId: product.id,
  programId: program.id,
  destinationUrl: "https://example.com/test-product",
  fallbackUrl: "https://www.pluginboutique.com/",
  allowFallback: false,
  status: "active",
  lastVerifiedAt: "2026-07-28T09:00:00-03:00",
  requiresReview: false
};

const promotion = {
  id: "test-promotion",
  productId: product.id,
  affiliateLinkId: affiliateLink.id,
  headline: "Oferta usada somente em testes",
  promoPrice: 99,
  regularPrice: 149,
  currency: "USD",
  discountPercent: 34,
  couponCode: "TESTE",
  startsAt: "2026-07-20T00:00:00-03:00",
  endsAt: "2026-07-31T23:59:59-03:00",
  source: {
    type: "manual",
    reference: null
  },
  dateConfidence: "high",
  contentConfidence: "high",
  requiresReview: false,
  publicationStatus: "published",
  createdAt: "2026-07-20T00:00:00-03:00",
  updatedAt: "2026-07-28T00:00:00-03:00"
};

function render(overrides = {}, options = {}) {
  return renderAffiliateOffer({
    promotion: { ...promotion, ...overrides },
    product,
    affiliateLink: options.affiliateLink ?? affiliateLink,
    program,
    currentDate: options.currentDate ?? NOW,
    compact: options.compact ?? false,
    showDisclosure: options.showDisclosure ?? false,
    debug: options.debug ?? false
  });
}

test("calcula uma promoção ativa", () => {
  assert.equal(
    getPromotionState(promotion, NOW, affiliateLink),
    PROMOTION_STATES.ACTIVE
  );
});

test("calcula uma promoção futura", () => {
  assert.equal(
    getPromotionState(
      {
        ...promotion,
        startsAt: "2026-08-01T00:00:00-03:00",
        endsAt: "2026-08-10T23:59:59-03:00"
      },
      NOW,
      affiliateLink
    ),
    PROMOTION_STATES.UPCOMING
  );
});

test("calcula uma promoção vencida", () => {
  assert.equal(
    getPromotionState(
      {
        ...promotion,
        startsAt: "2026-07-01T00:00:00-03:00",
        endsAt: "2026-07-27T23:59:59-03:00"
      },
      NOW,
      affiliateLink
    ),
    PROMOTION_STATES.EXPIRED
  );
});

test("exige revisão quando a data final está ausente", () => {
  assert.equal(
    getPromotionState(
      { ...promotion, endsAt: null },
      NOW,
      affiliateLink
    ),
    PROMOTION_STATES.REVIEW_REQUIRED
  );
});

test("exige revisão quando a data não tem fuso", () => {
  assert.equal(
    getPromotionState(
      {
        ...promotion,
        endsAt: "2026-07-31T23:59:59"
      },
      NOW,
      affiliateLink
    ),
    PROMOTION_STATES.REVIEW_REQUIRED
  );
});

test("rejeita data de calendário impossível", () => {
  assert.equal(
    isIsoDateTimeWithTimezone("2026-02-31T23:59:59-03:00"),
    false
  );
});

test("marca a oferta como indisponível quando o link está inativo", () => {
  assert.equal(
    getPromotionState(
      promotion,
      NOW,
      { ...affiliateLink, status: "inactive" }
    ),
    PROMOTION_STATES.UNAVAILABLE
  );
});

test("permite oferta ativa sem preço confirmado", () => {
  const html = render({
    promoPrice: null,
    regularPrice: null,
    currency: null,
    discountPercent: null
  });

  assert.match(html, /View deal/);
  assert.doesNotMatch(html, /offer-pricing/);
});

test("não publica oferta aguardando revisão e sinaliza no modo de desenvolvimento", () => {
  const reviewPromotion = {
    ...promotion,
    requiresReview: true
  };

  assert.equal(
    renderAffiliateOffer({
      promotion: reviewPromotion,
      product,
      affiliateLink,
      program,
      currentDate: NOW
    }),
    ""
  );

  const debugHtml = renderAffiliateOffer({
    promotion: reviewPromotion,
    product,
    affiliateLink,
    program,
    currentDate: NOW,
    debug: true
  });

  assert.match(
    debugHtml,
    /data-promotion-state="REVIEW_REQUIRED"/
  );
  assert.match(debugHtml, />NEEDS REVIEW</);
});

test("mostra o selo EXPIRED em uma oferta vencida", () => {
  const html = render(
    {
      startsAt: "2026-07-01T00:00:00-03:00",
      endsAt: "2026-07-27T23:59:59-03:00"
    }
  );

  assert.match(html, />EXPIRED</);
});

test("oferta vencida usa View current price e oculta o preço promocional antigo", () => {
  const html = render({
    startsAt: "2026-07-01T00:00:00-03:00",
    endsAt: "2026-07-27T23:59:59-03:00"
  });

  assert.match(html, /View current price/);
  assert.doesNotMatch(html, /offer-pricing/);
  assert.doesNotMatch(html, /Buy for/);
});

test("oferta ativa usa o botão View deal", () => {
  const html = render();

  assert.match(html, /View deal/);
  assert.match(html, /rel="sponsored noopener noreferrer"/);
});

test("oferta futura não apresenta botão de compra", () => {
  const html = render({
    startsAt: "2026-08-01T00:00:00-03:00",
    endsAt: "2026-08-10T23:59:59-03:00"
  });

  assert.match(html, /UPCOMING/);
  assert.doesNotMatch(html, /offer-button/);
});

test("rejeita esquemas e URLs afiliadas inseguras", () => {
  assert.equal(isSafeHttpsUrl("javascript:alert(1)"), false);
  assert.equal(isSafeHttpsUrl("data:text/html,hello"), false);
  assert.equal(isSafeHttpsUrl("http://example.com/product"), false);
  assert.equal(isSafeHttpsUrl("https://example.com/product"), true);
});

test("só usa fallback quando há permissão explícita", () => {
  const withoutPermission = {
    ...affiliateLink,
    destinationUrl: null,
    allowFallback: false
  };
  const withPermission = {
    ...withoutPermission,
    allowFallback: true
  };

  assert.equal(resolveAffiliateDestination(withoutPermission), null);
  assert.equal(
    resolveAffiliateDestination(withPermission),
    affiliateLink.fallbackUrl
  );
});

test("validação rejeita registro publicado com placeholder ativo", () => {
  const placeholderLink = {
    ...affiliateLink,
    destinationUrl: "AFFILIATE_URL_PLACEHOLDER"
  };
  const report = validateAffiliateData(
    {
      affiliatePrograms: [program],
      affiliateLinks: [placeholderLink],
      products: [product],
      promotions: [promotion]
    },
    { now: new Date(NOW) }
  );

  assert.ok(
    report.errors.some(
      (issue) => issue.code === "ACTIVE_PLACEHOLDER_URL"
    )
  );
});

test("exibe disclosure junto de conteúdo afiliado", () => {
  const html = render({}, { showDisclosure: true });

  assert.match(html, new RegExp(AFFILIATE_DISCLOSURE.short));
});

test("escapa conteúdo textual vindo dos registros centrais", () => {
  const html = renderAffiliateOffer({
    promotion: {
      ...promotion,
      headline: "</article><script>alert(1)</script>"
    },
    product: {
      ...product,
      name: "<img src=x onerror=alert(1)>"
    },
    affiliateLink,
    program,
    currentDate: NOW
  });

  assert.doesNotMatch(html, /<script>|<img/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;img/);
});

test("não exibe disclosure em conteúdo sem link afiliado", () => {
  const html = render({}, { showDisclosure: false });
  assert.doesNotMatch(html, /This is an affiliate link/);
  assert.equal(shouldShowAffiliateDisclosure([]), false);
});

test("aceita copy pública afiliada em inglês e ignora comentário técnico", () => {
  const issues = findKnownPortuguesePublicCopy([
    {
      file: "assets/go-redirect.mjs",
      source: [
        "// Oferta is a technical note, not visitor copy.",
        'status.textContent = "Offer unavailable";'
      ].join("\n")
    }
  ]);

  assert.deepEqual(issues, []);
});

test("rejeita copy pública afiliada conhecida em português", () => {
  const issues = findKnownPortuguesePublicCopy([
    {
      file: "deals/index.html",
      source: "<h1>Oferta indisponível</h1>"
    }
  ]);

  assert.equal(issues.length, 1);
  assert.equal(issues[0].file, "deals/index.html");
  assert.equal(issues[0].line, 1);
  assert.equal(issues[0].term, "indisponível");
});

test("identifica disclosure necessário na coleção de ofertas", () => {
  const data = {
    affiliatePrograms: [program],
    affiliateLinks: [affiliateLink],
    products: [product],
    promotions: [promotion]
  };
  const context = buildAffiliateContext(
    promotion,
    data,
    new Date(NOW)
  );

  assert.equal(shouldShowAffiliateDisclosure([context]), true);
});

test("permite somente o exemplo anonimizado dentro do repositório público", () => {
  const publicRoot = path.resolve("asp-public-root");
  const examplePath = path.join(
    publicRoot,
    "data",
    "inbox",
    "promotion-candidate.example.json"
  );
  const realInboxPath = path.join(
    publicRoot,
    "data",
    "inbox",
    "real-candidate.json"
  );
  const mistakenRuntimePath = path.join(
    publicRoot,
    "data",
    "runtime",
    "asp_affiliate_candidates",
    "real-candidate.json"
  );
  const privateOdysseusPath = path.resolve(
    publicRoot,
    "..",
    "odysseus-private",
    "real-candidate.json"
  );

  assert.equal(
    classifyCandidateValidationPath(publicRoot, examplePath),
    "anonymized-example"
  );
  assert.equal(
    classifyCandidateValidationPath(publicRoot, realInboxPath),
    "forbidden-public-repository"
  );
  assert.equal(
    classifyCandidateValidationPath(publicRoot, mistakenRuntimePath),
    "forbidden-public-repository"
  );
  assert.equal(
    classifyCandidateValidationPath(publicRoot, privateOdysseusPath),
    "private-storage"
  );
});

test("detecta candidato privado colocado dentro do ASP", async (context) => {
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), "asp-public-boundary-")
  );
  context.after(() => rm(temporaryRoot, {
    recursive: true,
    force: true
  }));

  const inboxDirectory = path.join(
    temporaryRoot,
    "data",
    "inbox"
  );
  const runtimeDirectory = path.join(
    temporaryRoot,
    "data",
    "runtime",
    "asp_affiliate_candidates"
  );
  await Promise.all([
    mkdir(inboxDirectory, { recursive: true }),
    mkdir(runtimeDirectory, { recursive: true })
  ]);
  await Promise.all([
    writeFile(
      path.join(inboxDirectory, "promotion-candidate.example.json"),
      "{}"
    ),
    writeFile(
      path.join(inboxDirectory, "real-candidate.json"),
      "{}"
    ),
    writeFile(
      path.join(runtimeDirectory, "real-candidate.json"),
      "{}"
    )
  ]);

  const violations = await inspectPublicCandidateBoundary(
    temporaryRoot
  );
  assert.equal(violations.length, 2);
  assert.ok(
    violations.some((violation) =>
      /data\/inbox\/real-candidate\.json/.test(violation)
    )
  );
  assert.ok(
    violations.some((violation) =>
      /data\/runtime/.test(violation)
    )
  );
});

test("a rota /go usa um destino de proxy fora do próprio padrão", async () => {
  const redirects = await readFile(
    new URL("../_redirects", import.meta.url),
    "utf8"
  );
  const goRule = redirects
    .split(/\r?\n/)
    .find((line) => line.startsWith("/go/* "));

  assert.equal(goRule, "/go/* /affiliate-redirect/ 200");
  assert.doesNotMatch(goRule, /\/go\/\S+\s+200$/);
});

test("a CSP permite o beacon oficial sem liberar scripts inseguros", async () => {
  const headers = await readFile(
    new URL("../_headers", import.meta.url),
    "utf8"
  );

  assert.match(
    headers,
    /script-src 'self' https:\/\/static\.cloudflareinsights\.com/
  );
  assert.match(
    headers,
    /connect-src 'self' https:\/\/cloudflareinsights\.com/
  );
  assert.doesNotMatch(headers, /'unsafe-inline'|'unsafe-eval'/);
});
