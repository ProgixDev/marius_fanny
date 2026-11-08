/**
 * Menu de Noël : les 23, 24, 30 et 31 décembre ne servent QUE cette section,
 * et cette section ne se commande QUE ces jours-là.
 *
 * Usage (depuis backend/, après `npm run build`) :
 *   node scripts/test-christmas-menu.js
 */
import assert from "assert";
import {
  checkChristmasMenu,
  isChristmasMenuDate,
  isChristmasMenuProduct,
  datesEnClair,
} from "../dist/src/utils/christmasMenu.js";

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

const noel = (nom) => ({ productName: nom, isChristmas: true });
const ordinaire = (nom) => ({ productName: nom, isChristmas: false });

console.log("\n── Reconnaître les quatre journées ──\n");

test("les 23, 24, 30 et 31 décembre sont des journées menu de Noël", () => {
  for (const d of ["2026-12-23", "2026-12-24", "2026-12-30", "2026-12-31"]) {
    assert.strictEqual(isChristmasMenuDate(d), true, d);
  }
});

test("les autres jours de décembre ne le sont pas", () => {
  for (const d of ["2026-12-20", "2026-12-22", "2026-12-25", "2026-12-29", "2026-12-28"]) {
    assert.strictEqual(isChristmasMenuDate(d), false, d);
  }
});

test("la règle revient chaque année (même jour, autre année)", () => {
  assert.strictEqual(isChristmasMenuDate("2027-12-24"), true);
  assert.strictEqual(isChristmasMenuDate("2030-12-31"), true);
});

test("une date vide ou mal formée ne déclenche rien", () => {
  assert.strictEqual(isChristmasMenuDate(""), false);
  assert.strictEqual(isChristmasMenuDate(null), false);
  assert.strictEqual(isChristmasMenuDate("24-12-2026"), false);
});

console.log("\n── Reconnaître la section Noël ──\n");

test("la catégorie NOËL est reconnue malgré accents et casse", () => {
  for (const c of ["NOËL", "Noël", "noel", "NOEL", " Noel "]) {
    assert.strictEqual(isChristmasMenuProduct([c]), true, c);
  }
});

test("un produit à plusieurs catégories compte s'il est aussi dans Noël", () => {
  assert.strictEqual(isChristmasMenuProduct(["GÂTEAUX", "NOËL"]), true);
});

test("les autres sections ne sont pas le menu de Noël", () => {
  assert.strictEqual(isChristmasMenuProduct(["VIENNOISERIES"]), false);
  assert.strictEqual(isChristmasMenuProduct(["OCTOBRE ROSE"]), false);
  assert.strictEqual(isChristmasMenuProduct([]), false);
  assert.strictEqual(isChristmasMenuProduct(undefined), false);
});

console.log("\n── La règle, dans les deux sens ──\n");

test("LE CAS DE FANNY : un croissant commandé pour le 23 décembre est refusé", () => {
  const msg = checkChristmasMenu({
    serviceDate: "2026-12-23",
    items: [noel("Bûche de Noël"), ordinaire("Croissant")],
  });
  assert.ok(msg, "un message est attendu");
  assert.ok(msg.includes("23 décembre"), msg);
  assert.ok(msg.includes("Croissant"), "le message doit nommer l'article à retirer");
  assert.ok(!msg.includes("Bûche"), "il ne doit pas nommer l'article permis");
});

test("une bûche commandée pour le 20 décembre est refusée", () => {
  const msg = checkChristmasMenu({
    serviceDate: "2026-12-20",
    items: [noel("Bûche de Noël")],
  });
  assert.ok(msg);
  assert.ok(msg.includes("23, 24, 30 et 31 décembre"), msg);
  assert.ok(msg.includes("Bûche de Noël"));
});

test("menu de Noël le 24 décembre : accepté", () => {
  assert.strictEqual(
    checkChristmasMenu({
      serviceDate: "2026-12-24",
      items: [noel("Bûche de Noël"), noel("Tourtière de Noël")],
    }),
    null,
  );
});

test("commande ordinaire un jour ordinaire : acceptée", () => {
  assert.strictEqual(
    checkChristmasMenu({
      serviceDate: "2026-12-20",
      items: [ordinaire("Croissant"), ordinaire("Pain de campagne")],
    }),
    null,
  );
});

test("le 31 décembre aussi ne sert que le menu de Noël", () => {
  assert.ok(
    checkChristmasMenu({ serviceDate: "2026-12-31", items: [ordinaire("Quiche")] }),
  );
  assert.strictEqual(
    checkChristmasMenu({ serviceDate: "2026-12-31", items: [noel("Plateau du Nouvel An")] }),
    null,
  );
});

test("le 25 décembre n'est pas concerné (la boutique y est fermée)", () => {
  assert.strictEqual(
    checkChristmasMenu({ serviceDate: "2026-12-25", items: [ordinaire("Croissant")] }),
    null,
  );
});

test("panier vide : aucun blocage", () => {
  assert.strictEqual(checkChristmasMenu({ serviceDate: "2026-12-23", items: [] }), null);
});

test("un article personnalisé compte comme ordinaire", () => {
  const msg = checkChristmasMenu({
    serviceDate: "2026-12-24",
    items: [noel("Bûche"), ordinaire("Item personnalisé")],
  });
  assert.ok(msg, "il doit être refusé un jour de menu de Noël");
});

test("chaque article à retirer n'est nommé qu'une fois", () => {
  const msg = checkChristmasMenu({
    serviceDate: "2026-12-23",
    items: [ordinaire("Croissant"), ordinaire("Croissant"), ordinaire("Croissant")],
  });
  assert.strictEqual((msg.match(/Croissant/g) || []).length, 1, msg);
});

console.log("\n── Énumération des dates dans les messages ──\n");

test("les dates s'écrivent en clair", () => {
  assert.strictEqual(datesEnClair(), "les 23, 24, 30 et 31 décembre");
});

test("une seule date s'écrit au singulier", () => {
  assert.strictEqual(datesEnClair(["12-24"]), "le 24 décembre");
});

console.log(
  `\n${failed === 0 ? "✅ TOUT PASSE" : "❌ ÉCHEC"} — ${passed} test(s) réussi(s), ${failed} échec(s)\n`,
);
process.exit(failed === 0 ? 0 : 1);
