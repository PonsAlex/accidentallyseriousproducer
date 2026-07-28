import {
  AFFILIATE_ID_PATTERN,
  isIsoDateTimeWithTimezone,
  isSafeHttpsUrl
} from "../assets/affiliate-core.mjs";
import {
  CONFIDENCE_VALUES,
  PRODUCT_CATEGORIES
} from "./affiliate-validation.mjs";

const AMBIGUOUS_DATE_LANGUAGE =
  /\b(limited time|this weekend|ends soon|ending soon|por tempo limitado|neste fim de semana|termina em breve)\b/i;

const FORBIDDEN_KEY =
  /^(?:token|accessToken|refreshToken|password|secret|cookie|authorization|emailBody|body|headers)$/i;

function createReport() {
  return {
    errors: [],
    warnings: []
  };
}

function add(report, severity, code, location, message) {
  report[severity].push({ code, location, message });
}

function findForbiddenKeys(value, location = "$", results = []) {
  if (!value || typeof value !== "object") {
    return results;
  }

  for (const [key, child] of Object.entries(value)) {
    const childLocation = `${location}.${key}`;
    if (FORBIDDEN_KEY.test(key)) {
      results.push(childLocation);
    }
    findForbiddenKeys(child, childLocation, results);
  }

  return results;
}

function validateOptionalTimestamp(report, value, location) {
  if (value === null || value === undefined) {
    return;
  }

  if (!isIsoDateTimeWithTimezone(value)) {
    add(
      report,
      "errors",
      "INVALID_CANDIDATE_TIMESTAMP",
      location,
      "Use ISO 8601 com horário e fuso explícito."
    );
  }
}

export function validatePromotionCandidate(
  candidate,
  { knownProgramIds = [] } = {}
) {
  const report = createReport();

  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    add(
      report,
      "errors",
      "INVALID_CANDIDATE",
      "$",
      "O candidato deve ser um objeto JSON."
    );
    return report;
  }

  if (candidate.schemaVersion !== "1.0") {
    add(
      report,
      "errors",
      "UNSUPPORTED_SCHEMA_VERSION",
      "$.schemaVersion",
      "Esta versão aceita somente schemaVersion 1.0."
    );
  }

  if (
    typeof candidate.candidateId !== "string" ||
    !AFFILIATE_ID_PATTERN.test(candidate.candidateId)
  ) {
    add(
      report,
      "errors",
      "INVALID_CANDIDATE_ID",
      "$.candidateId",
      "candidateId deve usar letras minúsculas, números e hífens."
    );
  }

  if (candidate.status !== "candidate") {
    add(
      report,
      "errors",
      "INVALID_CANDIDATE_STATUS",
      "$.status",
      "Dados recebidos só podem entrar com status candidate."
    );
  }

  if (candidate.requiresReview !== true) {
    add(
      report,
      "errors",
      "CANDIDATE_REVIEW_BYPASS",
      "$.requiresReview",
      "Todo candidato deve entrar com requiresReview=true."
    );
  }

  for (const location of findForbiddenKeys(candidate)) {
    add(
      report,
      "errors",
      "FORBIDDEN_PRIVATE_FIELD",
      location,
      "Tokens, segredos, corpos de email e cabeçalhos privados são proibidos."
    );
  }

  const source = candidate.source;
  if (!source || typeof source !== "object") {
    add(
      report,
      "errors",
      "MISSING_CANDIDATE_SOURCE",
      "$.source",
      "A origem do candidato é obrigatória."
    );
  } else {
    validateOptionalTimestamp(
      report,
      source.receivedAt,
      "$.source.receivedAt"
    );

    if (
      typeof source.subject === "string" &&
      AMBIGUOUS_DATE_LANGUAGE.test(source.subject)
    ) {
      add(
        report,
        "warnings",
        "AMBIGUOUS_DATE_LANGUAGE",
        "$.source.subject",
        "A linguagem temporal é ambígua e exige confirmação humana."
      );
    }
  }

  const product = candidate.product;
  if (
    product?.category !== null &&
    product?.category !== undefined &&
    !PRODUCT_CATEGORIES.includes(product.category)
  ) {
    add(
      report,
      "errors",
      "INVALID_CANDIDATE_CATEGORY",
      "$.product.category",
      `Categoria inválida: ${product.category}.`
    );
  }

  const programId = candidate.merchant?.programId;
  if (
    programId !== null &&
    programId !== undefined &&
    knownProgramIds.length > 0 &&
    !knownProgramIds.includes(programId)
  ) {
    add(
      report,
      "errors",
      "UNKNOWN_CANDIDATE_PROGRAM",
      "$.merchant.programId",
      `Programa inexistente: ${programId}.`
    );
  }

  const offer = candidate.offer ?? {};
  validateOptionalTimestamp(
    report,
    offer.startsAt,
    "$.offer.startsAt"
  );
  validateOptionalTimestamp(report, offer.endsAt, "$.offer.endsAt");

  if (offer.endsAt === null || offer.endsAt === undefined) {
    add(
      report,
      "warnings",
      "MISSING_CANDIDATE_END",
      "$.offer.endsAt",
      "A data final deve ser confirmada antes de criar uma promoção."
    );
  }

  const hasPrice =
    offer.promoPrice !== null &&
    offer.promoPrice !== undefined ||
    offer.regularPrice !== null &&
    offer.regularPrice !== undefined;
  if (
    hasPrice &&
    (typeof offer.currency !== "string" ||
      !/^[A-Z]{3}$/.test(offer.currency))
  ) {
    add(
      report,
      "warnings",
      "CANDIDATE_PRICE_WITHOUT_CURRENCY",
      "$.offer.currency",
      "Confirme a moeda antes da aprovação."
    );
  }

  for (const field of ["product", "price", "dates", "link"]) {
    const value = candidate.confidence?.[field];
    if (!CONFIDENCE_VALUES.includes(value)) {
      add(
        report,
        "errors",
        "INVALID_CANDIDATE_CONFIDENCE",
        `$.confidence.${field}`,
        `Confiança inválida: ${value}.`
      );
    }
  }

  for (const field of ["sourceUrl", "affiliateUrl"]) {
    const value = candidate.links?.[field];
    if (
      value !== null &&
      value !== undefined &&
      !isSafeHttpsUrl(value)
    ) {
      add(
        report,
        "errors",
        "UNSAFE_CANDIDATE_URL",
        `$.links.${field}`,
        "URLs candidatas devem usar HTTPS e não podem conter credenciais."
      );
    }
  }

  if (candidate.links?.affiliateUrl) {
    add(
      report,
      "warnings",
      "UNVERIFIED_AFFILIATE_URL",
      "$.links.affiliateUrl",
      "Um link encontrado na origem não é afiliado até validação humana."
    );
  }

  if (!Array.isArray(candidate.restrictions)) {
    add(
      report,
      "errors",
      "INVALID_RESTRICTIONS",
      "$.restrictions",
      "restrictions deve ser um array."
    );
  }

  return report;
}

export function formatCandidateReport(report) {
  const lines = [
    ...report.errors.map(
      (issue) =>
        `ERROR ${issue.code} ${issue.location}: ${issue.message}`
    ),
    ...report.warnings.map(
      (issue) =>
        `WARN ${issue.code} ${issue.location}: ${issue.message}`
    )
  ];

  lines.push(
    `${report.errors.length} erro(s) crítico(s), ${report.warnings.length} aviso(s).`
  );
  lines.push(
    "Nenhum dado foi publicado; o candidato permanece aguardando revisão humana."
  );

  return lines.join("\n");
}
