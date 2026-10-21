import {
  AFFILIATE_ID_PATTERN,
  isIsoDateTimeWithTimezone,
  isSafeHttpsUrl
} from "../assets/affiliate-core.mjs";
import { PRODUCT_CATEGORIES } from "./affiliate-validation.mjs";

/**
 * Validation for the ASP evidence package: the artifact NotebookLM / Odysseus
 * produce and hand to a human editor.
 *
 * An evidence package is research, not editorial state. It therefore must NOT
 * contain a Verdict, a Status, a validation flag, a publication state or a
 * stage, and it must not present a machine reading of the source as confirmed
 * fact. This validator enforces the mechanical rules the prompt cannot.
 */

export const EVIDENCE_PACKAGE_VERSION = "1.0";

export const OFFER_NATURES = Object.freeze([
  "permanent-free",
  "limited-free",
  "paid-promo",
  "launch-price",
  "update",
  "not-an-offer"
]);

export const LIMITED_BY = Object.freeze(["time", "quantity", "catalog", "none"]);

export const COUPON_SCOPES = Object.freeze(["vendor-wide", "creator-affiliated", "unknown"]);

export const COUPON_PUBLISHABLE = Object.freeze([true, false, "unknown"]);

export const EVIDENCE_ROLES = Object.freeze(["primary", "secondary"]);

/**
 * How far the reader-facing copy has got. Extraction produces facts and no copy
 * at all, which is legitimate: the editor writes it. Requiring copy from an
 * email extractor would force it to either leak a private email body or compose
 * marketing text.
 */
export const COPY_STATUSES = Object.freeze(["missing", "draft", "final"]);

/**
 * The fact names `missingFacts` and `notApplicable` are matched against. The
 * validator reasons about these strings, so a free-text label such as
 * "expiryDate" or "official URL" is never read — it silently satisfies nothing.
 */
export const KNOWN_FACT_NAMES = Object.freeze([
  "evidence",
  "sources",
  "readerFacingCopy",
  "copyStatus",
  "developerOfficialUrl",
  "acquisitionUrl",
  "primarySourceFound",
  "developer",
  "product",
  "productName",
  "promoPrice",
  "regularPrice",
  "regularPriceSource",
  "currency",
  "startsAt",
  "endsAt",
  "endsAtDate",
  "permanent",
  "offerNature",
  "limitedBy",
  "couponCode",
  "couponScope",
  "couponOwner",
  "couponPublishable",
  "freeQualification",
  "systemRequirements",
  "licenseTerms"
]);

/**
 * The board's own free-qualification vocabulary, from docs/editorial-flow.md, so
 * an extracted candidate feeds the PREPARAÇÃO checklist without translation.
 */
export const FREE_QUALIFICATIONS = Object.freeze([
  "Free",
  "Free temporário",
  "Requer compra",
  "Requer código",
  "Requer cadastro",
  "Trial",
  "Não é Free",
  "Inconclusivo"
]);

/**
 * Keys that carry editorial authority. Their presence anywhere in a package
 * means an upstream tool has overstepped, which is exactly the failure that
 * produced `verdict: "confirmed"` and `publication: "ready"` before.
 */
export const FORBIDDEN_EDITORIAL_KEYS = Object.freeze([
  "verdict",
  "verdictType",
  "editorialStatus",
  "editorialStage",
  "validation",
  "publication",
  "selection",
  "priority",
  "approved",
  "published"
]);

/**
 * Keys that carry private source material or credentials. An evidence package is
 * destined for the repository pipeline, so email bodies, private headers, sender
 * and subject metadata, and any credential must never reach it — whichever tool
 * produced the package.
 *
 * `body` is deliberately absent: `readerFacingCopy.body` is legitimate published
 * copy, and only an email-specific key like `emailBody` is forbidden.
 */
export const FORBIDDEN_PRIVATE_KEY =
  /^(?:emailBody|htmlBody|rawBody|textBody|bodyHtml|headers|rawHeaders|messageId|internetMessageId|sender|senderEmail|subject|token|accessToken|refreshToken|apiKey|password|secret|cookie|authorization|bcc)$/i;

/**
 * An email address anywhere in a package is private source material. A monitored
 * sender identity must never reach the repository pipeline, even as a value.
 */
const EMAIL_ADDRESS_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/;

/**
 * Redaction artifacts. A sanitizer between the research tool and the consumer
 * replaces URLs with these; `isPlaceholderUrl` does not cover them.
 */
export const REDACTION_MARKERS = Object.freeze([
  /\[suspicious link removed\]/i,
  /\[link removed\]/i,
  /\[removed\]/i,
  /\[redacted\]/i
]);

export const REQUIRED_COPY_FIELDS = Object.freeze(["title", "summary", "body"]);

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function isCalendarDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

export function findRedactionMarkers(value, location = "$", results = []) {
  if (typeof value === "string") {
    if (REDACTION_MARKERS.some((marker) => marker.test(value))) {
      results.push(location);
    }
    return results;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => findRedactionMarkers(item, `${location}[${index}]`, results));
    return results;
  }
  if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      findRedactionMarkers(child, `${location}.${key}`, results);
    }
  }
  return results;
}

function findForbiddenKeys(value, location = "$", results = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => findForbiddenKeys(item, `${location}[${index}]`, results));
    return results;
  }
  if (!isRecord(value)) return results;

  for (const [key, child] of Object.entries(value)) {
    const childLocation = `${location}.${key}`;
    if (FORBIDDEN_EDITORIAL_KEYS.includes(key)) {
      results.push(childLocation);
    }
    findForbiddenKeys(child, childLocation, results);
  }
  return results;
}

function findEmailAddresses(value, location = "$", results = []) {
  if (typeof value === "string") {
    if (EMAIL_ADDRESS_PATTERN.test(value)) {
      results.push(location);
    }
    return results;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => findEmailAddresses(item, `${location}[${index}]`, results));
    return results;
  }
  if (isRecord(value)) {
    for (const [key, child] of Object.entries(value)) {
      findEmailAddresses(child, `${location}.${key}`, results);
    }
  }
  return results;
}

function findPrivateKeys(value, location = "$", results = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => findPrivateKeys(item, `${location}[${index}]`, results));
    return results;
  }
  if (!isRecord(value)) return results;

  for (const [key, child] of Object.entries(value)) {
    const childLocation = `${location}.${key}`;
    if (FORBIDDEN_PRIVATE_KEY.test(key)) {
      results.push(childLocation);
    }
    findPrivateKeys(child, childLocation, results);
  }
  return results;
}

function normalizeForComparison(value) {
  return value.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

function validateUrlField({ add, value, location, label, required = false }) {
  if (value === null || value === undefined) {
    if (required) {
      add("errors", "MISSING_URL", location, `${label} is required.`);
    }
    return;
  }
  if (!isSafeHttpsUrl(value)) {
    add(
      "errors",
      "UNSAFE_URL",
      location,
      `${label} must be a complete https:// URL with no placeholder, redaction marker or credentials.`
    );
  }
}

function validateOffer({ add, offer, record, location }) {
  if (!isRecord(offer)) {
    add("errors", "MISSING_OFFER", location, "A record must carry an offer object.");
    return;
  }

  const {
    promoPrice,
    regularPrice,
    currency,
    startsAt,
    startsAtDate,
    endsAt,
    endsAtDate,
    dateOnly,
    permanent
  } = offer;
  const prices = [promoPrice, regularPrice];

  for (const [index, price] of prices.entries()) {
    const field = index === 0 ? "promoPrice" : "regularPrice";
    if (price === null || price === undefined) continue;
    if (typeof price !== "number" || !Number.isFinite(price) || price < 0) {
      add("errors", "INVALID_PRICE", `${location}.${field}`, "A price must be a non-negative number or null.");
    }
  }

  // A currency is only meaningful for a non-zero amount. `promoPrice: 0` is how a
  // free offer is expressed, and "USD 0" states nothing.
  const hasMonetaryAmount = prices.some((price) => typeof price === "number" && price > 0);
  if (hasMonetaryAmount) {
    if (typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency)) {
      add(
        "errors",
        "MISSING_CURRENCY",
        `${location}.currency`,
        "A three-letter ISO 4217 currency is required whenever a non-zero price is present."
      );
    }
  } else if (currency !== null && currency !== undefined) {
    add(
      "errors",
      "CURRENCY_WITHOUT_PRICE",
      `${location}.currency`,
      "Currency must be null when the record carries no non-zero amount; declaring one states an unverified assumption."
    );
  }

  if (typeof regularPrice === "number" && !isNonEmptyString(offer.regularPriceSource)) {
    add(
      "errors",
      "MISSING_PRICE_SOURCE",
      `${location}.regularPriceSource`,
      "State which source the regular price came from."
    );
  }

  if (startsAt !== null && startsAt !== undefined && !isIsoDateTimeWithTimezone(startsAt)) {
    add("errors", "INVALID_TIMESTAMP", `${location}.startsAt`, "Use ISO 8601 with an explicit time and timezone.");
  }
  if (endsAt !== null && endsAt !== undefined && !isIsoDateTimeWithTimezone(endsAt)) {
    add("errors", "INVALID_TIMESTAMP", `${location}.endsAt`, "Use ISO 8601 with an explicit time and timezone.");
  }
  if (endsAtDate !== null && endsAtDate !== undefined && !isCalendarDate(endsAtDate)) {
    add("errors", "INVALID_DATE", `${location}.endsAtDate`, "Use a real calendar date in YYYY-MM-DD form.");
  }
  if (startsAtDate !== null && startsAtDate !== undefined && !isCalendarDate(startsAtDate)) {
    add("errors", "INVALID_DATE", `${location}.startsAtDate`, "Use a real calendar date in YYYY-MM-DD form.");
  }
  if (isCalendarDate(startsAtDate) && isCalendarDate(endsAtDate) && startsAtDate > endsAtDate) {
    add(
      "errors",
      "INVALID_OFFER_WINDOW",
      `${location}.startsAtDate`,
      `The offer would open on ${startsAtDate}, after it closes on ${endsAtDate}.`
    );
  }

  // The headline rule: a date-only source must never grow an invented time.
  if (dateOnly === true && endsAt !== null && endsAt !== undefined) {
    add(
      "errors",
      "FABRICATED_TIMESTAMP",
      `${location}.endsAt`,
      "dateOnly is true but a full timestamp is present. The time and timezone were invented: set endsAt to null and keep only endsAtDate."
    );
  }
  // The mirror rule for the start: "27 November" must not become midnight UTC.
  if (dateOnly === true && startsAt !== null && startsAt !== undefined) {
    add(
      "errors",
      "FABRICATED_TIMESTAMP",
      `${location}.startsAt`,
      "dateOnly is true but a full start timestamp is present. The time and timezone were invented: set startsAt to null and keep only startsAtDate."
    );
  }
  if (dateOnly === true && (endsAtDate === null || endsAtDate === undefined)) {
    // `dateOnly` describes the precision of a known deadline. With no deadline at
    // all it is merely meaningless, not a false fact: a permanent freeware has no
    // end date by design. The real risk — a time-limited offer with no deadline —
    // is caught by TIME_LIMIT_WITHOUT_END below.
    add(
      "warnings",
      "MEANINGLESS_DATE_ONLY",
      `${location}.dateOnly`,
      "dateOnly is true but no deadline is present. Set dateOnly to false when the offer has no end date."
    );
  }

  if (permanent === true) {
    if (endsAt !== null && endsAt !== undefined) {
      add("errors", "PERMANENT_WITH_END", `${location}.endsAt`, "A permanent offer cannot carry an end timestamp.");
    }
    if (endsAtDate !== null && endsAtDate !== undefined) {
      add("errors", "PERMANENT_WITH_END", `${location}.endsAtDate`, "A permanent offer cannot carry an end date.");
    }
  }

  // A permanently free product has no current list price. Folding a historical
  // price into `regularPrice` renders as a discount nobody can claim: there is
  // nothing to discount from. The history belongs in the copy, not in a price.
  if (
    record.offerNature === "permanent-free" &&
    offer.regularPrice !== null &&
    offer.regularPrice !== undefined
  ) {
    add(
      "errors",
      "PERMANENT_FREE_WITH_REGULAR_PRICE",
      `${location}.regularPrice`,
      'offerNature is "permanent-free": a historical price is not a current regular price. Set regularPrice to null and keep the history in readerFacingCopy.'
    );
  }

  const limitedBy = record.limitedBy;
  if (limitedBy === "time" && endsAt == null && endsAtDate == null) {
    const declared = Array.isArray(record.missingFacts) ? record.missingFacts : [];
    if (!declared.includes("endsAt") && !declared.includes("endsAtDate")) {
      add(
        "errors",
        "TIME_LIMIT_WITHOUT_END",
        `${location}`,
        'limitedBy is "time" but no end date exists and neither endsAt nor endsAtDate is declared in missingFacts.'
      );
    }
  }
  if ((limitedBy === "quantity" || limitedBy === "catalog") && (endsAt != null || endsAtDate != null)) {
    add(
      "warnings",
      "QUANTITY_LIMIT_WITH_END",
      `${location}`,
      `limitedBy is "${limitedBy}" but an end date is present; confirm which limit governs the offer.`
    );
  }

  // The offer nature and the limit must agree. A `limited-free` offer recorded as
  // having no limit would look unbounded, and the Status logic would have no
  // deadline to work from. `LIMITED_BY.includes` guards the undefined case, which
  // INVALID_LIMITED_BY already reports.
  if (LIMITED_BY.includes(limitedBy)) {
    if (record.offerNature === "limited-free" && limitedBy === "none") {
      add(
        "errors",
        "LIMITED_FREE_WITHOUT_LIMIT",
        `${location}`,
        'offerNature is "limited-free" but limitedBy is "none". Declare the limit: time, quantity or catalog.'
      );
    }
    if (record.offerNature === "permanent-free" && limitedBy !== "none") {
      add(
        "errors",
        "PERMANENT_FREE_WITH_LIMIT",
        `${location}`,
        `offerNature is "permanent-free" but limitedBy is "${limitedBy}". A permanent offer has no limit.`
      );
    }
  }

  validateCoupon({ add, offer, record, location });
}

function validateCoupon({ add, offer, record, location }) {
  const { couponCode, couponScope, couponOwner, couponPublishable } = offer;

  if (couponCode === null || couponCode === undefined || couponCode === "") {
    if (couponScope !== null && couponScope !== undefined) {
      add("warnings", "COUPON_SCOPE_WITHOUT_CODE", `${location}.couponScope`, "No coupon code is present.");
    }
    return;
  }

  if (!isNonEmptyString(couponCode)) {
    add("errors", "INVALID_COUPON", `${location}.couponCode`, "A coupon code must be a non-empty string or null.");
    return;
  }
  if (!COUPON_SCOPES.includes(couponScope)) {
    add(
      "errors",
      "INVALID_COUPON_SCOPE",
      `${location}.couponScope`,
      `Declare the coupon scope: ${COUPON_SCOPES.join(", ")}.`
    );
  }
  if (!COUPON_PUBLISHABLE.includes(couponPublishable)) {
    add(
      "errors",
      "INVALID_COUPON_PUBLISHABLE",
      `${location}.couponPublishable`,
      "Declare couponPublishable as true, false or \"unknown\"."
    );
  }
  if (couponScope === "creator-affiliated" && !isNonEmptyString(couponOwner)) {
    add(
      "errors",
      "MISSING_COUPON_OWNER",
      `${location}.couponOwner`,
      "A creator-affiliated coupon must name its owner."
    );
  }

  // A code that is not cleared for publication must not appear in reader copy.
  if (couponPublishable !== true) {
    const copy = isRecord(record.readerFacingCopy) ? record.readerFacingCopy : {};
    const needle = couponCode.trim().toLowerCase();
    for (const field of REQUIRED_COPY_FIELDS) {
      const value = copy[field];
      if (typeof value === "string" && value.toLowerCase().includes(needle)) {
        add(
          "errors",
          "COUPON_LEAKED_INTO_COPY",
          `${location.replace(/\.offer$/, "")}.readerFacingCopy.${field}`,
          `Coupon code ${couponCode} is not approved for publication (couponPublishable is ${JSON.stringify(couponPublishable)}) but appears in reader-facing copy.`
        );
      }
    }
  }
}

function validateEvidenceList({ add, record, location }) {
  const evidence = record.evidence;
  if (!Array.isArray(evidence) || evidence.length === 0) {
    add("errors", "MISSING_EVIDENCE", `${location}.evidence`, "A record must cite at least one source.");
    return { primaryCount: 0 };
  }

  let primaryCount = 0;
  evidence.forEach((entry, index) => {
    const entryLocation = `${location}.evidence[${index}]`;
    if (!isRecord(entry)) {
      add("errors", "INVALID_EVIDENCE_ENTRY", entryLocation, "Each source must be an object.");
      return;
    }
    if (!EVIDENCE_ROLES.includes(entry.role)) {
      add("errors", "INVALID_EVIDENCE_ROLE", `${entryLocation}.role`, `Use ${EVIDENCE_ROLES.join(" or ")}.`);
    } else if (entry.role === "primary") {
      primaryCount += 1;
    }
    if (!isNonEmptyString(entry.name)) {
      add("errors", "MISSING_EVIDENCE_NAME", `${entryLocation}.name`, "Name the source.");
    }
    validateUrlField({
      add,
      value: entry.url,
      location: `${entryLocation}.url`,
      label: "The source URL",
      required: true
    });
    if (entry.date !== null && entry.date !== undefined && !isCalendarDate(entry.date)) {
      add(
        "errors",
        "INVALID_EVIDENCE_DATE",
        `${entryLocation}.date`,
        "Use the source publication date in YYYY-MM-DD form."
      );
    }
    if (!isNonEmptyString(entry.fact)) {
      add(
        "errors",
        "MISSING_EVIDENCE_FACT",
        `${entryLocation}.fact`,
        "State what this source claims, without interpretation."
      );
    }
  });

  if (typeof record.primarySourceFound !== "boolean") {
    add(
      "errors",
      "MISSING_PRIMARY_SOURCE_FLAG",
      `${location}.primarySourceFound`,
      "Declare whether a primary source was found, as true or false."
    );
  } else if (record.primarySourceFound === true && primaryCount === 0) {
    add(
      "errors",
      "PRIMARY_SOURCE_MISMATCH",
      `${location}.primarySourceFound`,
      "primarySourceFound is true but no evidence entry has role \"primary\"."
    );
  } else if (record.primarySourceFound === false && primaryCount > 0) {
    add(
      "errors",
      "PRIMARY_SOURCE_MISMATCH",
      `${location}.primarySourceFound`,
      "primarySourceFound is false but a primary evidence entry exists."
    );
  }

  return { primaryCount };
}

function validateRecord({ add, record, location, seenIds }) {
  if (!isRecord(record)) {
    add("errors", "INVALID_RECORD", location, "Each record must be an object.");
    return;
  }

  if (typeof record.recordId !== "string" || !AFFILIATE_ID_PATTERN.test(record.recordId)) {
    add("errors", "INVALID_RECORD_ID", `${location}.recordId`, "recordId must use lowercase letters, numbers and hyphens.");
  } else if (seenIds.has(record.recordId)) {
    add("errors", "DUPLICATE_RECORD_ID", `${location}.recordId`, `Duplicate recordId: ${record.recordId}.`);
  } else {
    seenIds.add(record.recordId);
  }

  if (!PRODUCT_CATEGORIES.includes(record.productKind)) {
    add("errors", "INVALID_PRODUCT_KIND", `${location}.productKind`, `Unsupported product kind: ${record.productKind}.`);
  }
  if (!OFFER_NATURES.includes(record.offerNature)) {
    add("errors", "INVALID_OFFER_NATURE", `${location}.offerNature`, `Unsupported offer nature: ${record.offerNature}.`);
  }
  if (!LIMITED_BY.includes(record.limitedBy)) {
    add("errors", "INVALID_LIMITED_BY", `${location}.limitedBy`, `Use one of: ${LIMITED_BY.join(", ")}.`);
  }

  if (record.pendingHumanDecision !== true) {
    add(
      "errors",
      "MISSING_HUMAN_DECISION_FLAG",
      `${location}.pendingHumanDecision`,
      "A package record must enter with pendingHumanDecision set to true."
    );
  }

  if (!isRecord(record.developer) || !isNonEmptyString(record.developer.name)) {
    add("errors", "MISSING_DEVELOPER", `${location}.developer.name`, "Name the developer or vendor.");
  } else if (record.developer.developerOfficialUrl !== null && record.developer.developerOfficialUrl !== undefined) {
    validateUrlField({
      add,
      value: record.developer.developerOfficialUrl,
      location: `${location}.developer.developerOfficialUrl`,
      label: "The developer URL"
    });
  }

  if (record.acquisitionUrl !== null && record.acquisitionUrl !== undefined) {
    // Deliberately not required: acquisitionUrl is evidence, never a public destination.
    validateUrlField({
      add,
      value: record.acquisitionUrl,
      location: `${location}.acquisitionUrl`,
      label: "The acquisition URL"
    });
  }

  if (!isRecord(record.product) || !isNonEmptyString(record.product.name)) {
    add("errors", "MISSING_PRODUCT", `${location}.product.name`, "Name the product.");
  } else if (!isNonEmptyString(record.product.whatItIs)) {
    add("warnings", "MISSING_WHAT_IT_IS", `${location}.product.whatItIs`, "Describe the product in one factual sentence.");
  }

  // `productKind` and `product.category` describe the same thing. When they
  // disagree the adapted block silently inherits whichever the adapter prefers,
  // so the package is rejected instead.
  if (isRecord(record.product) && record.product.category !== undefined && record.product.category !== null) {
    if (!PRODUCT_CATEGORIES.includes(record.product.category)) {
      add(
        "errors",
        "INVALID_PRODUCT_CATEGORY",
        `${location}.product.category`,
        `Unsupported product category: ${record.product.category}.`
      );
    } else if (record.product.category !== record.productKind) {
      add(
        "errors",
        "CATEGORY_KIND_MISMATCH",
        `${location}.product.category`,
        `product.category (${record.product.category}) must match productKind (${record.productKind}).`
      );
    }
  }

  // The demo video is product media, not evidence: it shows the thing, it does
  // not prove the offer. Optional, but a broken URL is still a defect — and it
  // must be the vendor's own video for this product, never one found nearby.
  if (isRecord(record.product)) {
    validateUrlField({
      add,
      value: record.product.demoUrl,
      location: `${location}.product.demoUrl`,
      label: "The demo video URL"
    });

    // A video that covers a collection is not a demo of one product. With no
    // label the reader is promised the product itself, so the scope has to be
    // stated rather than implied.
    const demoLabel = record.product.demoLabel;
    if (demoLabel !== null && demoLabel !== undefined) {
      if (!isNonEmptyString(demoLabel) || demoLabel.length > 80) {
        add(
          "errors",
          "INVALID_DEMO_LABEL",
          `${location}.product.demoLabel`,
          "The demo label must be a non-empty string of at most 80 characters."
        );
      } else if (record.product.demoUrl === null || record.product.demoUrl === undefined) {
        add(
          "errors",
          "INVALID_DEMO_LABEL",
          `${location}.product.demoLabel`,
          "A demo label without a demo URL describes nothing: set demoUrl or drop the label."
        );
      }
    }
  }

  validateOffer({ add, offer: record.offer, record, location: `${location}.offer` });

  const declaredMissing = Array.isArray(record.missingFacts) ? record.missingFacts : [];

  if (!COPY_STATUSES.includes(record.copyStatus)) {
    add(
      "errors",
      "INVALID_COPY_STATUS",
      `${location}.copyStatus`,
      `Declare copyStatus as one of: ${COPY_STATUSES.join(", ")}.`
    );
  } else if (record.copyStatus === "missing") {
    if (record.readerFacingCopy !== undefined && record.readerFacingCopy !== null) {
      add(
        "errors",
        "COPY_PRESENT_WHEN_MISSING",
        `${location}.readerFacingCopy`,
        'copyStatus is "missing" but reader-facing copy is present.'
      );
    }
    if (!declaredMissing.includes("readerFacingCopy")) {
      add(
        "errors",
        "UNDECLARED_COPY_GAP",
        `${location}.missingFacts`,
        'copyStatus is "missing" but missingFacts does not declare readerFacingCopy.'
      );
    }
  } else if (!isRecord(record.readerFacingCopy)) {
    add(
      "errors",
      "MISSING_COPY",
      `${location}.readerFacingCopy`,
      `Reader-facing copy is required when copyStatus is "${record.copyStatus}".`
    );
  } else {
    for (const field of REQUIRED_COPY_FIELDS) {
      if (!isNonEmptyString(record.readerFacingCopy[field])) {
        add("errors", "MISSING_COPY_FIELD", `${location}.readerFacingCopy.${field}`, "This copy field is required.");
      }
    }
  }

  if (record.freeQualification !== undefined && !FREE_QUALIFICATIONS.includes(record.freeQualification)) {
    add(
      "errors",
      "INVALID_FREE_QUALIFICATION",
      `${location}.freeQualification`,
      `Use the board vocabulary: ${FREE_QUALIFICATIONS.join(" | ")}.`
    );
  }

  validateEvidenceList({ add, record, location });

  const missing = Array.isArray(record.missingFacts) ? record.missingFacts : [];
  const notApplicable = Array.isArray(record.notApplicable) ? record.notApplicable : [];
  for (const [field, value] of [["missingFacts", record.missingFacts], ["notApplicable", record.notApplicable]]) {
    if (!Array.isArray(value) || value.some((item) => !isNonEmptyString(item))) {
      add("errors", "INVALID_FACT_LIST", `${location}.${field}`, `${field} must be an array of non-empty strings.`);
    }
  }
  const overlap = missing.filter((fact) => notApplicable.includes(fact));
  if (overlap.length > 0) {
    add(
      "errors",
      "FACT_IN_BOTH_LISTS",
      `${location}.missingFacts`,
      `A fact cannot be both missing and not applicable: ${[...new Set(overlap)].join(", ")}.`
    );
  }

  // A free-text label here is read by nothing. It does not create a false claim,
  // so it is a warning, but the declaration silently satisfies no rule.
  for (const [field, values] of [["missingFacts", missing], ["notApplicable", notApplicable]]) {
    values.forEach((name, index) => {
      if (!KNOWN_FACT_NAMES.includes(name)) {
        add(
          "warnings",
          "UNKNOWN_FACT_NAME",
          `${location}.${field}[${index}]`,
          `"${name}" is not a recognized fact name and is never read. Use the field name: ${KNOWN_FACT_NAMES.join(", ")}.`
        );
      }
    });
  }

  for (const field of ["restrictions", "openQuestions", "toValidate"]) {
    const value = record[field];
    if (!Array.isArray(value) || value.some((item) => !isNonEmptyString(item))) {
      add("errors", "INVALID_LIST", `${location}.${field}`, `${field} must be an array of non-empty strings.`);
    }
  }

  const questions = Array.isArray(record.openQuestions) ? record.openQuestions : [];
  const toValidate = Array.isArray(record.toValidate) ? record.toValidate : [];
  const questionSet = new Set(questions.map(normalizeForComparison));
  for (const [index, action] of toValidate.entries()) {
    if (questionSet.has(normalizeForComparison(action))) {
      add(
        "warnings",
        "DUPLICATE_QUESTION_AND_ACTION",
        `${location}.toValidate[${index}]`,
        "This repeats an open question verbatim; state the concrete human action instead."
      );
    }
  }
}

export function validateEvidencePackage(pkg) {
  const errors = [];
  const warnings = [];
  const add = (severity, code, location, message) => {
    (severity === "errors" ? errors : warnings).push({ code, location, message });
  };

  if (!isRecord(pkg)) {
    add("errors", "INVALID_PACKAGE", "$", "The evidence package must be a JSON object with a records array.");
    return { errors, warnings };
  }

  if (pkg.packageVersion !== EVIDENCE_PACKAGE_VERSION) {
    add(
      "errors",
      "UNSUPPORTED_PACKAGE_VERSION",
      "$.packageVersion",
      `This validator accepts packageVersion ${EVIDENCE_PACKAGE_VERSION}.`
    );
  }

  if (!isCalendarDate(pkg.scanDate)) {
    add("errors", "INVALID_SCAN_DATE", "$.scanDate", "scanDate must be a real calendar date in YYYY-MM-DD form.");
  }

  if (!Array.isArray(pkg.channelsMonitored) || pkg.channelsMonitored.length === 0) {
    add(
      "errors",
      "INVALID_CHANNELS",
      "$.channelsMonitored",
      "channelsMonitored must be a list of channel names, not a count; a count hides source concentration and blind spots."
    );
  } else if (pkg.channelsMonitored.some((channel) => !isNonEmptyString(channel))) {
    add("errors", "INVALID_CHANNELS", "$.channelsMonitored", "Every monitored channel must be a non-empty string.");
  }

  if (!Array.isArray(pkg.records) || pkg.records.length === 0) {
    add("errors", "INVALID_RECORDS", "$.records", "A package must contain a non-empty records array.");
    return { errors, warnings };
  }

  if (!isNonNegativeInteger(pkg.candidatesAccepted)) {
    add("errors", "INVALID_ACCEPTED_COUNT", "$.candidatesAccepted", "candidatesAccepted must be a non-negative integer.");
  } else if (pkg.candidatesAccepted !== pkg.records.length) {
    add(
      "errors",
      "ACCEPTED_COUNT_MISMATCH",
      "$.candidatesAccepted",
      `candidatesAccepted is ${pkg.candidatesAccepted} but the package carries ${pkg.records.length} record(s).`
    );
  }

  if (!isNonNegativeInteger(pkg.candidatesRejected)) {
    add("errors", "INVALID_REJECTED_COUNT", "$.candidatesRejected", "candidatesRejected must be a non-negative integer.");
  } else if (pkg.candidatesRejected === 0) {
    add(
      "warnings",
      "UNVERIFIED_REJECTED_COUNT",
      "$.candidatesRejected",
      "Zero rejected candidates is unusual for a multi-channel sweep. Confirm the count is computed, not a placeholder."
    );
  }

  if (pkg.rejectedSummary !== undefined) {
    if (!Array.isArray(pkg.rejectedSummary) || pkg.rejectedSummary.some((item) => !isNonEmptyString(item))) {
      add("errors", "INVALID_REJECTED_SUMMARY", "$.rejectedSummary", "rejectedSummary must be an array of strings.");
    } else if (
      isNonNegativeInteger(pkg.candidatesRejected) &&
      pkg.candidatesRejected > 0 &&
      pkg.rejectedSummary.length !== pkg.candidatesRejected
    ) {
      add(
        "warnings",
        "REJECTED_SUMMARY_MISMATCH",
        "$.rejectedSummary",
        `candidatesRejected is ${pkg.candidatesRejected} but rejectedSummary lists ${pkg.rejectedSummary.length} reason(s).`
      );
    }
  }

  const seenIds = new Set();
  pkg.records.forEach((record, index) => {
    const location = `records[${index}]`;

    for (const keyPath of findForbiddenKeys(record, location)) {
      add(
        "errors",
        "EDITORIAL_AUTHORITY_LEAK",
        keyPath,
        "An evidence package must not carry editorial authority fields (Verdict, Status, stage, validation, publication, selection or priority)."
      );
    }

    if (isRecord(record) && Object.hasOwn(record, "packageVersion")) {
      add(
        "warnings",
        "DUPLICATED_PACKAGE_VERSION",
        `${location}.packageVersion`,
        "packageVersion belongs to the package envelope, not to each record."
      );
    }

    validateRecord({ add, record, location, seenIds });
  });

  for (const location of findRedactionMarkers(pkg)) {
    add(
      "errors",
      "REDACTED_URL",
      location,
      "A redaction marker was found. Emit the real URL or null; never a placeholder."
    );
  }

  for (const location of findPrivateKeys(pkg)) {
    add(
      "errors",
      "FORBIDDEN_PRIVATE_FIELD",
      location,
      "An evidence package must not carry email bodies, private headers, sender or subject metadata, or credentials."
    );
  }

  for (const location of findEmailAddresses(pkg)) {
    add(
      "errors",
      "PRIVATE_EMAIL_ADDRESS",
      location,
      "An email address is private source material and must not reach the repository pipeline, not even as a value."
    );
  }

  return { errors, warnings };
}

export function formatEvidencePackageReport(report) {
  const lines = [
    ...report.errors.map((issue) => `ERROR ${issue.code} ${issue.location}: ${issue.message}`),
    ...report.warnings.map((issue) => `WARN ${issue.code} ${issue.location}: ${issue.message}`)
  ];
  lines.push(`${report.errors.length} erro(s) crítico(s), ${report.warnings.length} aviso(s).`);
  if (report.errors.length === 0) {
    lines.push("Pacote de evidências válido; nenhum dado foi publicado.");
  }
  return lines.join("\n");
}

export { isCalendarDate };
