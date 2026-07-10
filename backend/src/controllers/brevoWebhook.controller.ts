import { Request, Response } from "express";
import Order from "../models/Order.js";
import { sendEmailBounceAlert } from "../utils/mail.js";

/**
 * Webhook Brevo — reçoit les événements de livraison des courriels.
 *
 * On ne s'intéresse qu'aux ÉCHECS PERMANENTS (adresse invalide / rebond dur /
 * bloqué / spam) : dans ce cas, on marque la commande du client comme
 * « email invalide » (badge dans le back office) et on prévient Fanny par
 * courriel, pour qu'elle puisse rappeler le client.
 *
 * Sécurité : un jeton dans l'URL (?token=…) comparé à BREVO_WEBHOOK_TOKEN.
 */

// Événements Brevo (payload en snake_case) considérés comme un échec permanent.
const FAILURE_EVENTS = new Set([
  "hard_bounce",
  "blocked",
  "invalid_email",
  "spam",
]);

export async function handleBrevoWebhook(req: Request, res: Response) {
  // On répond 200 tout de suite : Brevo ré-essaie si on tarde ou on échoue.
  res.status(200).json({ success: true });

  try {
    const token = String((req.query.token as string) || "");
    const expected = (process.env.BREVO_WEBHOOK_TOKEN || "").trim();
    if (expected && token !== expected) {
      console.warn("⛔ [BREVO WEBHOOK] jeton invalide — ignoré.");
      return;
    }

    const body: any = req.body || {};
    const event = String(body.event || "")
      .toLowerCase()
      .replace(/[\s-]+/g, "_");
    const email = String(body.email || "").trim().toLowerCase();

    if (!email || !FAILURE_EVENTS.has(event)) return;

    const reason = String(body.reason || body.event || event).slice(0, 300);

    // Commande la plus récente (non annulée) de ce client.
    const order = await Order.findOne({
      "clientInfo.email": email,
      status: { $ne: "cancelled" },
    }).sort({ createdAt: -1 });

    if (!order) {
      console.warn(`⚠️ [BREVO WEBHOOK] rebond ${event} pour ${email} — aucune commande trouvée.`);
      return;
    }
    if ((order as any).emailBounced) return; // déjà signalé

    // updateOne (et non order.save()) : on ne modifie QUE ces 3 champs, sans
    // re-valider tout le document (une vieille commande pourrait ne pas passer
    // la validation actuelle du schéma).
    await Order.updateOne(
      { _id: order._id },
      {
        $set: {
          emailBounced: true,
          emailBounceReason: reason,
          emailBounceAt: new Date(),
        },
      },
    );
    console.log(`📭 [BREVO WEBHOOK] ${event} — commande ${order.orderNumber} marquée « email invalide » (${email}).`);

    try {
      await sendEmailBounceAlert({
        orderNumber: order.orderNumber,
        clientName: `${order.clientInfo?.firstName || ""} ${order.clientInfo?.lastName || ""}`.trim(),
        email,
        phone: order.clientInfo?.phone || "",
        reason,
      });
    } catch (e: any) {
      console.error("❌ [BREVO WEBHOOK] alerte courriel échouée:", e?.message);
    }
  } catch (error) {
    console.error("❌ [BREVO WEBHOOK] erreur:", error);
  }
}
