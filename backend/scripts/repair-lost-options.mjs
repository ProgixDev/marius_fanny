/**
 * Réparation des options d'articles perdues (ex. « Pains : Pita »).
 *
 * Cause : après une modification, l'interface reconstruisait ses articles en
 * oubliant `selectedOptions` ; l'action d'emballage suivante renvoyait alors
 * `selectedOptions: undefined` au serveur, qui écrasait la valeur en base.
 * Les valeurs d'origine survivent dans `changeHistory.oldValue` — on les y
 * relit pour restaurer ce qui a été effacé.
 *
 * Usage (depuis backend/) :
 *   node scripts/repair-lost-options.mjs           → SIMULATION, n'écrit rien
 *   node scripts/repair-lost-options.mjs --apply   → applique réellement
 *
 * Ne touche qu'aux articles dont les options sont ACTUELLEMENT vides et dont
 * une version antérieure du même produit en portait. N'écrase jamais une
 * option existante et ne modifie aucun montant.
 */
import dns from "node:dns";
dns.setServers(["1.1.1.1", "8.8.8.8"]);

import { MongoClient } from "mongodb";
import dotenv from "dotenv";

dotenv.config();

const APPLY = process.argv.includes("--apply");

const hasRealOptions = (opts) =>
  !!opts && Object.values(opts).some((v) => String(v ?? "").trim() !== "");

const run = async () => {
  const client = new MongoClient(process.env.MONGODB_URI, {
    family: 4,
    serverSelectionTimeoutMS: 15000,
  });
  await client.connect();
  const orders = client.db().collection("orders");

  const all = await orders
    .find({ "changeHistory.field": "items" })
    .project({ orderNumber: 1, items: 1, changeHistory: 1 })
    .toArray();

  let repairedOrders = 0;
  let repairedItems = 0;

  for (const order of all) {
    // Dernières options connues pour chaque produit, du plus ancien au plus
    // récent : la dernière écriture gagne.
    const lastKnown = new Map();
    for (const h of order.changeHistory || []) {
      if (h.field !== "items" || !Array.isArray(h.oldValue)) continue;
      for (const it of h.oldValue) {
        if (hasRealOptions(it.selectedOptions)) {
          lastKnown.set(`${it.productId}::${it.productName}`, it.selectedOptions);
        }
      }
    }
    if (lastKnown.size === 0) continue;

    const restored = [];
    const nextItems = (order.items || []).map((it) => {
      if (hasRealOptions(it.selectedOptions)) return it;
      const recovered = lastKnown.get(`${it.productId}::${it.productName}`);
      if (!recovered) return it;
      restored.push({ productName: it.productName, options: recovered });
      return { ...it, selectedOptions: recovered };
    });

    if (restored.length === 0) continue;

    repairedOrders++;
    repairedItems += restored.length;
    console.log(`\n${order.orderNumber}`);
    for (const r of restored) {
      const label = Object.entries(r.options)
        .filter(([, v]) => String(v ?? "").trim() !== "")
        .map(([k, v]) => `${k}: ${v}`)
        .join(" | ");
      console.log(`   ${r.productName} → ${label}`);
    }

    if (APPLY) {
      await orders.updateOne({ _id: order._id }, { $set: { items: nextItems } });
    }
  }

  console.log(
    `\n${repairedItems} article(s) sur ${repairedOrders} commande(s) ${
      APPLY ? "RESTAURÉS." : "restaurables."
    }`,
  );
  if (!APPLY && repairedOrders > 0) {
    console.log("Simulation uniquement — relancez avec --apply pour écrire en base.");
  }

  await client.close();
};

run().catch((e) => {
  console.error("ERREUR:", e?.message || e);
  process.exit(1);
});
