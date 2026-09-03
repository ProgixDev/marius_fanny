/**
 * Remet à « non payé » les commandes gouvernementales marquées payées à tort.
 *
 * Ces clients règlent par chèque ou virement sous 2 mois : ils ne peuvent ni
 * payer par lien, ni payer en magasin. `createOrder` l'empêchait déjà, mais
 * `updateOrder` n'avait aucun garde-fou — un clic sur « Marquer payé »
 * suffisait, et la comptabilité croyait la commande réglée.
 *
 * Ne touche QUE les commandes gouvernementales marquées payées SANS aucun
 * encaissement Square réel (un vrai paiement resterait un fait à conserver).
 *
 * Usage (depuis backend/) :
 *   node scripts/repair-government-paid.mjs           → SIMULATION
 *   node scripts/repair-government-paid.mjs --apply   → applique
 */
import dns from "node:dns";
dns.setServers(["1.1.1.1", "8.8.8.8"]);

import { MongoClient } from "mongodb";
import dotenv from "dotenv";

dotenv.config();

const APPLY = process.argv.includes("--apply");

const run = async () => {
  const client = new MongoClient(process.env.MONGODB_URI, {
    family: 4,
    serverSelectionTimeoutMS: 15000,
  });
  await client.connect();
  const orders = client.db().collection("orders");

  const suspects = await orders
    .find({
      billingKind: "gouvernement",
      squarePaymentId: { $in: [null, undefined] },
      $or: [{ depositPaid: true }, { balancePaid: true }, { paymentStatus: "paid" }],
    })
    .toArray();

  if (suspects.length === 0) {
    console.log("Aucune commande gouvernementale marquée payée à tort.");
    await client.close();
    return;
  }

  console.log(`${suspects.length} commande(s) concernée(s) :\n`);
  for (const o of suspects) {
    const who = `${o.clientInfo?.firstName || ""} ${o.clientInfo?.lastName || ""}`.trim();
    console.log(
      `  ${o.orderNumber}  ${who}  ${Number(o.total || 0).toFixed(2)} $` +
        `  — statut « ${o.paymentStatus} », encaissé ${Number(o.amountPaid || 0).toFixed(2)} $`,
    );

    if (APPLY) {
      await orders.updateOne(
        { _id: o._id },
        {
          $set: {
            depositPaid: false,
            balancePaid: false,
            amountPaid: 0,
            paymentStatus: "unpaid",
          },
          $unset: { depositPaidAt: "", balancePaidAt: "" },
          $push: {
            changeHistory: {
              changedAt: new Date(),
              field: "paymentStatus",
              oldValue: o.paymentStatus,
              newValue: "unpaid",
              changeType: "payment_updated",
              notes:
                "Correction : client gouvernemental marqué payé à tort — règlement par chèque toujours attendu.",
            },
          },
        },
      );
    }
  }

  console.log(
    APPLY
      ? `\n${suspects.length} commande(s) remise(s) à « non payé ».`
      : "\nSimulation uniquement — relancez avec --apply pour écrire en base.",
  );

  await client.close();
};

run().catch((e) => {
  console.error("ERREUR:", e?.message || e);
  process.exit(1);
});
