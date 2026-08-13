/**
 * Dates de SERVICE (ramassage / livraison).
 *
 * `deliveryDate` est stockée comme une chaîne « YYYY-MM-DD » : c'est un JOUR
 * CALENDAIRE, pas un instant. Or `new Date("2026-08-14")` est interprété par
 * JavaScript comme minuit **UTC** ; reprojeté en heure de Montréal (UTC-4) ça
 * donne le 13 août à 20 h. Tout affichage passant par `toLocaleDateString(...,
 * { timeZone: "America/Montreal" })` reculait donc d'un jour : une livraison du
 * 14 s'affichait « 13 août » dans le back office ET dans le courriel du client,
 * alors que la note de commande (texte brut) disait bien le 14 — d'où les
 * appels de clients.
 *
 * On ancre donc la journée à MIDI UTC : le jour calendaire reste identique dans
 * tous les fuseaux de ±11 h, heure avancée comprise.
 */
export function parseServiceDate(
  value?: string | Date | null,
): Date | undefined {
  if (!value) return undefined;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value;
  }
  const raw = String(value).trim();
  if (!raw) return undefined;
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? new Date(`${raw}T12:00:00Z`)
    : new Date(raw);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/**
 * Date à laquelle la commande est réellement servie, quel que soit son type :
 * `pickupDate` pour un ramassage, `deliveryDate` pour une livraison. Les
 * courriels client doivent TOUS passer par ici, sinon une commande en livraison
 * (qui n'a pas forcément de `pickupDate`) part sans aucune date.
 */
export function orderServiceDate(order: {
  deliveryType?: string;
  pickupDate?: Date | string | null;
  deliveryDate?: string | null;
}): Date | undefined {
  if (!order) return undefined;
  return order.deliveryType === "delivery"
    ? parseServiceDate(order.deliveryDate) || parseServiceDate(order.pickupDate)
    : parseServiceDate(order.pickupDate) || parseServiceDate(order.deliveryDate);
}
