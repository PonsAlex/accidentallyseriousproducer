const DATA_PATHS = Object.freeze({
  affiliatePrograms: "/data/affiliate-programs.json",
  affiliateLinks: "/data/affiliate-links.json",
  products: "/data/products.json",
  promotions: "/data/promotions.json"
});

let dataPromise;

async function fetchJson(path) {
  const response = await fetch(path, {
    headers: {
      Accept: "application/json"
    },
    cache: "no-cache",
    credentials: "same-origin"
  });

  if (!response.ok) {
    throw new Error(
      `Não foi possível carregar ${path} (${response.status}).`
    );
  }

  const value = await response.json();
  if (!Array.isArray(value)) {
    throw new TypeError(`${path} deve conter um array JSON.`);
  }

  return value;
}

export function loadAffiliateData({ refresh = false } = {}) {
  if (!dataPromise || refresh) {
    dataPromise = Promise.all(
      Object.entries(DATA_PATHS).map(async ([key, path]) => [
        key,
        await fetchJson(path)
      ])
    ).then((entries) => Object.fromEntries(entries));
  }

  return dataPromise;
}
