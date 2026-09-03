/**
 * Vérification LECTURE SEULE du corps de commande envoyé à Square.
 *
 * Construit le payload pour une commande réelle et montre où atterrissent la
 * TPS et la TVQ. N'appelle JAMAIS l'API Square et n'écrit rien en base.
 *
 * Usage :  bun scripts/check-square-tax-payload.ts [NUMERO_DE_COMMANDE]
 */
import dns from "node:dns";
dns.setServers(["1.1.1.1", "8.8.8.8"]);

import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import Order from "../src/models/Order.js";
import { buildSquareOrderBody } from "../src/utils/squareOrder.js";
import { computeTaxBreakdown } from "../src/utils/tax.js";

const TPS_RATE = 0.05;
const TVQ_RATE = 0.09975;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Recalcule TPS/TVQ à partir du payload et compare avec la base. */
const auditOrder = async (order: any) => {
  const body = await buildSquareOrderBody({
    locationId: "LOCATION_FICTIVE",
    referenceId: String(order._id),
    orderItems: order.items,
    deliveryFee: order.deliveryFee || 0,
  });
  let tps = 0;
  let tvq = 0;
  let linesTotal = 0;
  for (const li of body.lineItems) {
    const lineTotal = Number(li.quantity) * (Number(li.basePriceMoney.amount) / 100);
    linesTotal += lineTotal;
    const uids: string[] = (li.appliedTaxes || []).map((t: any) => t.taxUid);
    if (uids.includes("tps")) tps += lineTotal * TPS_RATE;
    if (uids.includes("tvq")) tvq += lineTotal * TVQ_RATE;
  }
  return {
    body,
    tps: round2(tps),
    tvq: round2(tvq),
    linesTotal: round2(linesTotal),
    pseudoTaxLines: body.lineItems.filter((l: any) => /^(TPS|TVQ)/i.test(l.name)).length,
  };
};

/** Passe toutes les commandes taxées en revue et signale les écarts. */
const runAll = async () => {
  const orders: any[] = await Order.find({ taxAmount: { $gt: 0 } }).limit(1000);
  console.log(`Audit de ${orders.length} commandes taxées...\n`);
  let mismatches = 0;
  for (const order of orders) {
    const a = await auditOrder(order);
    const problems: string[] = [];
    if (a.pseudoTaxLines > 0) problems.push(`${a.pseudoTaxLines} pseudo-ligne(s) de taxe`);
    // On compare au calculateur ACTUEL de l'application, pas au montant
    // historique : les réglages de taxe des produits ont changé depuis, et une
    // vieille commande peut légitimement ne plus donner le même total.
    // L'invariant à tenir est : payload Square == computeTaxBreakdown.
    const expected = await computeTaxBreakdown(order.items as any);
    if (Math.abs(a.tps - expected.tps) > 0.02) problems.push(`TPS ${a.tps} ≠ ${expected.tps}`);
    if (Math.abs(a.tvq - expected.tvq) > 0.02) problems.push(`TVQ ${a.tvq} ≠ ${expected.tvq}`);
    if (problems.length) {
      mismatches++;
      console.log(`❌ ${order.orderNumber} — ${problems.join(" · ")}`);
    }
  }
  console.log(
    mismatches === 0
      ? "\n✅ Aucun écart : le payload Square reproduit exactement le calcul de l'application."
      : `\n${mismatches} commande(s) en écart.`,
  );
  await mongoose.disconnect();
  if (mismatches > 0) process.exit(1);
};

const run = async () => {
  const arg = process.argv[2];

  await mongoose.connect(process.env.MONGODB_URI!, {
    family: 4,
    serverSelectionTimeoutMS: 15000,
  } as any);

  if (arg === "--all") return runAll();

  const orderNumber = arg || "MF-20260831-0458";

  const order: any = await Order.findOne({ orderNumber });
  if (!order) throw new Error(`Commande ${orderNumber} introuvable`);

  const body = await buildSquareOrderBody({
    locationId: "LOCATION_FICTIVE",
    referenceId: String(order._id),
    orderItems: order.items,
    deliveryFee: order.deliveryFee || 0,
  });

  console.log(`=== ${orderNumber} — taxes déclarées au niveau de la commande ===`);
  console.log(JSON.stringify(body.taxes, null, 1));

  console.log("\n=== Lignes ===");
  let linesTotal = 0;
  let tps = 0;
  let tvq = 0;
  for (const li of body.lineItems) {
    const qty = Number(li.quantity);
    const lineTotal = qty * (Number(li.basePriceMoney.amount) / 100);
    linesTotal += lineTotal;
    const uids: string[] = (li.appliedTaxes || []).map((t: any) => t.taxUid);
    if (uids.includes("tps")) tps += lineTotal * TPS_RATE;
    if (uids.includes("tvq")) tvq += lineTotal * TVQ_RATE;
    console.log(
      String(qty).padStart(3),
      "x",
      String(li.name).slice(0, 42).padEnd(43),
      lineTotal.toFixed(2).padStart(9),
      "|",
      uids.length ? uids.join(" + ") : "aucune taxe",
    );
  }

  const round2 = (n: number) => Math.round(n * 100) / 100;
  const pseudoTaxLines = body.lineItems.filter((l: any) => /^(TPS|TVQ)/i.test(l.name));
  const expectedLines = round2((order.subtotal || 0) + (order.deliveryFee || 0));
  const rebuiltTotal = round2(linesTotal + round2(tps) + round2(tvq));

  console.log("\n=== Contrôles ===");
  const checks: Array<[string, boolean, string]> = [
    [
      "Aucune pseudo-ligne TPS/TVQ",
      pseudoTaxLines.length === 0,
      `${pseudoTaxLines.length} trouvée(s)`,
    ],
    ["Taxes natives présentes", (body.taxes || []).length === 2, `${(body.taxes || []).length}`],
    [
      "Somme des lignes = sous-total + livraison",
      Math.abs(round2(linesTotal) - expectedLines) < 0.01,
      `${round2(linesTotal)} vs ${expectedLines}`,
    ],
    ["TPS identique à la base", Math.abs(round2(tps) - (order.tpsAmount || 0)) < 0.02, `${round2(tps)} vs ${order.tpsAmount}`],
    ["TVQ identique à la base", Math.abs(round2(tvq) - (order.tvqAmount || 0)) < 0.02, `${round2(tvq)} vs ${order.tvqAmount}`],
    ["Total reconstitué = total en base", Math.abs(rebuiltTotal - (order.total || 0)) < 0.02, `${rebuiltTotal} vs ${order.total}`],
  ];

  let failed = 0;
  for (const [label, ok, detail] of checks) {
    if (!ok) failed++;
    console.log(`${ok ? "✅" : "❌"} ${label} — ${detail}`);
  }

  await mongoose.disconnect();
  if (failed > 0) process.exit(1);
  console.log("\nTout est conforme.");
};

run().catch((e) => {
  console.error("ERREUR:", e?.message || e);
  process.exit(1);
});
