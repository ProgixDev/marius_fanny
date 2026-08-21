/**
 * Lecture des encaissements Square — logique pure, sans base de données ni
 * réseau, pour qu'elle soit testable (voir scripts/test-balance-safety.js).
 */

/**
 * Montant RÉELLEMENT encaissé sur une facture Square, en dollars.
 *
 * Square expose, pour chaque demande de paiement, `totalCompletedAmountMoney`
 * (ce qui a été payé) à côté de `computedAmountMoney` (ce qui était réclamé).
 * On lit toujours l'encaissé — jamais le total de la commande, qui peut avoir
 * AUGMENTÉ depuis l'émission de la facture (ajout d'articles).
 *
 * Retourne NaN si la facture ne permet pas de conclure : l'appelant doit alors
 * s'abstenir plutôt que d'inventer un montant.
 */
export const collectedDollarsFromInvoice = (invoice: any): number => {
  const requests =
    invoice?.paymentRequests || invoice?.payment_requests || [];
  if (!Array.isArray(requests) || requests.length === 0) return NaN;

  const readCents = (money: any): number | null => {
    const amount = money?.amount;
    if (amount === undefined || amount === null) return null;
    return Number(amount);
  };

  let cents = 0;
  let known = false;
  for (const pr of requests) {
    const completed = readCents(
      pr?.totalCompletedAmountMoney ?? pr?.total_completed_amount_money,
    );
    if (completed !== null) {
      cents += completed;
      known = true;
    }
  }
  if (known) return cents / 100;

  // Repli : la facture est PAYÉE mais Square n'a pas détaillé l'encaissé →
  // on retient le montant RÉCLAMÉ par la facture (son montant d'émission),
  // qui reste la bonne référence même si la commande a grossi depuis.
  let computedCents = 0;
  let computedKnown = false;
  for (const pr of requests) {
    const computed = readCents(
      pr?.computedAmountMoney ?? pr?.computed_amount_money,
    );
    if (computed !== null) {
      computedCents += computed;
      computedKnown = true;
    }
  }
  return computedKnown ? computedCents / 100 : NaN;
};

/**
 * Applique un encaissement Square à une commande, sans JAMAIS inventer d'argent.
 *
 * Avant, webhook et réconciliation faisaient `amountPaid = order.total` : une
 * commande déjà payée à laquelle on ajoutait des articles était re-marquée
 * « payée » au NOUVEAU total (bug des commandes 359/360/361 du 18 août). Le
 * solde dû disparaissait de l'écran, l'encadré « comment payer la balance ? »
 * ne s'affichait plus, et retirer un article réclamait un remboursement pour
 * de l'argent jamais reçu.
 *
 * Ici on ne monte `amountPaid` qu'à hauteur de ce qui a vraiment été encaissé,
 * et le statut est DÉDUIT de la comparaison avec le total courant.
 * Retourne true si la commande est intégralement payée.
 */
export const applyCollectedAmount = (order: any, collectedDollars: number): boolean => {
  const total = order.total || 0;

  // Une facture de SOLDE ne réclame que le reste à payer : son encaissement
  // s'AJOUTE au montant déjà rentré quand la facture a été émise (repère posé
  // à l'émission du lien). Pour une facture couvrant toute la commande, ce
  // repère vaut 0 et l'encaissé fait foi tel quel.
  const baseline = Number(order.squareInvoiceBaselinePaid) || 0;
  const fromSquare = (collectedDollars || 0) + baseline;

  // Jamais à la baisse : un acompte encaissé en magasin (hors Square) ne doit
  // pas être effacé par la lecture d'une facture Square partielle.
  const paid = Math.max(order.amountPaid || 0, fromSquare);
  order.amountPaid = Number(paid.toFixed(2));

  if (order.amountPaid >= total - 0.01) {
    order.paymentStatus = "paid";
    order.depositPaid = true;
    order.balancePaid = true;
    order.depositPaidAt = order.depositPaidAt || new Date();
    order.balancePaidAt = order.balancePaidAt || new Date();
    return true;
  }

  if (order.amountPaid > 0.01) {
    order.paymentStatus = "deposit_paid";
    order.depositPaid = true;
    order.depositPaidAt = order.depositPaidAt || new Date();
    order.balancePaid = false;
    order.balancePaidAt = undefined;
    return false;
  }

  order.paymentStatus = "unpaid";
  order.depositPaid = false;
  order.balancePaid = false;
  return false;
};
