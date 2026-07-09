/**
 * Shared inventory bucketing logic — single source of truth for mapping order
 * items onto the Journalier / Frais (four) inventory rows.
 *
 * Used by:
 *   - order.controller.ts  (when an order is created → applyToInventory)
 *   - dailyInventory.controller.ts (recompute the CLIENT column from live orders)
 *
 * Keep JOURNALIER_PRODUCTS in sync with PRODUITS_PAR_DEFAUT in the frontend
 * InventaireJournalier.tsx, and FOUR_PRODUCTS with PRODUITS_FOUR_DEFAUT in
 * InventaireFour.tsx — names must match exactly so items land on the right row.
 */

export const JOURNALIER_PRODUCTS = [
  "Croissant", "Chocolatine", "Danoise framboises", "Danoise aux raisins",
  "Chausson aux pommes", "Abricotine", "Palmier", "Frangipane",
  "Croissant amandes", "Chocolatine aux amandes", "Croissant pistache", "Brioche aux sucres",
  "Danoise cannelle", "Biscuit chocolat", "Croissant aux fromages", "Brioche suisse",
  "Quiche jambon et fromage", "Quiche jambon et fromage grande", "Quiche épinard et fromage",
  "Quiche épinard grande", "Quiche poireaux fromage de chèvre", "Quiche poireaux fromage de chèvre grande",
  "Tropezienne", "Tropézienne fraises", "Tourte provençal", "Tourte gibier",
  "Pizza", "Quiche aux deux saumons grande", "Quiche aux deux saumons", "Pâté au poulet",
  "Pâté poulet grand", "Pâté au saumon", "Pâté saumon grand",
  "Tourtière", "Tourtière grand", "Croque monsieur", "Croque végé",
  "Plat cuisiné", "Soupe 1Litre", "Soupe", "SUPPLÉMENT :",
];

export const FOUR_PRODUCTS = [
  "Éclair chantilly", "Éclair chocolat", "Éclair pistache", "Mille-feuilles",
  "Tartelette aux fraise", "Tartelette fruits", "Crème brulée", "Tarte aux fraises",
  "Tarte aux fruits", "Tropézienne", "Tropézienne fraises", "Mini pâtisserie",
];

const STOPWORDS = new Set([
  "aux", "au", "a", "de", "du", "des", "le", "la", "les", "et", "l",
]);
const stripPlural = (w: string) =>
  w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w;

/**
 * Canonical, space-less normalized form of a product name. Spelling variants
 * that differ only by a space/hyphen/plural/article collapse to the same token
 * ("Mille-feuilles" === "Millefeuille"), while genuinely different products stay
 * distinct because they carry different words ("croissant" vs "croissantfromage").
 */
export const normalizeProductName = (s: string): string =>
  String(s)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[-''`]/g, " ")
    .replace(/[^a-z0-9\s.]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOPWORDS.has(w))
    .map(stripPlural)
    .join("")
    .trim();

const matchesList = (productName: string, list: string[]): boolean => {
  const n = normalizeProductName(productName);
  return list.some(
    (known) =>
      normalizeProductName(known) === n ||
      normalizeProductName(known).includes(n) ||
      n.includes(normalizeProductName(known)),
  );
};

/**
 * Resolve a product to the EXACT inventory-sheet name (exact normalized match),
 * so quantities land on the existing row instead of an orphan row.
 */
const canonicalName = (productName: string, list: string[]): string | undefined => {
  const n = normalizeProductName(productName);
  return list.find((known) => normalizeProductName(known) === n);
};

// Specialty pizzas don't each get their own row — they all aggregate into the
// single "Pizza" line (La reine + La végé + L'alsacienne → Pizza = 3).
const PIZZA_ALIASES = ["La reine", "La végé", "L'alsacienne", "La provençale"];
const pizzaAliasSet = new Set(PIZZA_ALIASES.map((p) => normalizeProductName(p)));

export interface InventoryItem {
  productName?: string;
  quantity?: number;
}

/**
 * Bucket order items into Journalier vs Frais (four) quantities, keyed by the
 * canonical sheet name. A product that exists in BOTH sheets (e.g. Tropézienne)
 * counts in both. For a fuzzy-only match (slightly different name, no exact
 * match), Frais wins — as before.
 *
 * `journalierList` / `fourList` default to the hardcoded constants, but callers
 * pass in the LIVE editable lists (the names Fanny maintains in the inventory
 * screens, persisted in the `__products_config_*` sentinels). That way, when
 * she renames a row to match the site's product name, order quantities land on
 * THAT row — no more orphan rows appearing at the bottom of the sheet.
 */
export function computeInventoryBuckets(
  items: InventoryItem[],
  journalierList: string[] = JOURNALIER_PRODUCTS,
  fourList: string[] = FOUR_PRODUCTS,
): {
  journalierQty: Record<string, number>;
  fourQty: Record<string, number>;
} {
  const journalierQty: Record<string, number> = {};
  const fourQty: Record<string, number> = {};

  for (const item of items || []) {
    const rawName = item?.productName;
    if (!rawName) continue;
    const qty = item.quantity || 0;
    // Map any specialty pizza onto the shared "Pizza" row before matching.
    const productName = pizzaAliasSet.has(normalizeProductName(rawName))
      ? "Pizza"
      : rawName;

    // Exact (normalized) match in each list. Un produit présent dans LES DEUX
    // feuilles (ex. Tropézienne, qui est à la fois en Journalier et en Frais)
    // compte dans les DEUX — pas seulement Frais.
    const fourCanon = canonicalName(productName, fourList);
    const journalierCanon = canonicalName(productName, journalierList);

    if (fourCanon || journalierCanon) {
      if (fourCanon) fourQty[fourCanon] = (fourQty[fourCanon] || 0) + qty;
      if (journalierCanon)
        journalierQty[journalierCanon] = (journalierQty[journalierCanon] || 0) + qty;
    } else if (matchesList(productName, fourList)) {
      // Repli flou (nom légèrement différent, pas de correspondance exacte) :
      // Frais prioritaire, comme avant.
      fourQty[productName] = (fourQty[productName] || 0) + qty;
    } else if (matchesList(productName, journalierList)) {
      journalierQty[productName] = (journalierQty[productName] || 0) + qty;
    }
    // else: custom/untracked product — not part of either feuille.
  }

  return { journalierQty, fourQty };
}
