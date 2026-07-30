export const PROMOTION_STATES = Object.freeze({
  UPCOMING: "UPCOMING",
  ACTIVE: "ACTIVE",
  EXPIRED: "EXPIRED",
  REVIEW_REQUIRED: "REVIEW_REQUIRED",
  UNAVAILABLE: "UNAVAILABLE"
});

export const PUBLICATION_STATUSES = Object.freeze([
  "approved",
  "published"
]);

export const AFFILIATE_DISCLOSURE = Object.freeze({
  full:
    "Transparência: este conteúdo pode conter links afiliados. O ASP pode receber uma comissão caso você compre por eles, sem custo adicional para você. Isso não interfere em nossa avaliação do produto.",
  short:
    "Este é um link afiliado. O ASP pode receber uma comissão, sem custo adicional para você."
});

export const AFFILIATE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const ISO_WITH_TIMEZONE_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:\d{2})$/;

const PLACEHOLDER_PATTERN =
  /(?:AFFILIATE_URL_PLACEHOLDER|YOUR[_-]?(?:AFFILIATE[_-]?)?URL|REPLACE[_-]?ME|EXAMPLE[_-]?AFFILIATE)/i;

const STATE_PRIORITY = Object.freeze({
  [PROMOTION_STATES.ACTIVE]: 0,
  [PROMOTION_STATES.UPCOMING]: 1,
  [PROMOTION_STATES.EXPIRED]: 2,
  [PROMOTION_STATES.UNAVAILABLE]: 3,
  [PROMOTION_STATES.REVIEW_REQUIRED]: 4
});

export function isIsoDateTimeWithTimezone(value) {
  if (typeof value !== "string") {
    return false;
  }

  const match = ISO_WITH_TIMEZONE_PATTERN.exec(value);
  if (!match) {
    return false;
  }

  const [, year, month, day, hour, minute, second = "00", , offset] = match;
  const numericParts = [
    Number(year),
    Number(month),
    Number(day),
    Number(hour),
    Number(minute),
    Number(second)
  ];

  if (
    numericParts.some((part) => !Number.isInteger(part)) ||
    Number(month) < 1 ||
    Number(month) > 12 ||
    Number(day) < 1 ||
    Number(hour) > 23 ||
    Number(minute) > 59 ||
    Number(second) > 59
  ) {
    return false;
  }

  const daysInMonth = new Date(
    Date.UTC(Number(year), Number(month), 0)
  ).getUTCDate();
  if (Number(day) > daysInMonth) {
    return false;
  }

  if (offset !== "Z") {
    const [offsetHour, offsetMinute] = offset.slice(1).split(":").map(Number);
    if (
      offsetHour > 23 ||
      offsetMinute > 59 ||
      (offsetHour === 23 && offsetMinute > 59)
    ) {
      return false;
    }
  }

  return Number.isFinite(Date.parse(value));
}

export function parseIsoDateTime(value) {
  if (!isIsoDateTimeWithTimezone(value)) {
    return null;
  }

  return new Date(value);
}

export function isPlaceholderUrl(value) {
  return typeof value === "string" && PLACEHOLDER_PATTERN.test(value.trim());
}

export function isSafeHttpsUrl(value) {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    isPlaceholderUrl(value)
  ) {
    return false;
  }

  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname.length > 0 &&
      url.username === "" &&
      url.password === ""
    );
  } catch {
    return false;
  }
}

export function resolveAffiliateDestination(link) {
  if (
    !link ||
    link.status !== "active" ||
    link.requiresReview === true
  ) {
    return null;
  }

  if (isSafeHttpsUrl(link.destinationUrl)) {
    return link.destinationUrl;
  }

  if (
    link.allowFallback === true &&
    isSafeHttpsUrl(link.fallbackUrl)
  ) {
    return link.fallbackUrl;
  }

  return null;
}

export function isAffiliateLinkUsable(link) {
  return resolveAffiliateDestination(link) !== null;
}

function parseCurrentDate(currentDate) {
  if (currentDate instanceof Date) {
    return Number.isFinite(currentDate.getTime()) ? currentDate : null;
  }

  if (typeof currentDate === "number") {
    const parsed = new Date(currentDate);
    return Number.isFinite(parsed.getTime()) ? parsed : null;
  }

  return parseIsoDateTime(currentDate);
}

export function getPromotionState(
  promotion,
  currentDate = new Date(),
  affiliateLink = null
) {
  if (!promotion || promotion.requiresReview === true) {
    return PROMOTION_STATES.REVIEW_REQUIRED;
  }

  const endsAt = parseIsoDateTime(promotion.endsAt);
  if (!endsAt) {
    return PROMOTION_STATES.REVIEW_REQUIRED;
  }

  let startsAt = null;
  if (promotion.startsAt !== null && promotion.startsAt !== undefined) {
    startsAt = parseIsoDateTime(promotion.startsAt);
    if (!startsAt) {
      return PROMOTION_STATES.REVIEW_REQUIRED;
    }
  }

  const now = parseCurrentDate(currentDate);
  if (!now) {
    return PROMOTION_STATES.REVIEW_REQUIRED;
  }

  if (
    !promotion.affiliateLinkId ||
    !affiliateLink ||
    !isAffiliateLinkUsable(affiliateLink)
  ) {
    return PROMOTION_STATES.UNAVAILABLE;
  }

  if (startsAt && now.getTime() < startsAt.getTime()) {
    return PROMOTION_STATES.UPCOMING;
  }

  if (now.getTime() <= endsAt.getTime()) {
    return PROMOTION_STATES.ACTIVE;
  }

  return PROMOTION_STATES.EXPIRED;
}

export function isPromotionPublic(promotion) {
  return (
    Boolean(promotion) &&
    PUBLICATION_STATUSES.includes(promotion.publicationStatus) &&
    promotion.requiresReview !== true
  );
}

export function formatIsoDatePt(value) {
  const match = ISO_WITH_TIMEZONE_PATTERN.exec(value ?? "");
  if (!match || !isIsoDateTimeWithTimezone(value)) {
    return null;
  }

  const [, year, month, day, hour, minute, , , offset] = match;
  const zone =
    offset === "Z"
      ? "UTC"
      : `UTC${offset.startsWith("-") ? "−" : "+"}${offset.slice(1)}`;

  return `${day}/${month}/${year} às ${hour}:${minute} (${zone})`;
}

export function formatMoney(value, currency) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    typeof currency !== "string" ||
    !/^[A-Z]{3}$/.test(currency)
  ) {
    return null;
  }

  try {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency,
      minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
      maximumFractionDigits: 2
    }).format(value);
  } catch {
    return null;
  }
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderOfferStatus(state) {
  const labels = {
    [PROMOTION_STATES.ACTIVE]: "OFERTA ATIVA",
    [PROMOTION_STATES.UPCOMING]: "EM BREVE",
    [PROMOTION_STATES.EXPIRED]: "EXPIRED",
    [PROMOTION_STATES.REVIEW_REQUIRED]: "REVIEW REQUIRED",
    [PROMOTION_STATES.UNAVAILABLE]: "Oferta indisponível"
  };

  return `<span class="offer-status offer-status--${state.toLowerCase()}">${labels[state]}</span>`;
}

export function renderAffiliateDisclosure({ short = false } = {}) {
  const text = short
    ? AFFILIATE_DISCLOSURE.short
    : AFFILIATE_DISCLOSURE.full;

  return `
    <aside class="affiliate-disclosure${short ? " affiliate-disclosure--short" : ""}" role="note" aria-label="Transparência sobre links afiliados">
      <p>${escapeHtml(text)}</p>
    </aside>
  `.trim();
}

function renderActivePricing(promotion) {
  const promoPrice = formatMoney(
    promotion.promoPrice,
    promotion.currency
  );
  const regularPrice = formatMoney(
    promotion.regularPrice,
    promotion.currency
  );

  const hasDiscount =
    typeof promotion.discountPercent === "number" &&
    Number.isFinite(promotion.discountPercent) &&
    promotion.discountPercent > 0;

  if (!promoPrice && !regularPrice && !hasDiscount) {
    return "";
  }

  const priceParts = [];
  if (promoPrice) {
    priceParts.push(
      `<strong class="offer-price">${escapeHtml(promoPrice)}</strong>`
    );
  }

  if (regularPrice) {
    priceParts.push(
      promoPrice
        ? `<del class="offer-regular-price">${escapeHtml(regularPrice)}</del>`
        : `<span class="offer-regular-price">${escapeHtml(regularPrice)}</span>`
    );
  }

  if (hasDiscount) {
    priceParts.push(
      `<span class="offer-discount">${escapeHtml(promotion.discountPercent)}% OFF</span>`
    );
  }

  return `<div class="offer-pricing" aria-label="Preço da oferta">${priceParts.join("")}</div>`;
}

function renderCoupon(promotion) {
  if (
    typeof promotion.couponCode !== "string" ||
    promotion.couponCode.trim() === ""
  ) {
    return "";
  }

  return `
    <p class="offer-coupon">
      Cupom: <code>${escapeHtml(promotion.couponCode.trim())}</code>
    </p>
  `.trim();
}

function renderOfferAction({ state, link, product }) {
  if (
    ![PROMOTION_STATES.ACTIVE, PROMOTION_STATES.EXPIRED].includes(state) ||
    !isAffiliateLinkUsable(link) ||
    !AFFILIATE_ID_PATTERN.test(link.id)
  ) {
    return "";
  }

  const label =
    state === PROMOTION_STATES.EXPIRED
      ? "Ver preço atual"
      : "Ver oferta";
  const accessibleSuffix =
    product?.name ? ` de ${escapeHtml(product.name)}` : "";

  return `
    <a
      class="button ${state === PROMOTION_STATES.EXPIRED ? "button-secondary" : "button-primary"} offer-button"
      href="/go/${encodeURIComponent(link.id)}"
      target="_blank"
      rel="sponsored noopener noreferrer"
    >
      ${label}<span class="sr-only">${accessibleSuffix}</span>
    </a>
  `.trim();
}

function renderStateMessage({ state, promotion }) {
  const startsAt = formatIsoDatePt(promotion.startsAt);
  const endsAt = formatIsoDatePt(promotion.endsAt);

  switch (state) {
    case PROMOTION_STATES.ACTIVE:
      return endsAt
        ? `<p class="offer-date">Oferta válida até <time datetime="${escapeHtml(promotion.endsAt)}">${escapeHtml(endsAt)}</time>.</p>`
        : "";
    case PROMOTION_STATES.EXPIRED:
      return endsAt
        ? `<p class="offer-date">Oferta encerrada em <time datetime="${escapeHtml(promotion.endsAt)}">${escapeHtml(endsAt)}</time>.</p>`
        : "";
    case PROMOTION_STATES.UPCOMING:
      return startsAt
        ? `<p class="offer-date">Disponível a partir de <time datetime="${escapeHtml(promotion.startsAt)}">${escapeHtml(startsAt)}</time>.</p>`
        : "";
    case PROMOTION_STATES.REVIEW_REQUIRED:
      return '<p class="offer-date">Esta oferta aguarda revisão humana e não está publicada.</p>';
    case PROMOTION_STATES.UNAVAILABLE:
      return '<p class="offer-date">Não há um destino afiliado seguro disponível no momento.</p>';
    default:
      return "";
  }
}

export function renderAffiliateOffer({
  promotion,
  product,
  affiliateLink,
  program = null,
  currentDate = new Date(),
  compact = false,
  showDisclosure = false,
  debug = false
}) {
  if (!promotion) {
    return debug
      ? '<p class="affiliate-config-error" role="status">REVIEW REQUIRED: promoção não encontrada.</p>'
      : "";
  }

  let state = getPromotionState(
    promotion,
    currentDate,
    affiliateLink
  );

  if (!isPromotionPublic(promotion)) {
    state = PROMOTION_STATES.REVIEW_REQUIRED;
  }

  if (!product || !program || program.status !== "active") {
    state = PROMOTION_STATES.UNAVAILABLE;
  }

  if (state === PROMOTION_STATES.REVIEW_REQUIRED && !debug) {
    return "";
  }

  const productName = product?.name ?? "Produto não identificado";
  const developer =
    typeof product?.developer === "string" && product.developer.trim() !== ""
      ? product.developer
      : null;
  const headline =
    typeof promotion.headline === "string" && promotion.headline.trim() !== ""
      ? promotion.headline
      : null;

  const pricing =
    state === PROMOTION_STATES.ACTIVE
      ? renderActivePricing(promotion)
      : "";
  const coupon =
    state === PROMOTION_STATES.ACTIVE
      ? renderCoupon(promotion)
      : "";
  const disclosure =
    showDisclosure &&
    [PROMOTION_STATES.ACTIVE, PROMOTION_STATES.EXPIRED].includes(state) &&
    isAffiliateLinkUsable(affiliateLink)
      ? renderAffiliateDisclosure({ short: true })
      : "";

  return `
    <article class="affiliate-offer${compact ? " affiliate-offer--compact" : ""}" data-promotion-state="${state}">
      <div class="offer-main">
        ${renderOfferStatus(state)}
        <div class="offer-heading">
          <h3>${escapeHtml(productName)}</h3>
          ${developer ? `<p class="offer-developer">${escapeHtml(developer)}</p>` : ""}
        </div>
        ${headline ? `<p class="offer-headline">${escapeHtml(headline)}</p>` : ""}
        ${pricing}
        ${coupon}
        ${renderStateMessage({ state, promotion })}
        ${disclosure}
      </div>
      <div class="offer-action">
        ${renderOfferAction({ state, link: affiliateLink, product })}
      </div>
    </article>
  `.trim();
}

export function buildAffiliateContext(
  promotion,
  data,
  currentDate = new Date()
) {
  const product = data.products.find(
    (entry) => entry.id === promotion?.productId
  );
  const affiliateLink = data.affiliateLinks.find(
    (entry) => entry.id === promotion?.affiliateLinkId
  );
  const program = data.affiliatePrograms.find(
    (entry) => entry.id === affiliateLink?.programId
  );

  let state = getPromotionState(
    promotion,
    currentDate,
    affiliateLink
  );

  if (!isPromotionPublic(promotion)) {
    state = PROMOTION_STATES.REVIEW_REQUIRED;
  }

  if (!product || !program || program.status !== "active") {
    state = PROMOTION_STATES.UNAVAILABLE;
  }

  return {
    promotion,
    product,
    affiliateLink,
    program,
    state
  };
}

export function selectPromotion(
  { promotionId = null, productId = null },
  data,
  currentDate = new Date(),
  { includeReview = false } = {}
) {
  if (promotionId) {
    const promotion = data.promotions.find(
      (entry) => entry.id === promotionId
    );
    return promotion
      ? buildAffiliateContext(promotion, data, currentDate)
      : null;
  }

  if (!productId) {
    return null;
  }

  const contexts = data.promotions
    .filter((entry) => entry.productId === productId)
    .map((entry) => buildAffiliateContext(entry, data, currentDate))
    .filter(
      (context) =>
        includeReview ||
        context.state !== PROMOTION_STATES.REVIEW_REQUIRED
    )
    .sort((left, right) => {
      const stateDifference =
        STATE_PRIORITY[left.state] - STATE_PRIORITY[right.state];
      if (stateDifference !== 0) {
        return stateDifference;
      }

      return String(left.promotion.endsAt).localeCompare(
        String(right.promotion.endsAt)
      );
    });

  return contexts[0] ?? null;
}

export function shouldShowAffiliateDisclosure(contexts) {
  return contexts.some(
    ({ state, affiliateLink }) =>
      [PROMOTION_STATES.ACTIVE, PROMOTION_STATES.EXPIRED].includes(state) &&
      isAffiliateLinkUsable(affiliateLink)
  );
}
