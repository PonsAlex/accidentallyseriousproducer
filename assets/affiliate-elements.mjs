import {
  AFFILIATE_DISCLOSURE,
  renderAffiliateOffer,
  selectPromotion
} from "./affiliate-core.mjs";
import { loadAffiliateData } from "./affiliate-data.mjs";

function attributeIsEnabled(element, name) {
  if (!element.hasAttribute(name)) {
    return false;
  }

  return element.getAttribute(name) !== "false";
}

function isDebugMode(element) {
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
    attributeIsEnabled(element, "debug") ||
    document.documentElement.dataset.environment === "development" ||
    params.get("affiliateDebug") === "1"
  );
}

export class AffiliateOfferElement extends HTMLElement {
  static observedAttributes = [
    "promotion-id",
    "product-id",
    "compact",
    "show-disclosure",
    "debug"
  ];

  connectedCallback() {
    this.render();
  }

  attributeChangedCallback() {
    if (this.isConnected) {
      this.render();
    }
  }

  async render() {
    const renderToken = Symbol("affiliate-render");
    this.renderToken = renderToken;
    this.setAttribute("aria-busy", "true");

    try {
      const data = await loadAffiliateData();
      if (this.renderToken !== renderToken) {
        return;
      }

      const debug = isDebugMode(this);
      const context = selectPromotion(
        {
          promotionId: this.getAttribute("promotion-id"),
          productId: this.getAttribute("product-id")
        },
        data,
        new Date(),
        { includeReview: debug }
      );

      const markup = context
        ? renderAffiliateOffer({
            ...context,
            currentDate: new Date(),
            compact: attributeIsEnabled(this, "compact"),
            showDisclosure: attributeIsEnabled(this, "show-disclosure"),
            debug
          })
        : debug
          ? '<p class="affiliate-config-error" role="status">REVIEW REQUIRED: oferta não encontrada.</p>'
          : "";

      this.innerHTML = markup;
      this.hidden = markup === "";
      this.dispatchEvent(
        new CustomEvent("affiliate-offer-rendered", {
          bubbles: true,
          detail: {
            promotionId: context?.promotion?.id ?? null,
            state: context?.state ?? null
          }
        })
      );
    } catch (error) {
      console.error("ASP affiliate offer configuration error:", error);
      this.innerHTML = isDebugMode(this)
        ? '<p class="affiliate-config-error" role="alert">REVIEW REQUIRED: os dados da oferta não puderam ser carregados.</p>'
        : "";
      this.hidden = !isDebugMode(this);
    } finally {
      this.removeAttribute("aria-busy");
    }
  }
}

export class AffiliateDisclosureElement extends HTMLElement {
  connectedCallback() {
    const aside = document.createElement("aside");
    const paragraph = document.createElement("p");
    const short = attributeIsEnabled(this, "short");

    aside.className =
      `affiliate-disclosure${short ? " affiliate-disclosure--short" : ""}`;
    aside.setAttribute("role", "note");
    aside.setAttribute(
      "aria-label",
      "Transparência sobre links afiliados"
    );
    paragraph.textContent = short
      ? AFFILIATE_DISCLOSURE.short
      : AFFILIATE_DISCLOSURE.full;
    aside.append(paragraph);
    this.replaceChildren(aside);
  }
}

if (!customElements.get("affiliate-offer")) {
  customElements.define("affiliate-offer", AffiliateOfferElement);
}

if (!customElements.get("affiliate-disclosure")) {
  customElements.define(
    "affiliate-disclosure",
    AffiliateDisclosureElement
  );
}
