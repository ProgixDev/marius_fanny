/**
 * Réparation : commandes marquées « payées » pour un montant JAMAIS encaissé.
 *
 * Contexte — la réconciliation Square et le webhook faisaient
 * `amountPaid = order.total`. Une commande déjà réglée à laquelle on ajoutait
 * des articles était donc re-marquée « payée » au NOUVEAU total dans les 30
 * minutes : le solde dû disparaissait, l'encadré « comment payer la balance ? »
 * ne s'ouvrait plus, et retirer un article réclamait un remboursement pour de
 * l'argent jamais reçu (commandes 359 / 360 / 361 du 18 août 2026).
 *
 * Le code est corrigé ; ce script répare les commandes déjà abîmées en
 * relisant le montant RÉELLEMENT encaissé sur la facture Square.
 *
 * Usage (depuis backend/) :
 *   node scripts/repair-square-amount-paid.js --dry-run            # aperçu, n'écrit rien
 *   node scripts/repair-square-amount-paid.js --orders 0359,0360   # applique aux commandes visées
 *   node scripts/repair-square-amount-paid.js --dry-run --all      # aperçu sur les 60 derniers jours
 *
 * Sans --orders ni --all, le script ne fait rien : on n'applique jamais une
 * correction de paiement en masse par accident.
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { MongoClient, ObjectId } from "mongodb";
import { SquareClient, SquareEnvironment } from "square";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const DRY_RUN = process.argv.includes("--dry-run") || process.argv.includes("-n");
const ALL = process.argv.includes("--all");

const ordersArgIndex = process.argv.findIndex((a) => a === "--orders");
const ORDER_SUFFIXES =
  ordersArgIndex >= 0 && process.argv[ordersArgIndex + 1]
    ? process.argv[ordersArgIndex + 1]
        .split(",")
        .map((s) => s.trim().padStart(4, "0"))
        .filter(Boolean)
    : [];

if (!ORDER_SUFFIXES.length && !ALL) {
  console.error(
    "❌ Préciser --orders 0359,0360,0361 (numéros affichés au back office) ou --all.",
  );
  process.exit(1);
}

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error("❌ MONGODB_URI manquant");
  process.exit(1);
}

const square = new SquareClient({
  token: process.env.SQUARE_ACCESS_TOKEN,
  environment:
    process.env.SQUARE_ENVIRONMENT === "production"
      ? SquareEnvironment.Production
      : SquareEnvironment.Sandbox,
});

/** Montant réellement encaissé sur une facture Square, en dollars (NaN si illisible). */
const collectedDollars = (invoice) => {
  const requests = invoice?.paymentRequests || invoice?.payment_requests || [];
  if (!Array.isArray(requests) || requests.length === 0) return NaN;
  const read = (m) =>
    m?.amount === undefined || m?.amount === null ? null : Number(m.amount);

  let cents = 0;
  let known = false;
  for (const pr of requests) {
    const c = read(pr?.totalCompletedAmountMoney ?? pr?.total_completed_amount_money);
    if (c !== null) {
      cents += c;
      known = true;
    }
  }
  if (known) return cents / 100;

  let computed = 0;
  let computedKnown = false;
  for (const pr of requests) {
    const c = read(pr?.computedAmountMoney ?? pr?.computed_amount_money);
    if (c !== null) {
      computed += c;
      computedKnown = true;
    }
  }
  return computedKnown ? computed / 100 : NaN;
};

const main = async () => {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const orders = client.db().collection("orders");

  const query = {
    status: { $ne: "cancelled" },
    squareInvoiceId: { $exists: true, $nin: [null, ""] },
  };
  if (ORDER_SUFFIXES.length) {
    query.orderNumber = { $regex: `-(${ORDER_SUFFIXES.join("|")})$` };
  } else {
    query.createdAt = { $gte: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000) };
    query.paymentStatus = "paid";
  }

  const docs = await orders.find(query).toArray();
  console.log(
    `🔎 ${docs.length} commande(s) à vérifier${DRY_RUN ? " (APERÇU — aucune écriture)" : ""}\n`,
  );

  let repaired = 0;
  for (const o of docs) {
    const total = o.total || 0;
    const recorded = o.amountPaid || 0;

    if (Array.isArray(o.refunds) && o.refunds.length > 0) {
      console.log(`⏭️  ${o.orderNumber} — remboursement enregistré, on ne touche pas`);
      continue;
    }

    let invoice;
    try {
      const r = await square.invoices.get({ invoiceId: o.squareInvoiceId });
      invoice = r?.invoice || r;
    } catch (e) {
      console.log(`⚠️  ${o.orderNumber} — facture Square illisible (${e?.message || e})`);
      continue;
    }

    const collected = collectedDollars(invoice);
    if (!Number.isFinite(collected)) {
      console.log(`⚠️  ${o.orderNumber} — montant encaissé illisible, on ne touche pas`);
      continue;
    }

    console.log(
      `   ${o.orderNumber} — total ${total.toFixed(2)}$ | enregistré payé ${recorded.toFixed(2)}$ | Square a encaissé ${collected.toFixed(2)}$ (facture ${invoice?.status})`,
    );

    if (collected >= recorded - 0.01) {
      console.log("      ✅ cohérent, rien à faire");
      continue;
    }

    const paymentStatus =
      collected >= total - 0.01 ? "paid" : collected > 0.01 ? "deposit_paid" : "unpaid";
    const update = {
      amountPaid: Number(collected.toFixed(2)),
      paymentStatus,
      depositPaid: collected > 0.01,
      balancePaid: collected >= total - 0.01,
    };

    console.log(
      `      🛠️  correction : ${recorded.toFixed(2)}$ → ${update.amountPaid.toFixed(2)}$ (${paymentStatus}, solde dû ${(total - update.amountPaid).toFixed(2)}$)`,
    );

    if (DRY_RUN) {
      repaired++;
      continue;
    }

    await orders.updateOne(
      { _id: new ObjectId(o._id) },
      {
        $set: {
          ...update,
          ...(update.balancePaid ? {} : { balancePaidAt: null }),
        },
        $push: {
          changeHistory: {
            changedAt: new Date(),
            field: "paymentStatus",
            oldValue: o.paymentStatus,
            newValue: paymentStatus,
            changeType: "payment_updated",
            notes: `Correction : montant payé ramené au réel encaissé chez Square (${update.amountPaid.toFixed(2)}$ sur ${total.toFixed(2)}$)`,
          },
        },
      },
    );
    repaired++;
  }

  console.log(
    `\n${DRY_RUN ? "APERÇU" : "TERMINÉ"} — ${repaired} commande(s) ${DRY_RUN ? "à corriger" : "corrigée(s)"}`,
  );
  await client.close();
};

main().catch((e) => {
  console.error("❌ Échec:", e);
  process.exit(1);
});
