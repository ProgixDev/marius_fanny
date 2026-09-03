/**
 * Décide s'il faut réémettre le lien de paiement d'une commande, et détecte une
 * facture Square devenue périmée. Logique PURE et isolée, donc testable sans
 * base de données ni appel à Square (voir scripts/test-payment-link.js).
 *
 * Pourquoi : cette décision vivait dans le frontend et s'appuyait sur
 * `paymentMethod`, un champ qui n'existe pas en base — il est redéduit à chaque
 * chargement et retombe sur « in_store ». Après un simple rafraîchissement de
 * page, plus aucun client ne recevait le nouveau montant, et « Renvoyer la
 * facture » repartait avec l'ancien.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface ReissueDecisionInput {
  /** Total AVANT la modification. */
  previousTotal: number;
  /** Total APRÈS la modification. */
  newTotal: number;
  /** Facture Square déjà émise pour cette commande. */
  squareInvoiceId?: string | null;
  /** Encaissement Square réel : relève du remboursement, pas de la réémission. */
  squarePaymentId?: string | null;
  paymentStatus?: string | null;
  status?: string | null;
  billingKind?: string | null;
}

/**
 * Vrai quand le montant a changé et qu'un lien de paiement encore ouvert doit
 * être remplacé.
 */
export function shouldReissuePaymentLink(input: ReissueDecisionInput): boolean {
  const totalChanged = Math.abs((input.newTotal || 0) - (input.previousTotal || 0)) > 0.01;
  return (
    totalChanged &&
    !!input.squareInvoiceId &&
    !input.squarePaymentId &&
    input.paymentStatus !== "paid" &&
    input.status !== "cancelled" &&
    input.billingKind !== "gouvernement"
  );
}

/** Montant que la facture Square DEVRAIT réclamer aujourd'hui. */
export function expectedInvoiceAmount(total: number, baselinePaid: number = 0): number {
  return round2((total || 0) - (baselinePaid || 0));
}

/**
 * Une facture est périmée dès que son montant ne correspond plus au montant dû.
 * `invoiceAmount` à null (montant illisible) ⇒ on ne conclut pas.
 */
export function isInvoiceStale(
  invoiceAmount: number | null,
  total: number,
  baselinePaid: number = 0,
): boolean {
  if (invoiceAmount == null) return false;
  return Math.abs(invoiceAmount - expectedInvoiceAmount(total, baselinePaid)) > 0.01;
}
