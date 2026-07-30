import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  AFFILIATE_ID_PATTERN,
  PUBLICATION_STATUSES,
  isAffiliateLinkUsable,
  isIsoDateTimeWithTimezone,
  isPlaceholderUrl,
  isSafeHttpsUrl,
  parseIsoDateTime
} from "../assets/affiliate-core.mjs";

export const PRODUCT_CATEGORIES = Object.freeze([
  "plugin",
  "bundle",
  "sample-pack",
  "preset-pack",
  "subscription",
  "dj-service",
  "music-download",
  "course",
  "other"
]);

export const CONFIDENCE_VALUES = Object.freeze([
  "high",
  "medium",
  "low",
  "unknown"
]);

export const PUBLICATION_STATUS_VALUES = Object.freeze([
  "draft",
  "approved",
  "published",
  "archived"
]);

const DATA_FILES = Object.freeze({
  affiliatePrograms: "affiliate-programs.json",
  affiliateLinks: "affiliate-links.json",
  products: "products.json",
  promotions: "promotions.json"
});

function createReport() {
  return {
    errors: [],
    warnings: []
  };
}

function addIssue(report, severity, code, location, message) {
  report[severity].push({
    code,
    location,
    message
  });
}

function error(report, code, location, message) {
  addIssue(report, "errors", code, location, message);
}

function warning(report, code, location, message) {
  addIssue(report, "warnings", code, location, message);
}

function validateCollection(report, collection, name) {
  if (!Array.isArray(collection)) {
    error(
      report,
      "INVALID_COLLECTION",
      name,
      `${name} deve conter um array JSON.`
    );
    return false;
  }

  return true;
}

function validateIds(report, collection, name) {
  const seen = new Set();

  collection.forEach((record, index) => {
    const location = `${name}[${index}].id`;
    if (
      typeof record?.id !== "string" ||
      !AFFILIATE_ID_PATTERN.test(record.id)
    ) {
      error(
        report,
        "INVALID_ID",
        location,
        "O ID deve usar letras minúsculas, números e hífens."
      );
      return;
    }

    if (seen.has(record.id)) {
      error(
        report,
        "DUPLICATE_ID",
        location,
        `ID duplicado: ${record.id}.`
      );
    }
    seen.add(record.id);
  });
}

function validateTimestamp(
  report,
  value,
  location,
  { required = false, publicRecord = false } = {}
) {
  if (value === null || value === undefined || value === "") {
    if (required) {
      const add = publicRecord ? error : warning;
      add(
        report,
        "MISSING_TIMESTAMP",
        location,
        "A data é obrigatória e deve incluir horário e fuso."
      );
    }
    return null;
  }

  if (!isIsoDateTimeWithTimezone(value)) {
    const add = publicRecord ? error : warning;
    add(
      report,
      "INVALID_TIMESTAMP",
      location,
      "Use ISO 8601 com horário e Z ou offset explícito."
    );
    return null;
  }

  return parseIsoDateTime(value);
}

function validatePrice(
  report,
  value,
  location,
  { publicRecord = false } = {}
) {
  if (value === null || value === undefined) {
    return;
  }

  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    const add = publicRecord ? error : warning;
    add(
      report,
      "INVALID_PRICE",
      location,
      "O preço deve ser um número não negativo ou null."
    );
  }
}

function validatePrograms(report, programs) {
  const allowedStatuses = new Set(["active", "inactive"]);

  programs.forEach((program, index) => {
    const location = `affiliatePrograms[${index}]`;
    if (typeof program.name !== "string" || program.name.trim() === "") {
      error(report, "MISSING_PROGRAM_NAME", `${location}.name`, "Nome obrigatório.");
    }

    if (!isSafeHttpsUrl(program.homepage)) {
      error(
        report,
        "UNSAFE_PROGRAM_URL",
        `${location}.homepage`,
        "A homepage deve usar HTTPS e não pode conter credenciais."
      );
    }

    if (!allowedStatuses.has(program.status)) {
      error(
        report,
        "INVALID_PROGRAM_STATUS",
        `${location}.status`,
        "Status permitido: active ou inactive."
      );
    }

    if (typeof program.affiliateDisclosureRequired !== "boolean") {
      error(
        report,
        "INVALID_DISCLOSURE_FLAG",
        `${location}.affiliateDisclosureRequired`,
        "affiliateDisclosureRequired deve ser booleano."
      );
    }

    if (typeof program.paidTrafficAllowed !== "boolean") {
      error(
        report,
        "INVALID_PAID_TRAFFIC_FLAG",
        `${location}.paidTrafficAllowed`,
        "paidTrafficAllowed deve ser booleano."
      );
    }
  });
}

function validateProducts(report, products) {
  const slugs = new Set();
  const allowedStatuses = new Set(["draft", "active", "inactive", "archived"]);

  products.forEach((product, index) => {
    const location = `products[${index}]`;

    if (
      typeof product.slug !== "string" ||
      !AFFILIATE_ID_PATTERN.test(product.slug)
    ) {
      error(
        report,
        "INVALID_PRODUCT_SLUG",
        `${location}.slug`,
        "O slug deve usar letras minúsculas, números e hífens."
      );
    } else if (slugs.has(product.slug)) {
      error(
        report,
        "DUPLICATE_PRODUCT_SLUG",
        `${location}.slug`,
        `Slug duplicado: ${product.slug}.`
      );
    } else {
      slugs.add(product.slug);
    }

    if (typeof product.name !== "string" || product.name.trim() === "") {
      error(report, "MISSING_PRODUCT_NAME", `${location}.name`, "Nome obrigatório.");
    }

    if (!PRODUCT_CATEGORIES.includes(product.category)) {
      error(
        report,
        "INVALID_PRODUCT_CATEGORY",
        `${location}.category`,
        `Categoria inválida: ${product.category}.`
      );
    }

    if (!allowedStatuses.has(product.status)) {
      error(
        report,
        "INVALID_PRODUCT_STATUS",
        `${location}.status`,
        `Status inválido: ${product.status}.`
      );
    }

    validateTimestamp(report, product.createdAt, `${location}.createdAt`, {
      required: true
    });
    validateTimestamp(report, product.updatedAt, `${location}.updatedAt`, {
      required: true
    });
  });
}

function validateLinks(report, links, productIds, programIds) {
  const allowedStatuses = new Set([
    "draft",
    "active",
    "inactive",
    "broken",
    "archived"
  ]);

  links.forEach((link, index) => {
    const location = `affiliateLinks[${index}]`;
    const active = link.status === "active";

    if (!productIds.has(link.productId)) {
      error(
        report,
        "UNKNOWN_LINK_PRODUCT",
        `${location}.productId`,
        `Produto inexistente: ${link.productId}.`
      );
    }

    if (!programIds.has(link.programId)) {
      error(
        report,
        "UNKNOWN_LINK_PROGRAM",
        `${location}.programId`,
        `Programa inexistente: ${link.programId}.`
      );
    }

    if (!allowedStatuses.has(link.status)) {
      error(
        report,
        "INVALID_LINK_STATUS",
        `${location}.status`,
        `Status inválido: ${link.status}.`
      );
    }

    if (typeof link.requiresReview !== "boolean") {
      error(
        report,
        "INVALID_LINK_REVIEW_FLAG",
        `${location}.requiresReview`,
        "requiresReview deve ser booleano."
      );
    }

    if (isPlaceholderUrl(link.destinationUrl) && active) {
      error(
        report,
        "ACTIVE_PLACEHOLDER_URL",
        `${location}.destinationUrl`,
        "Um link ativo não pode usar placeholder."
      );
    } else if (
      link.destinationUrl !== null &&
      link.destinationUrl !== undefined &&
      link.destinationUrl !== "" &&
      !isSafeHttpsUrl(link.destinationUrl)
    ) {
      const add = active ? error : warning;
      add(
        report,
        "UNSAFE_DESTINATION_URL",
        `${location}.destinationUrl`,
        "O destino deve usar HTTPS, sem credenciais e sem placeholder."
      );
    }

    if (
      link.fallbackUrl !== null &&
      link.fallbackUrl !== undefined &&
      link.fallbackUrl !== "" &&
      !isSafeHttpsUrl(link.fallbackUrl)
    ) {
      const add = link.allowFallback === true ? error : warning;
      add(
        report,
        "UNSAFE_FALLBACK_URL",
        `${location}.fallbackUrl`,
        "O fallback deve usar HTTPS, sem credenciais e sem placeholder."
      );
    }

    if (
      active &&
      !isSafeHttpsUrl(link.destinationUrl) &&
      !(
        link.allowFallback === true &&
        isSafeHttpsUrl(link.fallbackUrl)
      )
    ) {
      error(
        report,
        "ACTIVE_LINK_WITHOUT_DESTINATION",
        location,
        "Um link ativo precisa de destino HTTPS ou fallback explicitamente permitido."
      );
    }

    if (active && link.requiresReview === true) {
      warning(
        report,
        "ACTIVE_LINK_REQUIRES_REVIEW",
        location,
        "O link não será resolvido enquanto requiresReview for true."
      );
    }

    validateTimestamp(
      report,
      link.lastVerifiedAt,
      `${location}.lastVerifiedAt`
    );

    if (active && link.lastVerifiedAt === null) {
      warning(
        report,
        "UNVERIFIED_ACTIVE_LINK",
        `${location}.lastVerifiedAt`,
        "Confirme o destino antes de usar este link em uma promoção pública."
      );
    }
  });
}

function validatePromotions(
  report,
  promotions,
  productsById,
  linksById,
  now
) {
  promotions.forEach((promotion, index) => {
    const location = `promotions[${index}]`;
    const publicRecord = PUBLICATION_STATUSES.includes(
      promotion.publicationStatus
    );

    if (!productsById.has(promotion.productId)) {
      error(
        report,
        "UNKNOWN_PROMOTION_PRODUCT",
        `${location}.productId`,
        `Produto inexistente: ${promotion.productId}.`
      );
    }

    const affiliateLink = linksById.get(promotion.affiliateLinkId);
    if (!affiliateLink) {
      error(
        report,
        "UNKNOWN_PROMOTION_LINK",
        `${location}.affiliateLinkId`,
        `Link afiliado inexistente: ${promotion.affiliateLinkId}.`
      );
    }

    if (!PUBLICATION_STATUS_VALUES.includes(promotion.publicationStatus)) {
      error(
        report,
        "INVALID_PUBLICATION_STATUS",
        `${location}.publicationStatus`,
        `Status inválido: ${promotion.publicationStatus}.`
      );
    }

    if (typeof promotion.requiresReview !== "boolean") {
      error(
        report,
        "INVALID_PROMOTION_REVIEW_FLAG",
        `${location}.requiresReview`,
        "requiresReview deve ser booleano."
      );
    }

    if (publicRecord && promotion.requiresReview === true) {
      error(
        report,
        "PUBLIC_PROMOTION_REQUIRES_REVIEW",
        location,
        "Uma promoção aprovada/publicada não pode manter requiresReview=true."
      );
    }

    const startsAt = validateTimestamp(
      report,
      promotion.startsAt,
      `${location}.startsAt`,
      { publicRecord }
    );
    const endsAt = validateTimestamp(
      report,
      promotion.endsAt,
      `${location}.endsAt`,
      { required: true, publicRecord }
    );

    if (startsAt && endsAt && endsAt.getTime() < startsAt.getTime()) {
      error(
        report,
        "END_BEFORE_START",
        `${location}.endsAt`,
        "endsAt não pode ser anterior a startsAt."
      );
    }

    validatePrice(
      report,
      promotion.promoPrice,
      `${location}.promoPrice`,
      { publicRecord }
    );
    validatePrice(
      report,
      promotion.regularPrice,
      `${location}.regularPrice`,
      { publicRecord }
    );

    const hasPrice =
      promotion.promoPrice !== null &&
      promotion.promoPrice !== undefined ||
      promotion.regularPrice !== null &&
      promotion.regularPrice !== undefined;

    if (
      hasPrice &&
      (typeof promotion.currency !== "string" ||
        !/^[A-Z]{3}$/.test(promotion.currency))
    ) {
      const add = publicRecord ? error : warning;
      add(
        report,
        "MISSING_OR_INVALID_CURRENCY",
        `${location}.currency`,
        "Informe uma moeda ISO 4217 de três letras quando houver preço."
      );
    }

    if (
      typeof promotion.promoPrice === "number" &&
      typeof promotion.regularPrice === "number" &&
      promotion.promoPrice > promotion.regularPrice
    ) {
      const add = publicRecord ? error : warning;
      add(
        report,
        "PROMO_PRICE_ABOVE_REGULAR",
        `${location}.promoPrice`,
        "O preço promocional não pode superar o preço regular."
      );
    }

    if (
      promotion.discountPercent !== null &&
      promotion.discountPercent !== undefined &&
      (
        typeof promotion.discountPercent !== "number" ||
        !Number.isFinite(promotion.discountPercent) ||
        promotion.discountPercent < 0 ||
        promotion.discountPercent > 100
      )
    ) {
      const add = publicRecord ? error : warning;
      add(
        report,
        "INVALID_DISCOUNT",
        `${location}.discountPercent`,
        "O desconto deve estar entre 0 e 100 ou ser null."
      );
    }

    for (const field of ["dateConfidence", "contentConfidence"]) {
      if (!CONFIDENCE_VALUES.includes(promotion[field])) {
        error(
          report,
          "INVALID_CONFIDENCE",
          `${location}.${field}`,
          `Confiança inválida: ${promotion[field]}.`
        );
      } else if (publicRecord && promotion[field] !== "high") {
        warning(
          report,
          "PUBLIC_LOW_CONFIDENCE",
          `${location}.${field}`,
          "A publicação pressupõe que uma pessoa revisou esta ambiguidade."
        );
      }
    }

    validateTimestamp(report, promotion.createdAt, `${location}.createdAt`, {
      required: true,
      publicRecord
    });
    validateTimestamp(report, promotion.updatedAt, `${location}.updatedAt`, {
      required: true,
      publicRecord
    });

    const startsBeforeNow =
      !startsAt || startsAt.getTime() <= now.getTime();
    const endsAfterNow =
      endsAt && endsAt.getTime() >= now.getTime();
    const currentlyActive = startsBeforeNow && endsAfterNow;

    if (
      publicRecord &&
      currentlyActive &&
      (!affiliateLink || !isAffiliateLinkUsable(affiliateLink))
    ) {
      error(
        report,
        "PUBLIC_ACTIVE_PROMOTION_WITHOUT_LINK",
        `${location}.affiliateLinkId`,
        "Uma promoção pública ativa precisa de um link seguro e ativo."
      );
    }
  });
}

export function validateAffiliateData(data, { now = new Date() } = {}) {
  const report = createReport();
  const normalized = {
    affiliatePrograms: data?.affiliatePrograms,
    affiliateLinks: data?.affiliateLinks,
    products: data?.products,
    promotions: data?.promotions
  };

  const validCollections = Object.entries(normalized).every(
    ([name, collection]) => validateCollection(report, collection, name)
  );

  if (!validCollections) {
    return report;
  }

  for (const [name, collection] of Object.entries(normalized)) {
    validateIds(report, collection, name);
  }

  validatePrograms(report, normalized.affiliatePrograms);
  validateProducts(report, normalized.products);

  const productIds = new Set(
    normalized.products.map((product) => product.id)
  );
  const programIds = new Set(
    normalized.affiliatePrograms.map((program) => program.id)
  );
  validateLinks(
    report,
    normalized.affiliateLinks,
    productIds,
    programIds
  );

  validatePromotions(
    report,
    normalized.promotions,
    new Map(
      normalized.products.map((product) => [product.id, product])
    ),
    new Map(
      normalized.affiliateLinks.map((link) => [link.id, link])
    ),
    now instanceof Date ? now : new Date(now)
  );

  return report;
}

export async function readAffiliateData(rootDirectory) {
  const entries = await Promise.all(
    Object.entries(DATA_FILES).map(async ([key, filename]) => {
      const filePath = path.join(rootDirectory, "data", filename);
      const source = await readFile(filePath, "utf8");
      return [key, JSON.parse(source)];
    })
  );

  return Object.fromEntries(entries);
}

export function formatValidationReport(report) {
  const lines = [];

  for (const issue of report.errors) {
    lines.push(
      `ERROR ${issue.code} ${issue.location}: ${issue.message}`
    );
  }

  for (const issue of report.warnings) {
    lines.push(
      `WARN ${issue.code} ${issue.location}: ${issue.message}`
    );
  }

  lines.push(
    `${report.errors.length} erro(s) crítico(s), ${report.warnings.length} aviso(s).`
  );

  return lines.join("\n");
}
