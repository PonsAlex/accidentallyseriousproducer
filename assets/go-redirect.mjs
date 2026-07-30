import {
  AFFILIATE_DISCLOSURE,
  AFFILIATE_ID_PATTERN,
  resolveAffiliateDestination
} from "./affiliate-core.mjs";
import { loadAffiliateData } from "./affiliate-data.mjs";

function readLinkId() {
  const match = window.location.pathname.match(/^\/go\/([^/]+)\/?$/);
  if (!match) {
    return null;
  }

  try {
    const value = decodeURIComponent(match[1]);
    return AFFILIATE_ID_PATTERN.test(value) ? value : null;
  } catch {
    return null;
  }
}

function showUnavailable(message) {
  const status = document.querySelector("#go-status");
  const details = document.querySelector("#go-details");
  status.textContent = "Offer unavailable";
  details.textContent = message;
  document.querySelector("#go-action").hidden = true;
}

async function resolveGoLink() {
  const linkId = readLinkId();
  if (!linkId) {
    showUnavailable(
      "This deal is no longer available, has not been approved for publication, or does not exist. No redirect will occur."
    );
    console.error("ASP /go/ configuration error: invalid link identifier.");
    return;
  }

  try {
    const data = await loadAffiliateData();
    const link = data.affiliateLinks.find((entry) => entry.id === linkId);
    const program = data.affiliatePrograms.find(
      (entry) => entry.id === link?.programId
    );
    const destination = resolveAffiliateDestination(link);

    if (!link || !program || program.status !== "active" || !destination) {
      showUnavailable(
        "This deal is no longer available, has not been approved for publication, or does not exist. No redirect will occur."
      );
      console.error(
        `ASP /go/ configuration error: unresolved destination for "${linkId}".`
      );
      return;
    }

    const destinationUrl = new URL(destination);
    const status = document.querySelector("#go-status");
    const details = document.querySelector("#go-details");
    const action = document.querySelector("#go-action");
    const disclosure = document.querySelector("#go-disclosure");

    status.textContent = `Continue to ${program.name}`;
    details.textContent =
      `The validated destination belongs to ${destinationUrl.hostname}. ` +
      "ASP does not change the price or content shown by the store.";
    disclosure.textContent = AFFILIATE_DISCLOSURE.short;
    disclosure.hidden = false;
    action.href = destination;
    action.textContent = `Continue to ${program.name}`;
    action.hidden = false;
  } catch (error) {
    showUnavailable(
      "This destination could not be checked right now. No redirect occurred."
    );
    console.error("ASP /go/ configuration error:", error);
  }
}

resolveGoLink();
