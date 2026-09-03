/**
 * Conversion des articles de commande entre l'API et l'affichage.
 *
 * Logique PURE, volontairement sortie du composant : c'est ici que se jouait la
 * perte des options (« Pains : Pita »). L'écran reconstruisait ses articles à la
 * main après un enregistrement, en oubliant `selectedOptions` ; l'action
 * d'emballage suivante renvoyait alors ce vide au serveur, qui l'écrivait en
 * base. 14 commandes ont ainsi perdu les options d'un produit encore présent.
 *
 * Isolée ici, la chaîne complète (API → écran → renvoi au serveur) est
 * vérifiable sans navigateur — voir scripts/test-order-items.ts.
 */

export interface OrderItemWithPacking {
  id: number;
  productId: number;
  product?: { id: number; name: string; price: number };
  quantity: number;
  unitPrice: number;
  subtotal: number;
  taxable?: boolean;
  productionStatus: string;
  notes?: string;
  selectedOptions?: Record<string, string>;
  isPacked?: boolean;
}

/** Options réellement renseignées (une valeur vide ne compte pas). */
const keepOptions = (options: any): Record<string, string> | undefined =>
  options && Object.keys(options).length > 0 ? options : undefined;

/**
 * Articles renvoyés par l'API → articles d'affichage. Source UNIQUE : utilisée
 * au chargement de la liste comme après un enregistrement.
 */
export const mapApiItemsToLocal = (apiItems: any[]): OrderItemWithPacking[] =>
  (apiItems || []).map((item: any, idx: number) => {
    let productName = `Produit #${item.productId}`; // Nom par defaut
    let productPrice = item.unitPrice || 0;
    if (item.product) {
      productName = item.product.name || productName;
      productPrice = item.product.price || productPrice;
    } else if (item.productName) {
      productName = item.productName;
    }

    return {
      id: idx + 1,
      orderId: 0,
      productId: item.productId,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      subtotal: item.amount || item.quantity * item.unitPrice,
      // Sans ça, un item personnalisé non taxable redevenait taxable
      // dès qu'on rouvrait la commande pour la modifier.
      taxable: item.taxable,
      productionStatus: item.productionStatus || "pending",
      notes: item.notes,
      selectedOptions: keepOptions(item.selectedOptions),
      product: {
        id: item.productId,
        name: productName,
        price: productPrice,
      },
      isPacked: item.productionStatus === "ready" || item.isPacked === true,
    };
  });

/**
 * Articles d'affichage → corps du PATCH envoyé au serveur (emballage, statut de
 * production…). Le serveur remplace `items` en bloc : tout champ absent d'ici
 * est EFFACÉ en base.
 */
export const buildOrderItemsUpdatePayload = (items: OrderItemWithPacking[]) =>
  items.map((item) => ({
    productId: item.productId,
    productName: item.product?.name ?? `Produit #${item.productId}`,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    amount: item.subtotal,
    taxable: item.taxable,
    notes: item.notes,
    selectedOptions: keepOptions(item.selectedOptions),
    productionStatus:
      item.productionStatus === "ready" || item.productionStatus === "in_progress"
        ? item.productionStatus
        : "pending",
  }));

/**
 * Quantité à rétablir quand la case est quittée vide.
 *
 * La case se vide au focus pour qu'un chiffre tapé remplace la valeur (saisie
 * sur tablette). Mais on retombait sur 1 : effleurer la case d'une ligne de
 * 2 sandwichs sans rien taper la ramenait silencieusement à 1.
 */
export const restoreQuantity = (typed: number, remembered?: number): number => {
  if (Number(typed) > 0) return Number(typed);
  return Number(remembered) > 0 ? Number(remembered) : 1;
};
