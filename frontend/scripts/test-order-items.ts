/**
 * Test de non-régression : « les options d'un article ne disparaissent jamais ».
 *
 * Rejoue la chaîne complète qui a effacé les options de 14 commandes, avec les
 * vraies données de MF-20260831-0458 (Julien Kovacevic) :
 *
 *   API → écran → (modification enregistrée) → écran → action d'emballage
 *   → PATCH renvoyé au serveur
 *
 * Le serveur remplace `items` en bloc : si « Pains : Pita » manque dans ce
 * dernier PATCH, la valeur est effacée en base. C'est exactement ce qui se
 * produisait, et c'est ce que ce test empêche de revenir.
 *
 * Usage (depuis frontend/) :  bun scripts/test-order-items.ts
 */
import assert from "assert";
import {
  mapApiItemsToLocal,
  buildOrderItemsUpdatePayload,
  restoreQuantity,
  type OrderItemWithPacking,
} from "../src/utils/orderItems";

let passed = 0;
let failed = 0;

const test = (name: string, fn: () => void) => {
  try {
    fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (e: any) {
    failed++;
    console.log(`  ❌ ${name}\n     ${e.message}`);
  }
};

/** Articles tels que l'API les renvoie pour la commande 458. */
const apiItems = [
  {
    productId: 97,
    productName: "Boîte à lunch dinde et pesto",
    quantity: 7,
    unitPrice: 20.95,
    amount: 146.65,
    notes: "Options: Pains: Pita",
    selectedOptions: { Pains: "Pita", "Allergies / note client": "" },
    productionStatus: "ready",
  },
  {
    productId: 103,
    productName: "Salade repas césar",
    quantity: 2,
    unitPrice: 21.95,
    amount: 43.9,
    selectedOptions: { Version: "Originale" },
    productionStatus: "pending",
  },
];

/**
 * L'ANCIENNE reconstruction post-enregistrement, telle qu'elle était écrite
 * dans le composant : elle omettait selectedOptions et forçait "pending".
 */
const legacyRebuild = (items: any[]): OrderItemWithPacking[] =>
  items.map((item, idx) => ({
    id: idx + 1,
    productId: item.productId,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    subtotal: item.amount,
    taxable: undefined,
    productionStatus: "pending",
    notes: item.notes || undefined,
    product: { id: item.productId, name: item.productName, price: item.unitPrice },
    isPacked: false,
  }));

console.log("\n--- Commande 458 : les options survivent au trajet complet ---");

test("l'API vers l'écran conserve les options", () => {
  const local = mapApiItemsToLocal(apiItems);
  assert.deepStrictEqual(local[0].selectedOptions, {
    Pains: "Pita",
    "Allergies / note client": "",
  });
  assert.deepStrictEqual(local[1].selectedOptions, { Version: "Originale" });
});

test("l'écran vers le serveur conserve les options", () => {
  const payload = buildOrderItemsUpdatePayload(mapApiItemsToLocal(apiItems));
  assert.strictEqual((payload[0].selectedOptions as any)?.Pains, "Pita");
  assert.strictEqual((payload[1].selectedOptions as any)?.Version, "Originale");
});

test("l'emballage après modification n'efface plus rien (le vrai bug)", () => {
  // Après enregistrement, l'écran se reconstruit à partir de la réponse serveur…
  const afterSave = mapApiItemsToLocal(apiItems);
  // …puis Fanny coche « emballé », ce qui renvoie ces articles au serveur.
  const patch = buildOrderItemsUpdatePayload(afterSave);
  assert.strictEqual((patch[0].selectedOptions as any)?.Pains, "Pita");
  assert.notStrictEqual(patch[0].selectedOptions, undefined);
});

test("l'ancienne reconstruction, elle, effaçait bien les options", () => {
  // Garde-fou : si ce test cesse d'échouer, c'est que le bug est revenu.
  const patch = buildOrderItemsUpdatePayload(legacyRebuild(apiItems));
  assert.strictEqual(patch[0].selectedOptions, undefined);
  assert.strictEqual(patch[1].selectedOptions, undefined);
});

test("la quantité et le statut de production sont préservés", () => {
  const local = mapApiItemsToLocal(apiItems);
  assert.strictEqual(local[0].quantity, 7);
  assert.strictEqual(local[0].productionStatus, "ready");
  assert.strictEqual(local[0].isPacked, true);
  const patch = buildOrderItemsUpdatePayload(local);
  assert.strictEqual(patch[0].quantity, 7);
  assert.strictEqual(patch[0].productionStatus, "ready");
});

test("l'ancienne reconstruction perdait aussi l'emballage déjà fait", () => {
  const patch = buildOrderItemsUpdatePayload(legacyRebuild(apiItems));
  assert.strictEqual(patch[0].productionStatus, "pending");
});

test("une option vide n'est pas transmise comme une vraie option", () => {
  const local = mapApiItemsToLocal([{ ...apiItems[0], selectedOptions: {} }]);
  assert.strictEqual(local[0].selectedOptions, undefined);
});

console.log("\n--- Champ quantité : 2 sandwichs restent 2 ---");

test("quitter la case sans rien taper rétablit 2, pas 1", () => {
  assert.strictEqual(restoreQuantity(0, 2), 2);
});

test("un chiffre tapé remplace bien la valeur", () => {
  assert.strictEqual(restoreQuantity(3, 2), 3);
});

test("sans valeur mémorisée, on retombe sur 1 (jamais 0)", () => {
  assert.strictEqual(restoreQuantity(0, undefined), 1);
  assert.strictEqual(restoreQuantity(0, 0), 1);
});

console.log(`\n${passed} réussis, ${failed} échoués\n`);
if (failed > 0) process.exit(1);
