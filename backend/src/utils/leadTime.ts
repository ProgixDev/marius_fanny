/**
 * Date de service la plus tôt possible — logique PURE et testable.
 *
 * Deux règles se combinent :
 *  - le délai de préparation du produit le plus lent de la commande ;
 *  - l'heure limite de 14 h : passé cette heure, ce qui devait partir demain
 *    part après-demain.
 *
 * La seconde ne concerne QUE ce qui pourrait être servi dès demain. Un produit
 * demandant 2 jours de préparation ne sort pas avant après-demain de toute
 * façon : lui appliquer la pénalité le repoussait d'un jour sans raison, et le
 * CRM refusait les commandes passées après 14 h. Commandé lundi à 13 h, 15 h ou
 * 18 h, un produit à 48 h reste récupérable mercredi.
 */

/** Nombre de jours de préparation à partir d'un délai exprimé en heures. */
export function preparationDays(maxPrepHours: number): number {
  return Math.ceil((maxPrepHours || 0) / 24);
}

/**
 * L'heure limite s'applique-t-elle à cette commande ?
 * Uniquement lorsqu'elle pourrait être servie dès le lendemain.
 */
export function cutoffApplies(prepDays: number, pastCutoff: boolean): boolean {
  return pastCutoff && prepDays <= 1;
}

/**
 * Date de service minimale, au format « YYYY-MM-DD ».
 * `todayStr` est la date du jour à Montréal, au même format.
 */
export function minimumServiceDate(
  todayStr: string,
  prepDays: number,
  pastCutoff: boolean,
): string {
  const [y, m, d] = todayStr.split("-").map((s) => parseInt(s, 10));
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + prepDays + (cutoffApplies(prepDays, pastCutoff) ? 1 : 0));
  return date.toISOString().split("T")[0];
}
