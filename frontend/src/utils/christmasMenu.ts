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

/**
 * Le « menu des fêtes » n'est pas UNE catégorie mais une FAMILLE : la section
 * « Menu de Noël » et ses trois sous-sections. Un produit en fait partie dès
 * qu'il porte l'une d'elles. « Menu des fêtes » est un ancien nom resté sur un
 * produit (le menu à 68,95 $) : il compte aussi, sans quoi ce menu-là serait
 * refusé les jours de fête — exactement ce qui est arrivé le 12 novembre 2026.
 */
export const CHRISTMAS_MENU_CATEGORIES = [
  "Menu de Noël",
  "Menu des fêtes",
  "Menu festif",
  "Traiteur des fêtes",
  "Bûches et gâteaux des fêtes",
];

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

/** Ce produit appartient-il au menu des fêtes ? */
export function isChristmasMenuProduct(
  categories: unknown,
  categoryNames: string[] = CHRISTMAS_MENU_CATEGORIES,
): boolean {
  const voulues = new Set(categoryNames.map(normalise).filter(Boolean));
  if (voulues.size === 0) return false;
  const liste = Array.isArray(categories) ? categories : [categories];
  return liste.some((c) => voulues.has(normalise(c)));
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
  /**
   * Interdire aussi le menu des fêtes EN DEHORS de ces dates. Désactivé : 33
   * des 46 produits de la section se vendent toute l'année (plateaux, salades,
   * Paris-Brest, macarons…) parce qu'ils portent À LA FOIS une catégorie
   * festive et une catégorie ordinaire. Les bloquer hors fêtes couperait des
   * ventes courantes. À rouvrir quand Fanny aura dit quels articles précis
   * doivent être réservés aux quatre dates.
   */
  restrictFestiveToDates?: boolean;
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
      `Le ${jour}, seul le menu des fêtes est servi : aucun autre article ne peut être commandé pour cette date.` +
      nomme(intrus)
    );
  }

  if (!params.restrictFestiveToDates) return null;

  const deNoel = items.filter((i) => i.isChristmas);
  if (deNoel.length === 0) return null;
  return (
    `Le menu des fêtes est servi uniquement ${datesEnClair(dates)}. Choisissez l'une de ces dates, ou retirez ces articles.` +
    nomme(deNoel)
  );
}

/** Nom de la section parente qui regroupe tout le menu des fêtes. */
export const CHRISTMAS_MENU_ROOT = "Menu de Noël";

/** Une catégorie, telle que la renvoie la base (plate) ou l'API (arborescente). */
export interface CategoryLike {
  id?: number | string;
  name?: string;
  title?: string;
  parentId?: number | string | null;
  children?: CategoryLike[];
}

const nomDe = (c: CategoryLike): string => String(c?.title ?? c?.name ?? "").trim();

/**
 * Tous les noms de sections qui composent le menu des fêtes : la section
 * parente et TOUTES ses descendantes.
 *
 * Fanny ajoute et retire des sous-sections elle-même ; les lire dans
 * l'arborescence lui évite de dépendre de moi à chaque fois. Son menu à
 * 68,95 $ avait justement été refusé le 31 décembre parce que sa section
 * n'était pas dans une liste figée.
 *
 * Accepte les deux formes : la liste plate de la base (`parentId`) et
 * l'arborescence de l'API (`children`). Retourne une liste VIDE si la section
 * parente est introuvable — l'appelant retombe alors sur les noms connus,
 * plutôt que de ne plus rien reconnaître du tout.
 */
export function collectChristmasCategoryNames(
  categories: CategoryLike[] | null | undefined,
  rootName: string = CHRISTMAS_MENU_ROOT,
): string[] {
  const liste = Array.isArray(categories) ? categories : [];
  if (liste.length === 0) return [];

  // Aplatir l'arborescence si l'API l'a renvoyée imbriquée.
  const plat: CategoryLike[] = [];
  const aplatir = (nodes: CategoryLike[], parent?: CategoryLike["id"]) => {
    for (const n of nodes || []) {
      plat.push({ ...n, parentId: n.parentId ?? parent ?? null });
      if (Array.isArray(n.children) && n.children.length) aplatir(n.children, n.id);
    }
  };
  aplatir(liste);

  const racine = plat.find((c) => normalise(nomDe(c)) === normalise(rootName));
  if (!racine) return [];

  const noms = new Set<string>([nomDe(racine)]);
  const aExplorer = [racine.id];
  while (aExplorer.length) {
    const parent = aExplorer.shift();
    if (parent === undefined || parent === null) continue;
    for (const c of plat) {
      if (c.parentId === undefined || c.parentId === null) continue;
      if (String(c.parentId) !== String(parent)) continue;
      const nom = nomDe(c);
      if (!nom || noms.has(nom)) continue;
      noms.add(nom);
      aExplorer.push(c.id);
    }
  }
  return [...noms].filter(Boolean);
}

/**
 * Noms à utiliser pour reconnaître le menu des fêtes : ceux lus dans
 * l'arborescence, complétés des noms connus (dont « Menu des fêtes », ancien
 * nom resté sur un produit). Si l'arborescence est indisponible, les noms
 * connus prennent le relais — on ne se retrouve jamais à ne rien reconnaître.
 */
export function resolveChristmasCategoryNames(
  categories?: CategoryLike[] | null,
  rootName: string = CHRISTMAS_MENU_ROOT,
): string[] {
  const trouves = collectChristmasCategoryNames(categories, rootName);
  return [...new Set([...trouves, ...CHRISTMAS_MENU_CATEGORIES])];
}
