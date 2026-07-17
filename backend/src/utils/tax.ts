import { Product } from "../models/Product.js";

// Taux de taxe du Québec.
export const TPS_RATE = 0.05; // Taxe fédérale (TPS/GST)
export const TVQ_RATE = 0.09975; // Taxe provinciale (TVQ/QST)
// Taux combiné, conservé pour l'affichage/compat (ex. TAX_RATE historique).
export const TAX_RATE = TPS_RATE + TVQ_RATE; // 0.14975

/**
 * Mode de taxe d'un produit :
 * - "both"     → TPS + TVQ (14,975 %) — cas normal
 * - "gst_only" → TPS seulement (5 %) — produits visés par la loi retirant la TVQ
 *                (pâtisseries individuelles, viennoiseries)
 * - "none"     → aucune taxe (0 %)
 */
export type TaxMode = "both" | "gst_only" | "none";

/** Déduit le mode de taxe d'une fiche produit (compat avec l'ancien hasTaxes). */
export function productTaxMode(p: any): TaxMode {
  const m = p?.taxMode;
  if (m === "both" || m === "gst_only" || m === "none") return m;
  // Ancien champ booléen : taxé = les deux taxes, sinon aucune.
  if (p?.hasTaxes === false) return "none";
  return "both";
}

export interface TaxableItem {
  productId: number;
  quantity: number;
  amount: number;
  /** Article personnalisé (productId <= 0) : taxé par défaut si non précisé. */
  taxable?: boolean;
}

export interface TaxBreakdown {
  tps: number;
  tvq: number;
  total: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Calcule TPS et TVQ SÉPARÉMENT pour une liste d'articles — source unique pour
 * les commandes, les commandes pro et les soumissions.
 *
 * Règles :
 * - Un vrai produit suit son `taxMode` (both / gst_only / none).
 * - Viennoiseries / pâtisseries : exonérées (0 taxe) dès 6 unités et plus au
 *   total — règle fiscale des produits de boulangerie, conservée telle quelle.
 * - Article personnalisé (productId <= 0) : `taxable` → both, sinon none.
 */
export async function computeTaxBreakdown(items: TaxableItem[]): Promise<TaxBreakdown> {
  const ids = Array.from(new Set(items.map((i) => i.productId).filter((id) => id > 0)));
  const products = ids.length
    ? await Product.find({ id: { $in: ids }, deletedAt: { $exists: false } })
        .select("id category productionType hasTaxes taxMode")
        .lean()
    : [];
  const productMap = new Map<number, any>(products.map((p: any) => [p.id, p]));

  const categoryText = (category: unknown) => {
    if (Array.isArray(category)) return category.join(" ").toLowerCase();
    return String(category || "").toLowerCase();
  };
  const isPatisserieProduct = (p: any) =>
    p?.productionType === "patisserie" || categoryText(p?.category).includes("tisser");
  const isViennoiserieProduct = (p: any) => categoryText(p?.category).includes("viennoiser");

  const bakedGoodsCount = items.reduce((sum, item) => {
    const p = productMap.get(item.productId);
    if (!p) return sum;
    return isViennoiserieProduct(p) || isPatisserieProduct(p) ? sum + (item.quantity || 0) : sum;
  }, 0);
  const bakedGoodsExempt = bakedGoodsCount >= 6;

  let tps = 0;
  let tvq = 0;
  for (const item of items) {
    const amount = item.amount || 0;

    // Article personnalisé : pas de fiche produit à consulter.
    if ((item.productId || 0) <= 0) {
      const taxable = item.taxable !== undefined ? !!item.taxable : true;
      if (taxable) {
        tps += amount * TPS_RATE;
        tvq += amount * TVQ_RATE;
      }
      continue;
    }

    const p = productMap.get(item.productId);
    const isBakedGood = isViennoiserieProduct(p) || isPatisserieProduct(p);
    // Règle des 6 : viennoiseries/pâtisseries exonérées à 6 unités et plus.
    if (isBakedGood && bakedGoodsExempt) continue;

    const mode = productTaxMode(p);
    if (mode === "both") {
      tps += amount * TPS_RATE;
      tvq += amount * TVQ_RATE;
    } else if (mode === "gst_only") {
      tps += amount * TPS_RATE;
    }
    // "none" → rien
  }

  tps = round2(tps);
  tvq = round2(tvq);
  return { tps, tvq, total: round2(tps + tvq) };
}

/**
 * Compat : renvoie uniquement le montant total de taxe. Les nouveaux appels
 * devraient utiliser computeTaxBreakdown pour obtenir TPS et TVQ séparées.
 */
export async function computeTaxAmount(items: TaxableItem[]): Promise<number> {
  return (await computeTaxBreakdown(items)).total;
}
