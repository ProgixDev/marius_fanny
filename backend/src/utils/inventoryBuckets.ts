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
  "Danoise cannelle", "Biscuit choco", "Croissant aux fromages", "Brioche suisse",
  "Quiche jambon et fromage", "Qui. jambon grand", "Quiche épinard et fromage",
  "Qui. épinard grand", "Quiche poireaux fromage de chèvre", "Qui. poireaux grand",
  "Tropezienne", "Tropezienne fraise", "Tourte provençal", "Tourte gibier",
  "Pizza", "Quiche saumon gr", "Quiche aux deux saumons", "Pâté au poulet",
  "Pâté poulet grand", "Pâté au saumon", "Pâté saumon grand",
  "Tourtière", "Tourtière grand", "Croque monsieur", "Croque végé",
  "Plat cuisiné", "Soupe 1Litre", "Soupe", "SUPPLÉMENT :",
];

export const FOUR_PRODUCTS = [
  "Éclair chantilly", "Éclair chocolat", "Éclair pistache", "Mille-feuilles",
  "Tartelette aux fraise", "Tartelette fruits", "Crème brulée", "Tarte aux fraises",
  "Tarte aux fruits", "Tropézienne", "Trop. fraise", "Mini pâtisserie",
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
 * canonical sheet name. Frais wins on ambiguous matches.
 */
export function computeInventoryBuckets(items: InventoryItem[]): {
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
    if (matchesList(productName, FOUR_PRODUCTS)) {
      const name = canonicalName(productName, FOUR_PRODUCTS) || productName;
      fourQty[name] = (fourQty[name] || 0) + qty;
    } else if (matchesList(productName, JOURNALIER_PRODUCTS)) {
      const name = canonicalName(productName, JOURNALIER_PRODUCTS) || productName;
      journalierQty[name] = (journalierQty[name] || 0) + qty;
    }
    // else: custom/untracked product — not part of either feuille.
  }

  return { journalierQty, fourQty };
}
