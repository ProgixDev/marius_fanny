/**
 * Lien propre à chaque produit : /produit/<slug>
 *
 * Fanny fait la promotion d'un produit sur les réseaux sociaux (la bûche de
 * Noël, par exemple) et veut un lien qui ouvre CE produit. Jusqu'ici tout le
 * catalogue vivait sous la même adresse : les gens arrivaient sur la boutique
 * et devaient chercher l'article.
 *
 * Le repère est calculé à partir du NOM du produit — rien à saisir, rien à
 * stocker : « Bûche de Noël » → « buche-de-noel ». Si le nom change, l'ancien
 * lien ne pointe plus sur rien : le lien par numéro (/produit/42) reste alors
 * une porte de secours, et c'est celui que le back office propose de copier.
 */

/** « Bûche de Noël » → « buche-de-noel ». */
export const productSlug = (name: string): string =>
  String(name || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // accents
    .toLowerCase()
    .replace(/['’`]/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/**
 * Retrouve un produit à partir du morceau d'URL. Accepte le nom en clair
 * (« buche-de-noel ») comme le numéro du produit (« 42 »), et tolère un suffixe
 * de numéro (« buche-de-noel-42 ») pour départager deux produits homonymes.
 */
export const findProductBySlug = <T extends { id: number; name: string }>(
  products: T[],
  slug: string,
): T | undefined => {
  const wanted = productSlug(slug);
  if (!wanted) return undefined;

  const byName = products.find((p) => productSlug(p.name) === wanted);
  if (byName) return byName;

  // « …-42 » ou « 42 » : on se rabat sur le numéro du produit.
  const idMatch = wanted.match(/(?:^|-)(\d+)$/);
  if (idMatch) {
    const id = Number(idMatch[1]);
    const byId = products.find((p) => p.id === id);
    if (byId) return byId;
  }
  return undefined;
};

/**
 * Lien complet à copier-coller dans une publication.
 *
 * `withId` ajoute le numéro du produit (« /produit/fraisier-180 ») : c'est
 * nécessaire quand deux produits portent le même nom, sinon le lien ouvrirait
 * toujours le premier des deux.
 */
export const productUrl = (
  product: { id: number; name: string },
  options: { withId?: boolean } = {},
): string => {
  const base = productSlug(product.name);
  const slug = !base ? String(product.id) : options.withId ? `${base}-${product.id}` : base;
  const origin =
    typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : "https://mariusetfanny.com";
  return `${origin}/produit/${slug}`;
};
