/**
 * Audit « montant payé » : commande (MongoDB) vs Square (source de vérité).
 *
 * Détecte les commandes où `amountPaid` ne correspond PAS à ce que Square a
 * réellement encaissé — typiquement une commande payée puis MODIFIÉE (articles
 * ajoutés) : l'ancien code réécrivait `amountPaid = order.total`, donc la
 * commande s'affichait « payée » au nouveau total alors que le solde de l'ajout
 * n'avait jamais été encaissé.
 *
 * Lecture seule par défaut. Ajouter --fix pour corriger les commandes listées.
 *
 *   bun run scripts/audit-square-amounts.ts 359 360 361
 *   bun run scripts/audit-square-amounts.ts --recent=60      # 60 derniers jours
 *   bun run scripts/audit-square-amounts.ts 359 360 361 --fix
 */

import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config({ path: "./.env" });

import Order from "../src/models/Order.js";
import squareClient from "../src/config/square.js";

const MONGODB_URI =
  process.env.MONGODB_URI ||
  process.env.DATABASE_URL ||
  "mongodb://localhost:27017/marius-fanny";

const args = process.argv.slice(2);
const APPLY = args.includes("--fix");
const recentArg = args.find((a) => a.startsWith("--recent="));
const RECENT_DAYS = recentArg ? Number(recentArg.split("=")[1]) || 30 : null;
const numbers = args.filter((a) => !a.startsWith("--"));

const money = (n: number) => `${(n || 0).toFixed(2)}$`;

/** Cumul réellement encaissé sur une facture Square (dollars, null si inconnu). */
const invoiceCollectedDollars = (invoice: any): number | null => {
  const requests = invoice?.paymentRequests || invoice?.payment_requests;
  if (!Array.isArray(requests) || requests.length === 0) return null;
  let cents = 0;
  let known = false;
  for (const r of requests) {
    const amount = (r?.totalCompletedAmountMoney || r?.total_completed_amount_money)?.amount;
    if (amount == null) continue;
    known = true;
    cents += Number(amount);
  }
  return known ? cents / 100 : null;
};

async function collectedForOrder(order: any) {
  const ids: string[] = Array.from(
    new Set(
      [...((order.squareInvoiceIds as string[]) || []), order.squareInvoiceId].filter(Boolean),
    ),
  );

  let collected = 0;
  let known = false;
  const details: string[] = [];

  for (const id of ids) {
    try {
      const inv = (await squareClient.invoices.get({ invoiceId: id })) as any;
      const invoice = inv?.invoice || inv;
      const amount = invoiceCollectedDollars(invoice);
      details.push(
        `    facture ${id} — statut ${invoice?.status} — encaissé ${amount == null ? "?" : money(amount)}${invoice?.publicUrl ? `\n      ${invoice.publicUrl}` : ""}`,
      );
      if (amount != null) {
        collected += amount;
        known = true;
      }
    } catch (e: any) {
      details.push(`    facture ${id} — INTROUVABLE dans Square (${e?.message || e})`);
    }
  }

  // Paiement direct (hors facture) éventuellement rattaché à la commande.
  if (!known && order.squarePaymentId) {
    try {
      const resp = (await squareClient.payments.get({ paymentId: order.squarePaymentId })) as any;
      const p = resp?.payment;
      const cents = Number(p?.totalMoney?.amount ?? p?.amountMoney?.amount ?? NaN);
      const refunded = Number(p?.refundedMoney?.amount || 0);
      if (Number.isFinite(cents)) {
        collected += (cents - refunded) / 100;
        known = true;
        details.push(
          `    paiement ${order.squarePaymentId} — ${money(cents / 100)} (remboursé ${money(refunded / 100)})`,
        );
      }
    } catch (e: any) {
      details.push(`    paiement ${order.squarePaymentId} — erreur (${e?.message || e})`);
    }
  }

  return { collected, known, details };
}

async function main() {
  await mongoose.connect(MONGODB_URI);
  console.log("✓ MongoDB connecté\n");

  const query: any = {};
  if (numbers.length > 0) {
    // Accepte « 359 » comme « MF-YYYYMMDD-0359 » (ou le numéro complet).
    query.$or = numbers.map((n) => ({
      orderNumber: /^MF-/i.test(n)
        ? n
        : new RegExp(`-0*${n.replace(/\D/g, "")}$`, "i"),
    }));
  } else {
    const days = RECENT_DAYS ?? 30;
    query.createdAt = { $gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000) };
    query.amountPaid = { $gt: 0 };
  }

  const orders = await Order.find(query).sort({ orderNumber: 1 });
  console.log(`${orders.length} commande(s) à vérifier${APPLY ? " — MODE CORRECTION" : " — lecture seule"}\n`);

  let mismatches = 0;

  for (const order of orders) {
    const total = order.total || 0;
    const stored = order.amountPaid || 0;
    const { collected, known, details } = await collectedForOrder(order);

    console.log(
      `▸ ${order.orderNumber} — ${order.clientInfo?.firstName} ${order.clientInfo?.lastName}`,
    );
    console.log(
      `    total ${money(total)} | app: payé ${money(stored)} (${order.paymentStatus}) | Square: ${known ? money(collected) : "inconnu"}`,
    );
    details.forEach((d) => console.log(d));

    if (!known) {
      console.log("    ⚠️  Aucun encaissement Square trouvé (paiement en boutique ?)\n");
      continue;
    }

    const delta = stored - collected;
    if (Math.abs(delta) < 0.01) {
      console.log("    ✅ Concordant\n");
      continue;
    }

    mismatches++;
    console.log(
      `    ❌ ÉCART de ${money(Math.abs(delta))} — l'app ${delta > 0 ? "SURESTIME" : "sous-estime"} le paiement`,
    );
    const remaining = total - collected;
    if (remaining > 0.01) {
      console.log(`    → Solde réellement dû par la cliente : ${money(remaining)}`);
    }

    if (APPLY) {
      order.amountPaid = collected;
      if (collected >= total - 0.01) {
        order.paymentStatus = "paid";
        order.depositPaid = true;
        order.balancePaid = true;
      } else if (collected > 0.01) {
        order.paymentStatus = "deposit_paid";
        order.depositPaid = true;
        order.balancePaid = false;
        order.balancePaidAt = undefined;
      } else {
        order.paymentStatus = "unpaid";
        order.depositPaid = false;
        order.balancePaid = false;
      }
      order.changeHistory.push({
        changedAt: new Date(),
        field: "amountPaid",
        oldValue: stored,
        newValue: collected,
        changeType: "payment_updated",
        notes: "Correction: montant aligné sur l'encaissement réel Square",
      } as any);
      await order.save();
      console.log(`    🛠️  Corrigé → payé ${money(collected)} (${order.paymentStatus})`);
    }
    console.log("");
  }

  console.log(
    `\n${mismatches} écart(s) détecté(s).${mismatches && !APPLY ? " Relancer avec --fix pour corriger." : ""}`,
  );
  await mongoose.disconnect();
}

main().catch(async (e) => {
  console.error("❌", e);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
