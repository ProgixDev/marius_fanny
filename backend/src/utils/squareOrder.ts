import { computeItemTaxModes, TPS_RATE, TVQ_RATE } from "./tax.js";

/**
 * Construction du corps de commande Square — SOURCE UNIQUE.
 *
 * Historiquement, deux fonctions de `payment.controller.ts` construisaient ce
 * payload avec un copier-coller quasi identique, et toutes deux poussaient la
 * TPS et la TVQ comme de simples ARTICLES. Résultat : la section « Taxes » de
 * la facture Square restait à 0 $ (déclarations faussées) et, à la
 * modification d'une commande, les taxes étaient traitées comme des produits.
 *
 * Ici, les taxes sont posées via le mécanisme natif de Square, ligne par
 * ligne : une même commande peut mêler des articles à TPS+TVQ, des articles à
 * TPS seule (viennoiseries, pâtisseries individuelles) et des articles
 * exonérés (règle des 6). Un taux global unique ne saurait pas représenter ça.
 */

export const SQUARE_TAX_TPS_UID = "tps";
export const SQUARE_TAX_TVQ_UID = "tvq";

/** Une ligne déjà prête, sans lien avec une fiche produit. */
export interface SquareFallbackLine {
  name: string;
  quantity: number;
  unitPrice: number;
}

/** Un article de commande, tel que stocké sur le document Order. */
export interface SquareOrderItem {
  productId: number;
  productName: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  taxable?: boolean;
}

const toCents = (amount: number) => BigInt(Math.round(amount * 100));

const percentageString = (rate: number) => String(Number((rate * 100).toFixed(5)));

/** Les deux taxes québécoises, appliquées ligne par ligne. */
const quebecTaxes = () => [
  {
    uid: SQUARE_TAX_TPS_UID,
    name: "TPS (5 %)",
    percentage: percentageString(TPS_RATE), // "5"
    scope: "LINE_ITEM",
    type: "ADDITIVE",
  },
  {
    uid: SQUARE_TAX_TVQ_UID,
    name: "TVQ (9,975 %)",
    percentage: percentageString(TVQ_RATE), // "9.975"
    scope: "LINE_ITEM",
    type: "ADDITIVE",
  },
];

/**
 * Détecte une facture « solde seulement » : l'appelant a fabriqué une ligne
 * unique « Solde commande … » dont le montant inclut DÉJÀ les taxes. Il ne faut
 * surtout pas y appliquer de taxe, sinon le client serait taxé deux fois.
 */
export function isBalanceOnlyLineSet(lines: Array<{ name?: string }> | null | undefined): boolean {
  return (
    Array.isArray(lines) &&
    lines.length === 1 &&
    typeof lines[0]?.name === "string" &&
    /^solde commande/i.test(lines[0].name as string)
  );
}

/**
 * Construit le corps `order` envoyé à `squareClient.orders.create`.
 *
 * - `orderItems` fourni → taxes natives Square, posées par ligne.
 * - sinon (ou solde seulement) → lignes telles quelles, sans taxe ajoutée.
 */
export async function buildSquareOrderBody(params: {
  locationId: string;
  referenceId: string;
  orderItems?: SquareOrderItem[] | null;
  fallbackLines?: SquareFallbackLine[];
  deliveryFee?: number;
}): Promise<any> {
  const { locationId, referenceId } = params;
  const deliveryFee = params.deliveryFee || 0;
  const fallbackLines = params.fallbackLines || [];
  const orderItems = params.orderItems || [];

  // Cas « solde seulement » : montant forfaitaire taxes comprises.
  if (!orderItems.length || isBalanceOnlyLineSet(fallbackLines)) {
    const lineItems = fallbackLines.map((line) => ({
      name: line.name,
      quantity: String(line.quantity),
      itemType: "ITEM",
      basePriceMoney: { amount: toCents(line.unitPrice), currency: "CAD" },
    }));
    if (deliveryFee > 0) {
      lineItems.push({
        name: "Frais de livraison",
        quantity: "1",
        itemType: "ITEM",
        basePriceMoney: { amount: toCents(deliveryFee), currency: "CAD" },
      });
    }
    return { locationId, referenceId, lineItems };
  }

  const modes = await computeItemTaxModes(
    orderItems.map((it) => ({
      productId: it.productId,
      quantity: it.quantity,
      amount: it.amount,
      taxable: it.taxable,
    })),
  );

  const lineItems: any[] = orderItems.map((item, index) => {
    const mode = modes[index];
    const appliedTaxes =
      mode === "both"
        ? [{ taxUid: SQUARE_TAX_TPS_UID }, { taxUid: SQUARE_TAX_TVQ_UID }]
        : mode === "gst_only"
          ? [{ taxUid: SQUARE_TAX_TPS_UID }]
          : [];

    return {
      name: item.productName,
      quantity: String(item.quantity),
      itemType: "ITEM",
      basePriceMoney: { amount: toCents(item.unitPrice), currency: "CAD" },
      appliedTaxes,
    };
  });

  // Frais de livraison NON taxés : on conserve exactement la base taxable
  // actuelle de l'application (décision explicite, à revoir avec le comptable).
  if (deliveryFee > 0) {
    lineItems.push({
      name: "Frais de livraison",
      quantity: "1",
      itemType: "ITEM",
      basePriceMoney: { amount: toCents(deliveryFee), currency: "CAD" },
      appliedTaxes: [],
    });
  }

  return { locationId, referenceId, lineItems, taxes: quebecTaxes() };
}

/** Montants calculés par Square, en dollars. */
export interface SquareComputedAmounts {
  total: number;
  tax: number;
  tps: number;
  tvq: number;
}

const centsToDollars = (value: any): number => {
  if (value == null) return 0;
  const raw = typeof value === "bigint" ? Number(value) : Number(value);
  return Number.isFinite(raw) ? raw / 100 : 0;
};

/**
 * Relit ce que Square a RÉELLEMENT calculé.
 *
 * Indispensable : l'application arrondit les taxes une seule fois sur le total,
 * Square les arrondit ligne par ligne. Un écart de quelques cents est donc
 * normal — et c'est le montant de Square que le client paie. On réaligne la
 * base de données dessus, sinon la réconciliation des paiements dérive.
 */
export function readSquareOrderAmounts(orderResponse: any): SquareComputedAmounts | null {
  const order = orderResponse?.order ?? orderResponse;
  const net = order?.netAmounts ?? order?.net_amounts;
  if (!net) return null;

  const total = centsToDollars((net.totalMoney ?? net.total_money)?.amount);
  const tax = centsToDollars((net.taxMoney ?? net.tax_money)?.amount);

  let tps = 0;
  let tvq = 0;
  for (const t of order?.taxes || []) {
    const applied = centsToDollars((t.appliedMoney ?? t.applied_money)?.amount);
    if (t.uid === SQUARE_TAX_TPS_UID) tps += applied;
    else if (t.uid === SQUARE_TAX_TVQ_UID) tvq += applied;
  }

  return { total, tax, tps, tvq };
}
