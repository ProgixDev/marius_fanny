/**
 * Dates de SERVICE (ramassage / livraison).
 *
 * `deliveryDate` arrive du backend sous forme de chaîne « YYYY-MM-DD » : c'est
 * un JOUR CALENDAIRE, pas un instant. Or `new Date("2026-08-14")` est lu par
 * JavaScript comme minuit **UTC** ; formaté avec `timeZone: "America/Montreal"`
 * (UTC-4) ça retombe sur le 13 août 20 h. Une livraison du 14 s'affichait donc
 * « 13 août » dans le back office, alors que la note de la commande disait bien
 * le 14 — d'où les appels de clients.
 *
 * On ancre la journée à MIDI UTC : le jour calendaire reste correct dans tous
 * les fuseaux de ±11 h, heure avancée comprise.
 */
export function parseServiceDate(
  value?: string | Date | null,
): Date | null {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const raw = String(value).trim();
  if (!raw) return null;
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? new Date(`${raw}T12:00:00Z`)
    : new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Formate une date de service en jour seul (Montréal). */
export function formatServiceDate(
  value?: string | Date | null,
  options: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "short",
    day: "numeric",
  },
  locale = "fr-CA",
): string {
  const date = parseServiceDate(value);
  if (!date) return "—";
  return date.toLocaleDateString(locale, {
    ...options,
    timeZone: "America/Montreal",
  });
}
