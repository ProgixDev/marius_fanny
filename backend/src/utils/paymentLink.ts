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

export interface ReissueDeps {
  /** Annule la facture Square devenue caduque. */
  cancelInvoice: (invoiceId: string) => Promise<unknown>;
  /** Émet la nouvelle facture ; `notify` = la fonction previent elle-même le client. */
  createInvoice: (
    orderId: string,
    channel: "email" | "sms",
    notify: boolean,
  ) => Promise<{ publicUrl: string | null }>;
  log?: (message: string) => void;
  logError?: (message: string) => void;
}

export interface ReissueOutcome {
  /** Lien à glisser dans le courriel « commande modifiée » (null si SMS ou échec). */
  invoiceUrl: string | null;
  /** Message à remonter à l'écran quand l'émission a échoué. */
  warning?: string;
  reissued: boolean;
}

/**
 * Remplace le lien de paiement d'une commande dont le montant a changé.
 *
 * L'ordre compte : on ANNULE d'abord l'ancienne facture, sinon Square garderait
 * deux liens actifs et le client pourrait payer l'ancien montant.
 *
 * Qui prévient le client : par courriel, le lien voyage dans le message
 * « commande modifiée » (un seul envoi, qui explique aussi ce qui a changé) ;
 * par SMS — ou si aucun courriel ne part — l'émission notifie elle-même, faute
 * de quoi le client n'aurait AUCUN moyen de payer.
 */
export async function reissuePaymentLink(
  deps: ReissueDeps,
  order: {
    _id: unknown;
    orderNumber?: string;
    total?: number;
    squareInvoiceId?: string | null;
    paymentLinkChannel?: string | null;
  },
  willEmailCustomer: boolean,
): Promise<ReissueOutcome> {
  const channel: "email" | "sms" = order.paymentLinkChannel === "sms" ? "sms" : "email";
  try {
    await deps.cancelInvoice(String(order.squareInvoiceId));
    const { publicUrl } = await deps.createInvoice(
      String(order._id),
      channel,
      channel === "sms" || !willEmailCustomer,
    );
    deps.log?.(
      `✅ Lien de paiement réémis pour ${order.orderNumber} (nouveau total ${order.total}$)`,
    );
    return { invoiceUrl: publicUrl, reissued: true };
  } catch (e: any) {
    const message = e?.message || String(e);
    deps.logError?.(
      `⚠️ [MAJ COMMANDE] réémission du lien impossible pour ${order.orderNumber}: ${message}`,
    );
    return {
      invoiceUrl: null,
      reissued: false,
      warning: `Le nouveau lien de paiement n'a pas pu être émis (${message}). Le client n'a PAS reçu le nouveau montant — utilisez « Renvoyer la facture ».`,
    };
  }
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
