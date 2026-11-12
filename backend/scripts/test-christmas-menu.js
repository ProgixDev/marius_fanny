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
  CHRISTMAS_MENU_CATEGORIES,
  collectChristmasCategoryNames,
  resolveChristmasCategoryNames,
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

test("toutes les sections de la famille des fêtes sont reconnues", () => {
  for (const c of CHRISTMAS_MENU_CATEGORIES) {
    assert.strictEqual(isChristmasMenuProduct([c]), true, c);
  }
});

test("LE CAS DU 12 NOVEMBRE : le menu à 68,95 $ porte « Menu des fêtes »", () => {
  // Il était refusé le 31 décembre parce que seule « NOËL » était reconnue.
  assert.strictEqual(isChristmasMenuProduct(["Menu des fêtes"]), true);
  assert.strictEqual(isChristmasMenuProduct(["Menu festif"]), true);
});

test("accents et casse sont ignorés", () => {
  assert.strictEqual(isChristmasMenuProduct(["menu de noel"]), true);
  assert.strictEqual(isChristmasMenuProduct([" TRAITEUR DES FETES "]), true);
});

test("un produit vendu toute l'année compte comme festif s'il porte aussi une section des fêtes", () => {
  // « Plateau de fromages fins » : Traiteur des fêtes + PLATEAUX.
  assert.strictEqual(isChristmasMenuProduct(["Traiteur des fêtes", "PLATEAUX"]), true);
});

test("les autres sections ne sont pas le menu des fêtes", () => {
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

test("SUSPENDU : un article festif reste commandable hors des quatre dates", () => {
  // 33 des 46 produits de la section se vendent toute l'année (plateaux,
  // salades, Paris-Brest…). Les bloquer couperait des ventes courantes.
  assert.strictEqual(
    checkChristmasMenu({ serviceDate: "2026-12-20", items: [noel("Plateau de fromages fins")] }),
    null,
  );
});

test("le sens inverse reste disponible sur demande explicite", () => {
  const msg = checkChristmasMenu({
    serviceDate: "2026-12-20",
    items: [noel("Bûche de Noël")],
    restrictFestiveToDates: true,
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

test("le 31 décembre aussi ne sert que le menu des fêtes", () => {
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

console.log("\n── Sections lues dans l'arborescence ──\n");

// L'arborescence réelle du catalogue, telle qu'elle est en base.
const arbrePlat = [
  { id: 1, name: "GÂTEAUX", parentId: null },
  { id: 7, name: "TARTES", parentId: 1 },
  { id: 29, name: "Menu de Noël", parentId: null },
  { id: 30, name: "Bûches et gâteaux des fêtes", parentId: 29 },
  { id: 31, name: "Traiteur des fêtes", parentId: 29 },
  { id: 32, name: "Menu festif", parentId: 29 },
];

test("la section parente et ses trois sous-sections sont trouvées", () => {
  const noms = collectChristmasCategoryNames(arbrePlat);
  assert.deepStrictEqual(
    noms.sort(),
    ["Bûches et gâteaux des fêtes", "Menu de Noël", "Menu festif", "Traiteur des fêtes"].sort(),
  );
});

test("LE POINT CLÉ : une sous-section créée plus tard est reconnue d'office", () => {
  const avecQuatrieme = [...arbrePlat, { id: 33, name: "Repas du Nouvel An", parentId: 29 }];
  const noms = resolveChristmasCategoryNames(avecQuatrieme);
  assert.ok(noms.includes("Repas du Nouvel An"), "la 4e sous-section doit compter");
  assert.strictEqual(isChristmasMenuProduct(["Repas du Nouvel An"], noms), true);
  assert.strictEqual(
    checkChristmasMenu({
      serviceDate: "2026-12-31",
      items: [
        {
          productName: "Souper du 31",
          isChristmas: isChristmasMenuProduct(["Repas du Nouvel An"], noms),
        },
      ],
    }),
    null,
  );
});

test("une sous-sous-section compte aussi", () => {
  const profond = [...arbrePlat, { id: 34, name: "Bûches sans gluten", parentId: 30 }];
  assert.ok(collectChristmasCategoryNames(profond).includes("Bûches sans gluten"));
});

test("les sections hors menu des fêtes ne sont jamais ramassées", () => {
  const noms = collectChristmasCategoryNames(arbrePlat);
  assert.ok(!noms.includes("GÂTEAUX"));
  assert.ok(!noms.includes("TARTES"));
});

test("l'arborescence imbriquée de l'API donne le même résultat", () => {
  const arbreImbrique = [
    {
      id: 29,
      title: "Menu de Noël",
      children: [
        { id: 30, title: "Bûches et gâteaux des fêtes" },
        { id: 31, title: "Traiteur des fêtes" },
        { id: 32, title: "Menu festif" },
      ],
    },
    { id: 1, title: "GÂTEAUX", children: [{ id: 7, title: "TARTES" }] },
  ];
  assert.deepStrictEqual(
    collectChristmasCategoryNames(arbreImbrique).sort(),
    collectChristmasCategoryNames(arbrePlat).sort(),
  );
});

test("FILET DE SÉCURITÉ : sans arborescence, les noms connus prennent le relais", () => {
  const noms = resolveChristmasCategoryNames(null);
  assert.ok(noms.length >= CHRISTMAS_MENU_CATEGORIES.length);
  assert.strictEqual(isChristmasMenuProduct(["Menu des fêtes"], noms), true);
});

test("section parente renommée : on ne perd pas les noms connus", () => {
  const renomme = arbrePlat.map((c) => (c.id === 29 ? { ...c, name: "Fêtes 2027" } : c));
  const noms = resolveChristmasCategoryNames(renomme);
  assert.strictEqual(isChristmasMenuProduct(["Menu festif"], noms), true);
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
