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

// ---------------------------------------------------------------------------
// Orchestration de la réémission, avec un faux Square : c'est la partie qui
// n'avait jamais tourné. On vérifie l'ORDRE des appels (annuler avant créer),
// qui prévient le client, et ce qui se passe quand Square tombe en panne.
// ---------------------------------------------------------------------------
const { reissuePaymentLink } = await import("../dist/src/utils/paymentLink.js");

const fakeSquare = (overrides = {}) => {
  const calls = [];
  return {
    calls,
    deps: {
      cancelInvoice: async (id) => {
        calls.push(`cancel:${id}`);
        if (overrides.cancelFails) throw new Error("Square indisponible");
      },
      createInvoice: async (orderId, channel, notify) => {
        calls.push(`create:${orderId}:${channel}:notify=${notify}`);
        if (overrides.createFails) throw new Error("Square a refuse la facture");
        return { publicUrl: "https://squareup.com/pay-invoice/NOUVEAU" };
      },
      log: () => {},
      logError: () => {},
    },
  };
};

const orderDoc = (overrides = {}) => ({
  _id: "6a95964578fe95601835a6a5",
  orderNumber: "MF-20260831-0458",
  total: 935.03,
  squareInvoiceId: "inv:0-ANCIENNE",
  paymentLinkChannel: "email",
  ...overrides,
});

console.log("\n--- Reemission : orchestration (faux Square) ---");

await (async () => {
  const s = fakeSquare();
  const out = await reissuePaymentLink(s.deps, orderDoc(), true);

  test("l'ancienne facture est annulee AVANT d'en creer une nouvelle", () => {
    assert.deepStrictEqual(s.calls, [
      "cancel:inv:0-ANCIENNE",
      "create:6a95964578fe95601835a6a5:email:notify=false",
    ]);
  });

  test("le nouveau lien remonte pour le courriel « commande modifiee »", () => {
    assert.strictEqual(out.invoiceUrl, "https://squareup.com/pay-invoice/NOUVEAU");
    assert.strictEqual(out.reissued, true);
    assert.strictEqual(out.warning, undefined);
  });
})();

await (async () => {
  const s = fakeSquare();
  await reissuePaymentLink(s.deps, orderDoc(), false);
  test("aucun courriel prevu : Square notifie lui-meme (jamais de client muet)", () => {
    assert.ok(s.calls[1].endsWith("notify=true"));
  });
})();

await (async () => {
  const s = fakeSquare();
  const out = await reissuePaymentLink(s.deps, orderDoc({ paymentLinkChannel: "sms" }), true);
  test("canal SMS : le lien part par SMS, pas dans le courriel", () => {
    assert.ok(s.calls[1].includes(":sms:notify=true"));
    assert.strictEqual(out.invoiceUrl, "https://squareup.com/pay-invoice/NOUVEAU");
  });
})();

await (async () => {
  const s = fakeSquare({ createFails: true });
  const out = await reissuePaymentLink(s.deps, orderDoc(), true);
  test("Square en panne : l'echec est signale, pas avale", () => {
    assert.strictEqual(out.reissued, false);
    assert.strictEqual(out.invoiceUrl, null);
    assert.ok(out.warning.includes("n'a PAS recu") || out.warning.includes("n'a PAS reçu"));
    assert.ok(out.warning.includes("Square a refuse la facture"));
  });
})();

await (async () => {
  const s = fakeSquare({ cancelFails: true });
  const out = await reissuePaymentLink(s.deps, orderDoc(), true);
  test("annulation impossible : on ne cree PAS un second lien actif", () => {
    assert.strictEqual(s.calls.length, 1);
    assert.strictEqual(out.reissued, false);
  });
})();

// ---------------------------------------------------------------------------
// Historique : « Produits modifiés » ne doit apparaitre que si quelque chose a
// vraiment bouge. Mesure avant correction : 1369 des 1427 entrees (96 %) ne
// consignaient aucun changement, creees en cochant les cases d'emballage.
// ---------------------------------------------------------------------------
const { describeItemChanges, shouldRecordItemChange } = await import(
  "../dist/src/utils/orderChanges.js"
);

const items458 = () => [
  { productName: "Boite a lunch dinde et pesto", quantity: 7, unitPrice: 20.95,
    selectedOptions: { Pains: "Pita" } },
  { productName: "Salade repas cesar", quantity: 4, unitPrice: 21.95 },
];

console.log("\n--- Historique : plus de lignes « Produits modifies » vides ---");

test("cocher « emballe » ne cree AUCUNE entree", () => {
  // Le clic renvoie le meme tableau, seul productionStatus differe.
  const before = items458();
  const after = items458().map((i) => ({ ...i, productionStatus: "ready" }));
  assert.deepStrictEqual(describeItemChanges(before, after), []);
  assert.strictEqual(shouldRecordItemChange(before, after, 935.03, 935.03), false);
});

test("une quantite modifiee cree bien une entree", () => {
  const before = items458();
  const after = items458();
  after[1].quantity = 5;
  assert.deepStrictEqual(describeItemChanges(before, after), ["Salade repas cesar : 4 → 5"]);
  assert.strictEqual(shouldRecordItemChange(before, after, 935.03, 956.98), true);
});

test("un article ajoute ou retire cree une entree", () => {
  const before = items458();
  assert.ok(describeItemChanges(before, [before[0]])[0].startsWith("Retire") ||
            describeItemChanges(before, [before[0]])[0].startsWith("Retiré"));
  assert.strictEqual(shouldRecordItemChange(before, [before[0]], 935.03, 847.23), true);
});

test("changer l'option d'un produit compte comme un changement", () => {
  const before = items458();
  const after = items458();
  after[0].selectedOptions = { Pains: "Baguette" };
  assert.ok(describeItemChanges(before, after).length > 0);
});

test("un prix unitaire modifie compte, meme a quantite egale", () => {
  const before = items458();
  const after = items458();
  after[1].unitPrice = 23.95;
  assert.ok(describeItemChanges(before, after)[0].includes("prix unitaire"));
});

test("total change sans que les articles bougent (remise, livraison) : on consigne", () => {
  const before = items458();
  assert.strictEqual(shouldRecordItemChange(before, items458(), 935.03, 905.03), true);
});

test("l'ordre des articles n'invente pas un changement", () => {
  const before = items458();
  const after = [...items458()].reverse();
  assert.deepStrictEqual(describeItemChanges(before, after), []);
});


// ---------------------------------------------------------------------------
// Delai de preparation + heure limite de 14 h. Le CRM refusait les produits a
// 2 jours de preparation commandes apres 14 h, alors que la limite ne concerne
// que ce qui pourrait partir des le lendemain.
// ---------------------------------------------------------------------------
const { minimumServiceDate, preparationDays, cutoffApplies } = await import(
  "../dist/src/utils/leadTime.js"
);

const LUNDI = "2026-09-07"; // lundi
const MARDI = "2026-09-08";
const MERCREDI = "2026-09-09";
const JEUDI = "2026-09-10";

console.log("\n--- Heure limite de 14 h : ce qu'elle doit vraiment bloquer ---");

test("produit 1 jour, commande lundi 13 h : recuperable mardi", () => {
  assert.strictEqual(minimumServiceDate(LUNDI, 1, false), MARDI);
});

test("produit 1 jour, commande lundi 15 h : repousse a mercredi", () => {
  assert.strictEqual(minimumServiceDate(LUNDI, 1, true), MERCREDI);
});

test("produit 2 jours, commande lundi 13 h : mercredi", () => {
  assert.strictEqual(minimumServiceDate(LUNDI, 2, false), MERCREDI);
});

test("produit 2 jours, commande lundi 15 h : mercredi AUSSI (le bug)", () => {
  // Avant correction : jeudi. La limite de 14 h ne doit pas s'y appliquer.
  assert.strictEqual(minimumServiceDate(LUNDI, 2, true), MERCREDI);
});

test("produit 2 jours, commande lundi 18 h : toujours mercredi", () => {
  assert.strictEqual(minimumServiceDate(LUNDI, 2, true), MERCREDI);
});

test("produit 3 jours : la limite ne s'applique pas non plus", () => {
  assert.strictEqual(minimumServiceDate(LUNDI, 3, true), JEUDI);
  assert.strictEqual(minimumServiceDate(LUNDI, 3, false), JEUDI);
});

test("sans delai de preparation, passe 14 h : demain reste bloque", () => {
  assert.strictEqual(minimumServiceDate(LUNDI, 0, true), MARDI);
  assert.strictEqual(minimumServiceDate(LUNDI, 0, false), LUNDI);
});

test("la limite ne s'applique qu'aux delais de 0 ou 1 jour", () => {
  assert.strictEqual(cutoffApplies(0, true), true);
  assert.strictEqual(cutoffApplies(1, true), true);
  assert.strictEqual(cutoffApplies(2, true), false);
  assert.strictEqual(cutoffApplies(1, false), false);
});

test("heures converties en jours, arrondi vers le haut", () => {
  assert.strictEqual(preparationDays(0), 0);
  assert.strictEqual(preparationDays(24), 1);
  assert.strictEqual(preparationDays(25), 2);
  assert.strictEqual(preparationDays(48), 2);
});

test("changement de mois : la date reste valide", () => {
  assert.strictEqual(minimumServiceDate("2026-09-30", 2, true), "2026-10-02");
});

console.log(`\n${passed} reussis, ${failed} echoues\n`);
if (failed > 0) process.exit(1);
