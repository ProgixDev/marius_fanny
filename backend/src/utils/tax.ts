import { Product } from "../models/Product.js";

// Taux de taxe du Québec (TPS + TVQ).
export const TAX_RATE = 0.14975;

export interface TaxableItem {
  productId: number;
  quantity: number;
  amount: number;
  /** Utilisé uniquement pour les articles personnalisés (productId <= 0). */
  taxable?: boolean;
}

/**
 * Calcule les taxes d'une liste d'articles — SOURCE UNIQUE pour les commandes,
 * les commandes pro et les soumissions.
 *
 * Règles :
 * - Un vrai produit suit son drapeau `hasTaxes` (réglé dans la fiche produit).
 * - Viennoiseries / pâtisseries : exonérées dès 6 unités et plus au total
 *   (règle fiscale des produits de boulangerie).
 * - Article personnalisé (productId <= 0) : suit `taxable` (taxé par défaut).
 *
 * Ce calcul était auparavant dupliqué dans chaque contrôleur, et la copie des
 * soumissions ignorait `hasTaxes` — un produit non taxable y était donc taxé.
 */
export async function computeTaxAmount(items: TaxableItem[]): Promise<number> {
  const ids = Array.from(new Set(items.map((i) => i.productId).filter((id) => id > 0)));
  const products = ids.length
    ? await Product.find({ id: { $in: ids }, deletedAt: { $exists: false } })
        .select("id category productionType hasTaxes")
        .lean()
    : [];
  const productMap = new Map<number, any>(products.map((p: any) => [p.id, p]));

  const categoryText = (category: unknown) => {
    if (Array.isArray(category)) return category.join(" ").toLowerCase();
    return String(category || "").toLowerCase();
  };

  const isPatisserieProduct = (p: any) =>
    p?.productionType === "patisserie" || categoryText(p?.category).includes("patisser");
  const isViennoiserieProduct = (p: any) => categoryText(p?.category).includes("viennoiser");

  const bakedGoodsCount = items.reduce((sum, item) => {
    const p = productMap.get(item.productId);
    if (!p) return sum;
    return isViennoiserieProduct(p) || isPatisserieProduct(p) ? sum + (item.quantity || 0) : sum;
  }, 0);

  const bakedGoodsExempt = bakedGoodsCount >= 6;

  return items.reduce((sum, item) => {
    // Article personnalisé : pas de fiche produit à consulter.
    if ((item.productId || 0) <= 0) {
      const customItemTaxable = item.taxable !== undefined ? !!item.taxable : true;
      if (!customItemTaxable) return sum;
      return sum + (item.amount || 0) * TAX_RATE;
    }

    const p = productMap.get(item.productId);
    const isBakedGood = isViennoiserieProduct(p) || isPatisserieProduct(p);
    const hasTaxes = p?.hasTaxes !== undefined ? !!p.hasTaxes : true;
    const itemIsTaxable = isBakedGood ? hasTaxes && !bakedGoodsExempt : hasTaxes;

    if (!itemIsTaxable) return sum;
    return sum + (item.amount || 0) * TAX_RATE;
  }, 0);
}
