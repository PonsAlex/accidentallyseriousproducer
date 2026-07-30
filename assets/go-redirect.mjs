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
  status.textContent = "Oferta indisponível";
  details.textContent = message;
  document.querySelector("#go-action").hidden = true;
}

async function resolveGoLink() {
  const linkId = readLinkId();
  if (!linkId) {
    showUnavailable("O identificador do link é inválido.");
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
        "Este destino não está ativo ou aguarda revisão. Volte à página anterior para consultar outras ofertas."
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

    status.textContent = `Continuar para ${program.name}`;
    details.textContent =
      `O destino validado pertence a ${destinationUrl.hostname}. ` +
      "O ASP não altera o preço ou o conteúdo exibido pela loja.";
    disclosure.textContent = AFFILIATE_DISCLOSURE.short;
    disclosure.hidden = false;
    action.href = destination;
    action.textContent = `Continuar para ${program.name}`;
    action.hidden = false;
  } catch (error) {
    showUnavailable(
      "Não foi possível validar este destino agora. Nenhum redirecionamento foi realizado."
    );
    console.error("ASP /go/ configuration error:", error);
  }
}

resolveGoLink();
