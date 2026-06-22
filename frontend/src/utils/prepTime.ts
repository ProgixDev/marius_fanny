/**
 * Délai de préparation EFFECTIF utilisé pour valider les créneaux.
 *
 * L'affichage garde la valeur réelle du produit (24h / 48h / 72h…), mais le
 * délai réellement exigé est réduit de 7h par tranche de 24h. Ainsi une commande
 * passée avant l'heure limite peut quand même être ramassée tôt le lendemain
 * matin, au lieu d'être repoussée à la même heure que la commande.
 *
 *   24h → 17h, 48h → 34h, 72h → 51h, 168h → 119h
 *
 * (La date minimum, elle, reste calculée sur la valeur réelle — ceil(h/24) jours —
 *  donc 24h = demain, 48h = +2 jours, etc. ne change pas. Et la limite 14h reste.)
 */
export function effectivePrepHours(hours?: number | null): number {
  const h = Number(hours) || 0;
  if (h <= 0) return 0;
  return Math.max(0, h - 7 * Math.ceil(h / 24));
}
