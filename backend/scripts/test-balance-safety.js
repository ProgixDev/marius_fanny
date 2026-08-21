/**
 * Test du garde-fou « on n'invente jamais un paiement ».
 *
 * Rejoue le scénario exact des commandes 359/360/361 du 18 août 2026 sur le
 * VRAI code livré (backend/dist/src/utils/squarePayments.js), plus les cas
 * voisins qui doivent continuer de marcher.
 *
 * Usage (depuis backend/, après `npm run build`) :
 *   node scripts/test-balance-safety.js
 *
 * Sort en code 1 si un seul cas échoue.
 */
import assert from "assert";
import {
  collectedDollarsFromInvoice,
  applyCollectedAmount,
} from "../dist/src/utils/squarePayments.js";

let passed = 0;
let failed = 0;

const test = (name, fn) => {
  try {
    fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ❌ ${name}\n     ${e.message}`);
  }
};

/** Facture Square telle que l'API la renvoie (montants en cents, BigInt). */
const squareInvoice = (claimedCents, collectedCents) => ({
  status: "PAID",
  paymentRequests: [
    {
      computedAmountMoney: { amount: BigInt(claimedCents), currency: "CAD" },
      ...(collectedCents === null
        ? {}
        : { totalCompletedAmountMoney: { amount: BigInt(collectedCents), currency: "CAD" } }),
    },
  ],
});

console.log("\n── Lecture du montant encaissé sur une facture Square ──\n");

test("lit l'encaissé réel, pas le montant réclamé", () => {
  assert.strictEqual(collectedDollarsFromInvoice(squareInvoice(300000, 300000)), 3000);
});

test("facture payée partiellement → l'encaissé fait foi", () => {
  assert.strictEqual(collectedDollarsFromInvoice(squareInvoice(100000, 40000)), 400);
});

test("webhook en snake_case (payload brut de Square) lu correctement", () => {
  const raw = {
    status: "PAID",
    payment_requests: [
      { total_completed_amount_money: { amount: 75225, currency: "CAD" } },
    ],
  };
  assert.strictEqual(collectedDollarsFromInvoice(raw), 752.25);
});

test("encaissé non détaillé → repli sur le montant de la facture", () => {
  assert.strictEqual(collectedDollarsFromInvoice(squareInvoice(300000, null)), 3000);
});

test("facture illisible → NaN (l'appelant doit s'abstenir, pas inventer)", () => {
  assert.ok(Number.isNaN(collectedDollarsFromInvoice({ status: "PAID" })));
  assert.ok(Number.isNaN(collectedDollarsFromInvoice({ paymentRequests: [] })));
  assert.ok(Number.isNaN(collectedDollarsFromInvoice(null)));
});

console.log("\n── Application à une commande ──\n");

test("LE BUG 359/360/361 : 15 boîtes ajoutées après paiement → le solde SURVIT", () => {
  // 17 août : la cliente paie 3000$ par lien Square. Facture PAID.
  const order = {
    total: 3000,
    amountPaid: 3000,
    paymentStatus: "paid",
    depositPaid: true,
    balancePaid: true,
  };
  // 18 août : on ajoute 15 boîtes à lunch → le total monte à 3752$.
  order.total = 3752;
  order.amountPaid = 3000; // ce que updateOrder a (correctement) conservé
  order.paymentStatus = "deposit_paid";
  order.balancePaid = false;

  // 18h51 : le robot de réconciliation passe sur la vieille facture PAYÉE.
  const invoice = squareInvoice(300000, 300000);
  const fullyPaid = applyCollectedAmount(order, collectedDollarsFromInvoice(invoice));

  assert.strictEqual(fullyPaid, false, "la commande ne doit PAS être déclarée payée");
  assert.strictEqual(order.amountPaid, 3000, "le montant payé ne doit pas gonfler au nouveau total");
  assert.strictEqual(order.paymentStatus, "deposit_paid");
  assert.strictEqual(order.balancePaid, false);
  assert.strictEqual(Number((order.total - order.amountPaid).toFixed(2)), 752, "solde dû de 752$");
});

test("le back office rouvre bien l'encadré : solde > 0 ET déjà payé > 0", () => {
  const order = { total: 3752, amountPaid: 3000, paymentStatus: "deposit_paid" };
  applyCollectedAmount(order, 3000);
  const paidAmount = order.amountPaid;
  const diff = order.total - paidAmount;
  // Conditions exactes du back office pour afficher « comment payer la balance ? »
  assert.ok(paidAmount > 0.01 && diff > 0.01);
});

test("paiement complet normal → payé (le robot fait toujours son travail)", () => {
  const order = { total: 500, amountPaid: 0, paymentStatus: "unpaid", depositPaid: false, balancePaid: false };
  const fullyPaid = applyCollectedAmount(order, collectedDollarsFromInvoice(squareInvoice(50000, 50000)));
  assert.strictEqual(fullyPaid, true);
  assert.strictEqual(order.amountPaid, 500);
  assert.strictEqual(order.paymentStatus, "paid");
  assert.strictEqual(order.balancePaid, true);
  assert.ok(order.balancePaidAt instanceof Date);
});

test("acompte encaissé en magasin non effacé par une facture Square plus petite", () => {
  const order = { total: 1000, amountPaid: 600, paymentStatus: "deposit_paid" };
  applyCollectedAmount(order, 250);
  assert.strictEqual(order.amountPaid, 600, "on ne descend jamais le montant déjà encaissé");
  assert.strictEqual(order.paymentStatus, "deposit_paid");
});

test("boutique + lien : les deux encaissements couvrent le total → payé", () => {
  const order = { total: 752, amountPaid: 500, paymentStatus: "deposit_paid" };
  const fullyPaid = applyCollectedAmount(order, 752);
  assert.strictEqual(fullyPaid, true);
  assert.strictEqual(order.amountPaid, 752);
});

test("on retire les articles ajoutés → retour à payé, sans faux remboursement", () => {
  const order = { total: 3752, amountPaid: 3000, paymentStatus: "deposit_paid", balancePaid: false };
  applyCollectedAmount(order, 3000);
  order.total = 3000; // les 15 boîtes sont retirées
  const fullyPaid = applyCollectedAmount(order, 3000);
  assert.strictEqual(fullyPaid, true);
  assert.strictEqual(order.amountPaid, 3000, "aucun remboursement à réclamer");
});

test("la cliente PAIE le lien du solde → la commande devient payée", () => {
  // Commande 361 : 632.18$ encaissés, on ajoute 5 boîtes → total 752.62$.
  // Le lien de solde envoyé ne réclame que 120.44$ : à son émission on note le
  // déjà-encaissé (632.18$), sinon son paiement ferait retomber la commande à
  // « 120.44$ payés » et le solde ne disparaîtrait jamais.
  const order = {
    total: 752.62,
    amountPaid: 632.18,
    paymentStatus: "deposit_paid",
    squareInvoiceBaselinePaid: 632.18,
  };
  const fullyPaid = applyCollectedAmount(
    order,
    collectedDollarsFromInvoice(squareInvoice(12044, 12044)),
  );
  assert.strictEqual(fullyPaid, true, "le solde payé doit solder la commande");
  assert.strictEqual(order.amountPaid, 752.62);
  assert.strictEqual(order.paymentStatus, "paid");
  assert.strictEqual(order.balancePaid, true);
});

test("le lien du solde reste impayé → la commande garde son solde", () => {
  const order = {
    total: 752.62,
    amountPaid: 632.18,
    paymentStatus: "deposit_paid",
    squareInvoiceBaselinePaid: 632.18,
  };
  applyCollectedAmount(order, 0); // facture de solde émise mais pas encore payée
  assert.strictEqual(order.amountPaid, 632.18);
  assert.strictEqual(order.paymentStatus, "deposit_paid");
});

test("solde payé en 2 fois (2 liens successifs) → total atteint, sans double compte", () => {
  const order = { total: 1000, amountPaid: 600, paymentStatus: "deposit_paid", squareInvoiceBaselinePaid: 600 };
  applyCollectedAmount(order, 200); // 1er lien de solde : 200$
  assert.strictEqual(order.amountPaid, 800);
  order.squareInvoiceBaselinePaid = 800; // 2e lien émis pour les 200$ restants
  const fullyPaid = applyCollectedAmount(order, 200);
  assert.strictEqual(order.amountPaid, 1000);
  assert.strictEqual(fullyPaid, true);
  // Le robot repasse sur la même facture 30 min plus tard : rien ne bouge.
  applyCollectedAmount(order, 200);
  assert.strictEqual(order.amountPaid, 1000, "aucune addition en boucle");
});

test("facture couvrant TOUTE la commande : repère à 0, l'encaissé fait foi", () => {
  const order = { total: 500, amountPaid: 0, paymentStatus: "unpaid", squareInvoiceBaselinePaid: 0 };
  assert.strictEqual(applyCollectedAmount(order, 500), true);
  assert.strictEqual(order.amountPaid, 500);
});

test("centimes : 752,25$ encaissés sur 752,25$ → payé (pas de solde fantôme)", () => {
  const order = { total: 752.25, amountPaid: 0, paymentStatus: "unpaid" };
  const fullyPaid = applyCollectedAmount(order, collectedDollarsFromInvoice(squareInvoice(75225, 75225)));
  assert.strictEqual(fullyPaid, true);
  assert.strictEqual(order.amountPaid, 752.25);
});

test("rien d'encaissé → commande non payée (pas de statut inventé)", () => {
  const order = { total: 500, amountPaid: 0, paymentStatus: "deposit_paid", depositPaid: true };
  const fullyPaid = applyCollectedAmount(order, 0);
  assert.strictEqual(fullyPaid, false);
  assert.strictEqual(order.paymentStatus, "unpaid");
  assert.strictEqual(order.depositPaid, false);
});

test("ANCIEN comportement (amountPaid = total) aurait échoué ici", () => {
  // Garde-fou anti-régression : si quelqu'un remet `amountPaid = order.total`,
  // ce test décrit exactement ce qui recasserait.
  const order = { total: 3752, amountPaid: 3000 };
  const ancien = { ...order, amountPaid: order.total }; // le bug de juin
  assert.strictEqual(ancien.total - ancien.amountPaid, 0, "l'ancien code effaçait le solde");
  applyCollectedAmount(order, 3000);
  assert.notStrictEqual(order.total - order.amountPaid, 0, "le nouveau code le conserve");
});

console.log(
  `\n${failed === 0 ? "✅ TOUT PASSE" : "❌ ÉCHEC"} — ${passed} test(s) réussi(s), ${failed} échec(s)\n`,
);
process.exit(failed === 0 ? 0 : 1);
