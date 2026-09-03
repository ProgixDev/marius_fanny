/**
 * Comment une commande a réellement été payée.
 *
 * `paymentMethod` n'existe PAS en base : il se déduit. L'ancienne déduction
 * testait `paymentType === "full"` AVANT de regarder Square — or `paymentType`
 * vaut "full" pour toute commande réglée en une fois, carte comprise. La
 * branche Square n'était donc jamais atteinte et une commande payée par carte
 * s'affichait « en magasin » (onglet Paiements), tandis que « payer par lien »
 * revenait en « payer en magasin » à la réouverture du formulaire.
 *
 * L'ordre ci-dessous va du signal le plus fiable au plus faible :
 * un encaissement Square constaté prime sur toute déduction.
 */

export type PaymentMethod = "in_store" | "payment_link";

/** Ce qui distingue vraiment un mode de paiement d'un autre. */
export interface PaymentSignals {
  /** Encaissement Square réel : preuve d'un paiement par carte. */
  squarePaymentId?: string | null;
  /** Une facture / un lien de paiement Square a été émis. */
  squareInvoiceId?: string | null;
  /** Les clients gouvernementaux règlent par chèque, jamais en magasin. */
  billingKind?: string | null;
  /** Ne sert plus qu'en dernier recours : "full" ne dit RIEN du moyen employé. */
  paymentType?: string | null;
  /** Valeur explicite, si un jour le champ devient persistant. */
  paymentMethod?: string | null;
}

/** Libellé détaillé pour l'affichage (onglet Paiements). */
export type PaymentMethodLabel =
  | "card"
  | "payment_link"
  | "government_invoice"
  | "in_store";

/**
 * Nature exacte du paiement — plus riche que `PaymentMethod`, qui ne distingue
 * pas une carte déjà encaissée d'un lien encore en attente.
 */
export function derivePaymentMethodLabel(order: PaymentSignals): PaymentMethodLabel {
  if (order.paymentMethod === "in_store" || order.paymentMethod === "payment_link") {
    return order.paymentMethod === "payment_link" ? "payment_link" : "in_store";
  }
  // Un paiement Square encaissé est un fait, pas une déduction.
  if (order.squarePaymentId) return "card";
  // Une facture Square émise : payée ou non, le client a reçu un lien.
  if (order.squareInvoiceId) return "payment_link";
  // Gouvernement : facturé, réglé par chèque sous 2 mois.
  if (order.billingKind === "gouvernement") return "government_invoice";
  return "in_store";
}

/** Réduction aux deux valeurs que manipule le reste de l'interface. */
export function derivePaymentMethod(order: PaymentSignals): PaymentMethod {
  const label = derivePaymentMethodLabel(order);
  return label === "card" || label === "payment_link" ? "payment_link" : "in_store";
}

/** Texte affiché à l'écran pour chaque nature de paiement. */
export const PAYMENT_METHOD_TEXT: Record<
  PaymentMethodLabel,
  { title: string; badge: string }
> = {
  card: { title: "Payé par carte", badge: "Carte" },
  payment_link: { title: "Lien de paiement envoyé", badge: "Lien de paiement" },
  government_invoice: {
    title: "Facture envoyée — paiement par chèque",
    badge: "Facture",
  },
  in_store: { title: "Paiement en magasin", badge: "En magasin" },
};
