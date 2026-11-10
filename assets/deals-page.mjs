import {
  PROMOTION_STATES,
  buildAffiliateContext,
  shouldShowAffiliateDisclosure
} from "./affiliate-core.mjs";
import { loadAffiliateData } from "./affiliate-data.mjs";
import "./affiliate-elements.mjs";

const SECTION_BY_STATE = Object.freeze({
  [PROMOTION_STATES.ACTIVE]: "active-offers",
  [PROMOTION_STATES.UPCOMING]: "upcoming-offers",
  [PROMOTION_STATES.EXPIRED]: "expired-offers",
  [PROMOTION_STATES.UNAVAILABLE]: "unavailable-offers",
  [PROMOTION_STATES.REVIEW_REQUIRED]: "review-offers"
});

function debugModeEnabled() {
  const developmentHosts = new Set([
    "localhost",
    "127.0.0.1",
    "[::1]"
  ]);
  if (!developmentHosts.has(window.location.hostname)) {
    return false;
  }

  const params = new URLSearchParams(window.location.search);
  return (
    document.documentElement.dataset.environment === "development" ||
    params.get("affiliateDebug") === "1"
  );
}

function appendOffer(container, context, debug) {
  const offer = document.createElement("affiliate-offer");
  offer.setAttribute("promotion-id", context.promotion.id);
  if (debug && context.state === PROMOTION_STATES.REVIEW_REQUIRED) {
    offer.setAttribute("debug", "");
  }
  container.append(offer);
}

async function renderDealsPage() {
  const pageStatus = document.querySelector("#deals-status");
  const emptyState = document.querySelector("#deals-empty");
  const disclosure = document.querySelector("#deals-disclosure");
  const debug = debugModeEnabled();

  try {
    const data = await loadAffiliateData();
    const contexts = data.promotions.map((promotion) =>
      buildAffiliateContext(promotion, data, new Date())
    );
    const visibleContexts = contexts.filter(
      ({ state }) =>
        state !== PROMOTION_STATES.REVIEW_REQUIRED || debug
    );

    // The partner shelf is grouped by programme, one heading per partner, so the
    // cards can carry plain product names: the heading already says whose they are.
    // Groups appear in the order the data gives them, not in file order.
    const partnerGroups = document.querySelector("#partner-groups");
    const groupByProgramme = new Map();
    const ordered = [...visibleContexts].sort(
      (a, b) =>
        (a.promotion?.placementOrder ?? Number.MAX_SAFE_INTEGER) -
        (b.promotion?.placementOrder ?? Number.MAX_SAFE_INTEGER)
    );

    for (const context of ordered) {
      // A partner campaign is not a deal among deals. It sits at the top of the
      // page, above the deals it competes with, because that is what the partner
      // agreed to and what the reader came for if they follow the programme.
      const inPartnerShelf =
        context.promotion?.placement === "partner-shelf" &&
        context.state === PROMOTION_STATES.ACTIVE;

      if (inPartnerShelf) {
        const programmeId = context.program?.id ?? "unknown";
        let group = groupByProgramme.get(programmeId);
        if (!group) {
          const wrapper = document.createElement("div");
          wrapper.className = "partner-group";
          const heading = document.createElement("h3");
          heading.className = "partner-group-title";
          heading.textContent = context.program?.name ?? "Partner";
          const list = document.createElement("div");
          list.className = "offer-list";
          wrapper.append(heading, list);
          partnerGroups.append(wrapper);
          group = list;
          groupByProgramme.set(programmeId, group);
        }
        appendOffer(group, context, debug);
        continue;
      }

      const targetId = SECTION_BY_STATE[context.state];
      const container = document.querySelector(`#${targetId} .offer-list`);
      const section = document.querySelector(`#${targetId}`);
      if (!container || !section) {
        continue;
      }

      appendOffer(container, context, debug);
      section.hidden = false;
    }

    if (groupByProgramme.size > 0 && partnerGroups) {
      partnerGroups.closest("section").hidden = false;
    }

    if (shouldShowAffiliateDisclosure(visibleContexts)) {
      disclosure.replaceChildren(
        document.createElement("affiliate-disclosure")
      );
      disclosure.hidden = false;
    }

    emptyState.hidden = visibleContexts.length > 0;
    pageStatus.textContent =
      visibleContexts.length > 0
        ? `${visibleContexts.length} ${visibleContexts.length === 1 ? "deal" : "deals"} available to view.`
        : "No approved deals are published right now.";
  } catch (error) {
    console.error("ASP deals configuration error:", error);
    emptyState.hidden = false;
    emptyState.querySelector("h2").textContent =
      "Deals could not be loaded";
    emptyState.querySelector("p").textContent =
      "Try again later. No unsafe link was displayed.";
    pageStatus.textContent =
      "Error loading the Deals page.";
  }
}

renderDealsPage();
