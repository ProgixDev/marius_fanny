/**
 * Numéros d'inscription aux taxes — SOURCE UNIQUE.
 *
 * Ils étaient recopiés en dur dans 9 fichiers (courriels, PDF, pages web,
 * descriptions Square) : les changer supposait de tous les retrouver, et un
 * seul oubli suffisait à faire circuler une facture avec un mauvais numéro.
 *
 * Ils vivent désormais dans les réglages, modifiables par un administrateur
 * sans intervention de développeur. Le cache évite d'interroger la base à
 * chaque ligne de facture rendue ; il est rafraîchi au démarrage et à chaque
 * enregistrement des réglages.
 */

/** Valeurs actuelles de Marius & Fanny, servant aussi de repli. */
export const DEFAULT_TPS_NUMBER = "144652641RT001";
export const DEFAULT_TVQ_NUMBER = "1201862732TQ0001";

let cache = {
  tps: DEFAULT_TPS_NUMBER,
  tvq: DEFAULT_TVQ_NUMBER,
};

/** Numéros à afficher sur les factures. Jamais vide : repli sur les défauts. */
export function getTaxNumbers(): { tps: string; tvq: string } {
  return cache;
}

/** Met le cache à jour (démarrage du serveur, enregistrement des réglages). */
export function setTaxNumbers(next: { tps?: string | null; tvq?: string | null }): void {
  cache = {
    tps: (next.tps || "").trim() || DEFAULT_TPS_NUMBER,
    tvq: (next.tvq || "").trim() || DEFAULT_TVQ_NUMBER,
  };
}

/**
 * Intitulés des lignes de taxe, numéro d'inscription compris.
 * Format demandé : « TPS (144652641RT001) ».
 */
export function taxLabels(): { tps: string; tvq: string } {
  const { tps, tvq } = getTaxNumbers();
  return {
    tps: `TPS (${tps})`,
    tvq: `TVQ (${tvq})`,
  };
}
