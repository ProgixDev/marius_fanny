/**
 * Export comptable TPS/TVQ — LECTURE SEULE, n'écrit rien.
 *
 * Les factures Square émises avant le correctif portent « Taxes : 0 $ », les
 * taxes y ayant été poussées comme de simples articles. Les factures déjà
 * payées ne sont plus modifiables chez Square : ce fichier fournit au comptable
 * les vrais montants de TPS et de TVQ, commande par commande.
 *
 * Usage (depuis backend/) :
 *   node scripts/export-taxes.mjs                  → toutes les commandes facturées
 *   node scripts/export-taxes.mjs 2026-06-01 2026-08-31
 *
 * Écrit  exports/taxes-<date>.csv  (séparateur « ; », encodage UTF-8 avec BOM
 * pour qu'Excel en français ouvre le fichier correctement).
 */
import dns from "node:dns";
dns.setServers(["1.1.1.1", "8.8.8.8"]);

import fs from "node:fs";
import path from "node:path";
import { MongoClient } from "mongodb";
import dotenv from "dotenv";

dotenv.config();

const TPS_RATE = 0.05;
const TVQ_RATE = 0.09975;
const round2 = (n) => Math.round(n * 100) / 100;

/** Découpage TPS/TVQ : celui stocké, sinon réparti au prorata des taux. */
const taxParts = (order) => {
  if (order.tpsAmount != null && order.tvqAmount != null && (order.tpsAmount || order.tvqAmount)) {
    return { tps: order.tpsAmount, tvq: order.tvqAmount, estimated: false };
  }
  const total = order.taxAmount || 0;
  if (!total) return { tps: 0, tvq: 0, estimated: false };
  const tvq = total * (TVQ_RATE / (TPS_RATE + TVQ_RATE));
  return { tps: round2(total - tvq), tvq: round2(tvq), estimated: true };
};

const csvCell = (value) => {
  const s = String(value ?? "");
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// Excel francophone attend la virgule décimale.
const money = (n) => round2(n || 0).toFixed(2).replace(".", ",");

const run = async () => {
  const [from, to] = process.argv.slice(2);

  const client = new MongoClient(process.env.MONGODB_URI, {
    family: 4,
    serverSelectionTimeoutMS: 15000,
  });
  await client.connect();

  const filter = { squareInvoiceId: { $exists: true, $ne: null } };
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = new Date(`${from}T00:00:00.000Z`);
    if (to) filter.createdAt.$lte = new Date(`${to}T23:59:59.999Z`);
  }

  const orders = await client
    .db()
    .collection("orders")
    .find(filter)
    .sort({ createdAt: 1 })
    .toArray();

  const header = [
    "Numéro de commande",
    "Date",
    "Statut de paiement",
    "Sous-total",
    "Rabais",
    "TPS",
    "TVQ",
    "Livraison",
    "Total",
    "Découpage estimé",
    "Facture Square",
  ];

  const lines = [header.map(csvCell).join(";")];
  let totalTps = 0;
  let totalTvq = 0;
  let estimatedCount = 0;

  for (const o of orders) {
    const { tps, tvq, estimated } = taxParts(o);
    totalTps += tps;
    totalTvq += tvq;
    if (estimated) estimatedCount++;

    lines.push(
      [
        o.orderNumber || String(o._id),
        new Date(o.createdAt).toISOString().slice(0, 10),
        o.paymentStatus || "",
        money(o.subtotal),
        money(o.promoDiscountAmount),
        money(tps),
        money(tvq),
        money(o.deliveryFee),
        money(o.total),
        estimated ? "oui" : "non",
        o.squareInvoiceId || "",
      ]
        .map(csvCell)
        .join(";"),
    );
  }

  lines.push(
    ["TOTAL", "", "", "", "", money(totalTps), money(totalTvq), "", "", "", ""]
      .map(csvCell)
      .join(";"),
  );

  const outDir = path.join(process.cwd(), "exports");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `taxes-${new Date().toISOString().slice(0, 10)}.csv`);
  // BOM UTF-8 : sans lui, Excel casse les accents.
  fs.writeFileSync(outFile, "﻿" + lines.join("\r\n"), "utf8");

  console.log(`${orders.length} commande(s) facturée(s) exportée(s)`);
  console.log(`TPS totale : ${money(totalTps)} $`);
  console.log(`TVQ totale : ${money(totalTvq)} $`);
  if (estimatedCount > 0) {
    console.log(
      `⚠️  ${estimatedCount} commande(s) sans découpage stocké : TPS/TVQ réparties au prorata des taux (colonne « Découpage estimé » = oui).`,
    );
  }
  console.log(`\nFichier : ${outFile}`);

  await client.close();
};

run().catch((e) => {
  console.error("ERREUR:", e?.message || e);
  process.exit(1);
});
