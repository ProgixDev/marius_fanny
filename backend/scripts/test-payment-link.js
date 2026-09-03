/**
 * Test de la règle « le client reçoit toujours le bon montant ».
 *
 * Rejoue le scénario réel de la commande MF-20260831-0458 (Julien Kovacevic) :
 * trois modifications successives à la BAISSE (1105,94 → 1007,29 → 984,35 →
 * 935,03) pendant lesquelles aucun courriel de nouveau lien n'est parti, puis
 * un « Renvoyer la facture » qui a réexpédié le montant d'origine.
 *
 * Usage (depuis backend/, après `npm run build`) :
 *   node scripts/test-payment-link.js
 *
 * Sort en code 1 si un seul cas échoue.
 */
import assert from "assert";
import {
  shouldReissuePaymentLink,
  isInvoiceStale,
  expectedInvoiceAmount,
} from "../dist/src/utils/paymentLink.js";

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

/** Commande avec un lien de paiement Square ouvert et non payée. */
const openLinkOrder = (overrides = {}) => ({
  previousTotal: 1105.94,
  newTotal: 935.03,
  squareInvoiceId: "inv:0-ChABgQauyAsQe4JUarl1H3wmEJ8K",
  squarePaymentId: null,
  paymentStatus: "unpaid",
  status: "pending",
  billingKind: "representant",
  ...overrides,
});

console.log("\n--- Commande 458 : le montant baisse, le lien doit suivre ---");

test("baisse de 1105,94 à 1007,29 → réémission", () => {
  assert.strictEqual(
    shouldReissuePaymentLink(openLinkOrder({ previousTotal: 1105.94, newTotal: 1007.29 })),
    true,
  );
});

test("baisse de 1007,29 à 984,35 → réémission", () => {
  assert.strictEqual(
    shouldReissuePaymentLink(openLinkOrder({ previousTotal: 1007.29, newTotal: 984.35 })),
    true,
  );
});

test("baisse de 984,35 à 935,03 → réémission", () => {
  assert.strictEqual(
    shouldReissuePaymentLink(openLinkOrder({ previousTotal: 984.35, newTotal: 935.03 })),
    true,
  );
});

test("hausse du total → réémission aussi", () => {
  assert.strictEqual(
    shouldReissuePaymentLink(openLinkOrder({ previousTotal: 500, newTotal: 620.5 })),
    true,
  );
});

test("total inchangé → aucune réémission (pas de facture en double)", () => {
  assert.strictEqual(
    shouldReissuePaymentLink(openLinkOrder({ previousTotal: 935.03, newTotal: 935.03 })),
    false,
  );
});

test("écart d'un centime → ignoré", () => {
  assert.strictEqual(
    shouldReissuePaymentLink(openLinkOrder({ previousTotal: 935.03, newTotal: 935.035 })),
    false,
  );
});

console.log("\n--- Garde-fous : ne jamais réémettre à tort ---");

test("aucune facture Square → rien à réémettre", () => {
  assert.strictEqual(shouldReissuePaymentLink(openLinkOrder({ squareInvoiceId: null })), false);
});

test("paiement Square réel encaissé → remboursement, pas réémission", () => {
  assert.strictEqual(
    shouldReissuePaymentLink(openLinkOrder({ squarePaymentId: "pay_123" })),
    false,
  );
});

test("commande déjà payée → aucun nouveau lien", () => {
  assert.strictEqual(
    shouldReissuePaymentLink(openLinkOrder({ paymentStatus: "paid" })),
    false,
  );
});

test("commande annulée → aucun nouveau lien", () => {
  assert.strictEqual(shouldReissuePaymentLink(openLinkOrder({ status: "cancelled" })), false);
});

test("facturation gouvernementale → aucun lien de paiement", () => {
  assert.strictEqual(
    shouldReissuePaymentLink(openLinkOrder({ billingKind: "gouvernement" })),
    false,
  );
});

console.log("\n--- « Renvoyer la facture » : jamais un montant périmé ---");

test("facture à 1105,94 alors que la commande est à 935,03 → périmée", () => {
  assert.strictEqual(isInvoiceStale(1105.94, 935.03, 0), true);
});

test("facture au bon montant → on renvoie le même lien", () => {
  assert.strictEqual(isInvoiceStale(935.03, 935.03, 0), false);
});

test("facture de SOLDE : montant dû = total moins déjà encaissé", () => {
  // 935,03 $ au total, 400 $ déjà versés → la facture doit réclamer 535,03 $.
  assert.strictEqual(expectedInvoiceAmount(935.03, 400), 535.03);
  assert.strictEqual(isInvoiceStale(535.03, 935.03, 400), false);
  assert.strictEqual(isInvoiceStale(935.03, 935.03, 400), true);
});

test("montant illisible → on ne conclut pas (aucune régénération hasardeuse)", () => {
  assert.strictEqual(isInvoiceStale(null, 935.03, 0), false);
});

console.log(`\n${passed} réussis, ${failed} échoués\n`);
if (failed > 0) process.exit(1);
