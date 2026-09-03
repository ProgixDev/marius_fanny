/**
 * Vérifie le calcul des taxes AUPRÈS DE SQUARE, sans rien créer.
 *
 * Utilise `POST /v2/orders/calculate`, qui prévisualise la tarification d'une
 * commande sans l'enregistrer : aucune commande, aucune facture, aucun
 * paiement, aucun courriel. C'est le seul moyen de prouver que la TPS et la
 * TVQ atterrissent bien dans la section « Taxes » de Square sans passer par
 * le sandbox.
 *
 * Usage (depuis backend/) :
 *   bun scripts/verify-square-taxes-live.ts                 → une commande type
 *   bun scripts/verify-square-taxes-live.ts MF-20260831-0458
 *   bun scripts/verify-square-taxes-live.ts --all           → 20 commandes variées
 */
import dns from "node:dns";
dns.setServers(["1.1.1.1", "8.8.8.8"]);

import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import squareClient, { squareConfig } from "../src/config/square.js";
import Order from "../src/models/Order.js";
import { buildSquareOrderBody, readSquareOrderAmounts } from "../src/utils/squareOrder.js";

const round2 = (n: number) => Math.round(n * 100) / 100;

const verifyOrder = async (order: any, verbose: boolean) => {
  const body = await buildSquareOrderBody({
    locationId: squareConfig.locationId!,
    referenceId: String(order._id),
    orderItems: order.items,
    deliveryFee: order.deliveryFee || 0,
  });

  // Prévisualisation seule : Square calcule, mais n'enregistre rien.
  const response: any = await squareClient.orders.calculate({ order: body });
  const amounts = readSquareOrderAmounts(response);
  if (!amounts) throw new Error("Square n'a renvoyé aucun montant");

  const expectedTax = round2((order.tpsAmount || 0) + (order.tvqAmount || 0)) || order.taxAmount || 0;
  const taxDelta = round2(amounts.tax - expectedTax);
  const totalDelta = round2(amounts.total - (order.total || 0));

  if (verbose) {
    console.log(`\n=== ${order.orderNumber} ===`);
    console.log(`Square « Taxes »      : ${amounts.tax.toFixed(2)} $   (dont TPS ${amounts.tps.toFixed(2)} $ · TVQ ${amounts.tvq.toFixed(2)} $)`);
    console.log(`Application           : ${expectedTax.toFixed(2)} $   (dont TPS ${(order.tpsAmount || 0).toFixed(2)} $ · TVQ ${(order.tvqAmount || 0).toFixed(2)} $)`);
    console.log(`Total Square          : ${amounts.total.toFixed(2)} $ | en base : ${(order.total || 0).toFixed(2)} $`);
    console.log(`${amounts.tax > 0 ? "✅" : "❌"} La section « Taxes » de Square n'est plus à 0 $`);
    console.log(`${Math.abs(taxDelta) <= 0.02 ? "✅" : "❌"} Écart de taxe : ${taxDelta.toFixed(2)} $`);
    console.log(`${Math.abs(totalDelta) <= 0.02 ? "✅" : "❌"} Écart de total : ${totalDelta.toFixed(2)} $`);
  }

  return { amounts, expectedTax, taxDelta, totalDelta };
};

const run = async () => {
  const arg = process.argv[2];

  console.log(`Environnement Square : ${process.env.SQUARE_ENVIRONMENT}`);
  console.log("Appel: orders.calculate — prévisualisation seule, aucune écriture.\n");

  await mongoose.connect(process.env.MONGODB_URI!, {
    family: 4,
    serverSelectionTimeoutMS: 15000,
  } as any);

  if (arg === "--all") {
    const orders: any[] = await Order.find({ taxAmount: { $gt: 0 } })
      .sort({ createdAt: -1 })
      .limit(20);
    let worstTax = 0;
    let worstTotal = 0;
    let zeroTax = 0;
    for (const o of orders) {
      const r = await verifyOrder(o, false);
      if (r.amounts.tax <= 0) zeroTax++;
      worstTax = Math.max(worstTax, Math.abs(r.taxDelta));
      worstTotal = Math.max(worstTotal, Math.abs(r.totalDelta));
      const flag = Math.abs(r.totalDelta) > 0.02 || r.amounts.tax <= 0 ? "❌" : "✅";
      console.log(
        `${flag} ${o.orderNumber}  taxe Square ${r.amounts.tax.toFixed(2)} $ vs app ${r.expectedTax.toFixed(2)} $  · écart total ${r.totalDelta.toFixed(2)} $`,
      );
    }
    console.log(`\n${orders.length} commandes vérifiées auprès de Square.`);
    console.log(`Commandes avec « Taxes = 0 » : ${zeroTax} ${zeroTax === 0 ? "✅" : "❌"}`);
    console.log(`Pire écart de taxe  : ${worstTax.toFixed(2)} $`);
    console.log(`Pire écart de total : ${worstTotal.toFixed(2)} $`);
  } else {
    const order: any = await Order.findOne(
      arg ? { orderNumber: arg } : { taxAmount: { $gt: 0 } },
      null,
      { sort: { createdAt: -1 } },
    );
    if (!order) throw new Error("Commande introuvable");
    await verifyOrder(order, true);
  }

  await mongoose.disconnect();
};

run().catch((e) => {
  console.error("ERREUR:", e?.message || e);
  process.exit(1);
});
