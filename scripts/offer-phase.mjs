/**
 * The offer's phase is a fact about the calendar, not an editorial judgement.
 *
 * A promotion that opens on 27 November is `upcoming` on 26 November and `live`
 * on 27, whether or not anyone edits the page. Deriving it at build time is what
 * lets a static site tell the truth without a scheduler and without a status that
 * quietly goes stale.
 *
 * `now` is always injected, so the tests never depend on the clock.
 */

export const OFFER_PHASES = Object.freeze({
  UPCOMING: "upcoming",
  LIVE: "live",
  ENDED: "ended"
});

/** Today as YYYY-MM-DD in UTC; every comparison below stays lexicographic. */
export function todayIso(now = new Date()) {
  return new Date(now).toISOString().slice(0, 10);
}

/**
 * Returns null when the offer carries no dates at all: a permanent freebie has
 * nothing to say about a window, and an empty line is worse than no line.
 */
export function offerPhase({ startsAtDate = null, endsAtDate = null } = {}, now = new Date()) {
  const hasStart = typeof startsAtDate === "string" && startsAtDate !== "";
  const hasEnd = typeof endsAtDate === "string" && endsAtDate !== "";
  if (!hasStart && !hasEnd) return null;

  const today = todayIso(now);
  if (hasEnd && today > endsAtDate) return OFFER_PHASES.ENDED;
  if (hasStart && today < startsAtDate) return OFFER_PHASES.UPCOMING;
  return OFFER_PHASES.LIVE;
}

/** 2026-11-27 -> "27 November 2026". UTC so a machine timezone cannot shift it. */
export function formatOfferDate(date) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  }).format(new Date(`${date}T00:00:00Z`));
}

/**
 * The one line the page shows. Neutral wording: "Opens" and "Ends" state the
 * calendar, which is true whatever the offer turns out to cost.
 */
export function offerWindowLabel({ startsAtDate = null, endsAtDate = null } = {}, now = new Date()) {
  const phase = offerPhase({ startsAtDate, endsAtDate }, now);
  if (phase === null) return null;

  if (phase === OFFER_PHASES.UPCOMING) return `Opens ${formatOfferDate(startsAtDate)}`;
  if (phase === OFFER_PHASES.ENDED) return `Ended ${formatOfferDate(endsAtDate)}`;
  return typeof endsAtDate === "string" && endsAtDate !== ""
    ? `Ends ${formatOfferDate(endsAtDate)}`
    : null;
}
