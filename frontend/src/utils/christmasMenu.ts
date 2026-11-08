/**
 * Menu de Noël — règle PURE et testable (voir scripts/test-christmas-menu.js).
 *
 * Les 23, 24, 30 et 31 décembre, la boutique ne sert QUE le menu de Noël. La
 * règle vaut dans les deux sens :
 *
 *   - ces quatre jours-là, aucun article hors menu de Noël n'est accepté ;
 *   - les articles du menu de Noël ne peuvent être commandés QUE ces jours-là.
 *
 * Le menu de Noël, c'est la catégorie « NOËL » du catalogue : Fanny y range ses
 * produits elle-même, exactement comme pour « OCTOBRE ROSE ». La comparaison
 * ignore les accents et la casse, pour que « Noel », « noël » ou « NOËL »
 * désignent la même section.
 *
 * Même règle partout — site public, prise de commande au back office et
 * serveur — pour qu'une commande impossible n'entre par aucune porte.
 */

export const CHRISTMAS_MENU_DATES = ["12-23", "12-24", "12-30", "12-31"];
export const CHRISTMAS_MENU_CATEGORY = "NOËL";

const MOIS = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];

/** Compare sans accents ni casse : « Noël », « NOEL » et « noel » sont égaux. */
const normalise = (value: unknown): string =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .trim();

/** « 12-23 » → « 23 décembre ». */
const enClair = (mmdd: string): string => {
  const m = String(mmdd || "").match(/^(\d{2})-(\d{2})$/);
  if (!m) return mmdd;
  const mois = MOIS[parseInt(m[1], 10) - 1] || "";
  return `${parseInt(m[2], 10)} ${mois}`.trim();
};

/** « les 23, 24, 30 et 31 décembre » — énumération lisible des dates permises. */
export const datesEnClair = (dates: string[] = CHRISTMAS_MENU_DATES): string => {
  const jours = dates
    .map((d) => String(d).match(/^(\d{2})-(\d{2})$/))
    .filter((m): m is RegExpMatchArray => !!m);
  if (jours.length === 0) return "";
  const meme = jours.every((m) => m[1] === jours[0][1]);
  if (!meme) return jours.map((m) => enClair(`${m[1]}-${m[2]}`)).join(", ");
  const mois = MOIS[parseInt(jours[0][1], 10) - 1] || "";
  const nums = jours.map((m) => String(parseInt(m[2], 10)));
  const dernier = nums.pop();
  return nums.length ? `les ${nums.join(", ")} et ${dernier} ${mois}` : `le ${dernier} ${mois}`;
};

/** La date de service tombe-t-elle sur une journée « menu de Noël » ? */
export function isChristmasMenuDate(
  serviceDate: string | null | undefined,
  dates: string[] = CHRISTMAS_MENU_DATES,
): boolean {
  const m = String(serviceDate || "").match(/^\d{4}-(\d{2}-\d{2})/);
  return !!m && dates.includes(m[1]);
}

/** Ce produit appartient-il au menu de Noël ? */
export function isChristmasMenuProduct(
  categories: unknown,
  categoryName: string = CHRISTMAS_MENU_CATEGORY,
): boolean {
  const voulue = normalise(categoryName);
  if (!voulue) return false;
  const liste = Array.isArray(categories) ? categories : [categories];
  return liste.some((c) => normalise(c) === voulue);
}

export interface MenuItemCheck {
  productName?: string;
  /** Le produit appartient-il à la catégorie « NOËL » ? */
  isChristmas: boolean;
}

/**
 * Vérifie l'accord entre la date de service et le contenu du panier.
 * Retourne le message à montrer, ou `null` si la commande est permise.
 */
export function checkChristmasMenu(params: {
  serviceDate: string | null | undefined;
  items: MenuItemCheck[];
  dates?: string[];
  categoryName?: string;
}): string | null {
  const dates = params.dates || CHRISTMAS_MENU_DATES;
  const items = params.items || [];
  if (items.length === 0) return null;

  const nomme = (liste: MenuItemCheck[]) => {
    const noms = Array.from(
      new Set(liste.map((i) => String(i.productName || "").trim()).filter(Boolean)),
    );
    if (noms.length === 0) return "";
    return ` À retirer : ${noms.join(", ")}.`;
  };

  const jourDeNoel = isChristmasMenuDate(params.serviceDate, dates);

  if (jourDeNoel) {
    const intrus = items.filter((i) => !i.isChristmas);
    if (intrus.length === 0) return null;
    const m = String(params.serviceDate || "").match(/^\d{4}-(\d{2}-\d{2})/);
    const jour = m ? enClair(m[1]) : "cette date";
    return (
      `Le ${jour}, seul le menu de Noël est servi : aucun autre article ne peut être commandé pour cette date.` +
      nomme(intrus)
    );
  }

  const deNoel = items.filter((i) => i.isChristmas);
  if (deNoel.length === 0) return null;
  return (
    `Le menu de Noël est servi uniquement ${datesEnClair(dates)}. Choisissez l'une de ces dates, ou retirez ces articles.` +
    nomme(deNoel)
  );
}
