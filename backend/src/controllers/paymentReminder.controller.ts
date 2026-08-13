import { Request, Response } from "express";
import Order from "../models/Order.js";
import { resendInvoiceLinkForOrder } from "./payment.controller.js";
import { parseServiceDate } from "../utils/dates.js";

interface OrderWithBilling {
  _id: import("mongoose").Types.ObjectId;
  orderNumber: string;
  clientInfo: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
  };
  billingKind: "standard" | "representant" | "gouvernement";
  paymentDueDate?: Date;
  paymentStatus: "unpaid" | "deposit_paid" | "paid";
  status: string;
  total: number;
}

const BILLING_KIND_LABELS: Record<string, string> = {
  gouvernement: "gouvernemental",
  representant: "représentant",
  standard: "standard"
};

const BILLING_KIND_LABELS_ADMIN: Record<string, string> = {
  gouvernement: "Gouvernemental",
  representant: "Représentant",
  standard: "Standard"
};

/**
 * Date limite EFFECTIVE d'une commande impayée — ALIGNÉE sur l'affichage du
 * tableau de bord (frontend getPaymentDueDateForOrder) pour que le retard vu à
 * l'écran et le retard calculé ici soient identiques :
 *   - représentant → date de ramassage / livraison (PAS le jour de création) ;
 *   - gouvernement → paymentDueDate (ou +60 j) ;
 *   - autres → paymentDueDate.
 * Renvoie null si la commande est déjà payée.
 */
function getEffectiveDueDate(order: any): Date | null {
  const isPaid = order?.paymentStatus === "paid" || order?.depositPaid === true;
  if (isPaid) return null;

  if (order?.billingKind === "representant") {
    if (order.pickupDate) return new Date(order.pickupDate);
    if (order.deliveryDate) return parseServiceDate(order.deliveryDate) || null;
    return new Date(order.orderDate || order.createdAt);
  }
  if (order?.billingKind === "gouvernement") {
    if (order.paymentDueDate) return new Date(order.paymentDueDate);
    const base = new Date(order.orderDate || order.createdAt);
    const due = new Date(base);
    due.setDate(due.getDate() + 60);
    return due;
  }
  if (order?.paymentDueDate) return new Date(order.paymentDueDate);
  return null;
}

/**
 * Traite les rappels de paiement (bouton « Rappels » de l'admin).
 *
 * Comportement (refait le 2026-07-09) : pour chaque commande EN RETARD et
 * IMPAYÉE, on RENVOIE le lien de paiement (facture Square) au client, avec le
 * même email doux « Confirmation de commande » que le renvoi manuel.
 *
 * IMPORTANT : ce traitement n'ANNULE JAMAIS de commande et n'envoie plus le
 * message brutal « votre commande sera annulée » (qui avait supprimé à tort la
 * commande 0080 de Martine Mousseau). L'annulation reste une décision manuelle.
 */
export async function processPaymentReminders(_req: Request, res: Response) {
  try {
    console.log("\n" + "=".repeat(60));
    console.log("🔔 RENVOI DES LIENS DE PAIEMENT (commandes en retard)");
    console.log("=".repeat(60));

    const now = new Date();

    // Toutes les commandes impayées, non annulées / non complétées — tous types
    // de clients (représentant, gouvernement ET standard comme la 0088).
    const unpaidOrders = await Order.find({
      paymentStatus: { $in: ["unpaid", "deposit_paid"] },
      status: { $nin: ["cancelled", "completed"] },
    }).lean();

    let relancesEnvoyees = 0; // liens renvoyés avec succès
    let relancesEnRetard = 0; // parmi les envois : échéance déjà passée
    let relancesAvantEcheance = 0; // parmi les envois : rappel préventif (≤ 7 j)
    let dejaPayees = 0; // la facture Square est déjà payée
    let sansLien = 0; // à rappeler mais aucun lien à renvoyer (à traiter à la main)
    let injoignables = 0; // pas d'email / pas de téléphone
    let erreurs = 0;
    const details: any[] = [];

    for (const order of unpaidOrders) {
      const due = getEffectiveDueDate(order);
      if (!due) continue;
      const daysUntilDue = Math.ceil(
        (due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
      );
      // Fenêtre de rappel : commande EN RETARD (échéance passée) OU à moins de
      // 7 jours de l'échéance (rappel préventif ~1 semaine + 48h avant). On
      // renvoie le lien de paiement à chaque fois — rappel doux, JAMAIS
      // d'annulation, pour TOUS les types (gouvernement, standard, représentant).
      if (daysUntilDue > 7) continue;
      const enRetard = daysUntilDue < 0;

      try {
        const r = await resendInvoiceLinkForOrder(order);
        if (r.success) {
          relancesEnvoyees++;
          if (enRetard) relancesEnRetard++;
          else relancesAvantEcheance++;
          details.push({ commande: order.orderNumber, envoye: r.channel, a: r.dest, enRetard });
          console.log(`   ✅ ${order.orderNumber} → lien renvoyé (${r.channel} à ${r.dest})${enRetard ? " [EN RETARD]" : ""}`);
        } else if (r.code === "ALREADY_PAID") {
          dejaPayees++;
        } else if (r.code === "NO_EMAIL" || r.code === "NO_PHONE") {
          injoignables++;
          details.push({ commande: order.orderNumber, ignore: "aucun contact" });
        } else {
          // NO_INVOICE / NO_URL / CANCELED → aucun lien Square à renvoyer
          sansLien++;
          details.push({ commande: order.orderNumber, ignore: "aucun lien de paiement" });
          console.log(`   ⏭️ ${order.orderNumber} → à rappeler mais aucun lien (${r.code})`);
        }
      } catch (error) {
        erreurs++;
        console.error(`   ❌ Erreur sur ${order.orderNumber}:`, error);
      }
    }

    console.log("\n" + "=".repeat(60));
    console.log(`📧 Liens renvoyés: ${relancesEnvoyees} (en retard: ${relancesEnRetard}, avant échéance: ${relancesAvantEcheance})`);
    console.log(`💰 Déjà payées: ${dejaPayees}`);
    console.log(`⏭️ Sans lien (à traiter à la main): ${sansLien}`);
    console.log(`📭 Injoignables: ${injoignables}`);
    console.log(`❌ Erreurs: ${erreurs}`);
    console.log("=".repeat(60) + "\n");

    res.json({
      success: true,
      message:
        relancesEnvoyees > 0
          ? `${relancesEnvoyees} lien(s) de paiement renvoyé(s) (${relancesEnRetard} en retard, ${relancesAvantEcheance} avant échéance).`
          : "Aucun lien à renvoyer pour le moment.",
      summary: {
        relancesEnvoyees,
        relancesEnRetard,
        relancesAvantEcheance,
        dejaPayees,
        sansLien,
        injoignables,
        erreurs,
      },
      details,
    });
  } catch (error) {
    console.error("❌ Erreur lors du traitement des rappels:", error);
    res.status(500).json({
      success: false,
      message: "Échec du traitement des rappels de paiement",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

/**
 * Get orders with upcoming payment due dates (for admin preview)
 */
export async function getUpcomingPayments(req: Request, res: Response) {
  try {
    const now = new Date();
    const oneMonthFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const upcomingOrders = await Order.find({
      billingKind: { $in: ["gouvernement", "representant"] },
      paymentStatus: { $in: ["unpaid", "deposit_paid"] },
      paymentDueDate: { 
        $exists: true, 
        $ne: null,
        $gte: now,
        $lte: oneMonthFromNow
      },
      status: { $nin: ["cancelled", "completed"] }
    })
    .select("orderNumber clientInfo billingKind paymentDueDate paymentStatus total status")
    .sort({ paymentDueDate: 1 })
    .lean() as unknown as OrderWithBilling[];

    const overdueOrders = await Order.find({
      billingKind: { $in: ["gouvernement", "representant"] },
      paymentStatus: { $in: ["unpaid", "deposit_paid"] },
      paymentDueDate: { 
        $exists: true, 
        $ne: null,
        $lt: now
      },
      status: { $nin: ["cancelled", "completed"] }
    })
    .select("orderNumber clientInfo billingKind paymentDueDate paymentStatus total status")
    .sort({ paymentDueDate: 1 })
    .lean() as unknown as OrderWithBilling[];

    // Calculate days until due/overdue for each order
    const enrichedUpcoming = upcomingOrders.map(order => {
      const dueDate = order.paymentDueDate ? new Date(order.paymentDueDate) : null;
      const daysUntilDue = dueDate ? Math.ceil((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : 0;
      return {
        ...order,
        daysUntilDue,
        billingTypeLabel: BILLING_KIND_LABELS_ADMIN[order.billingKind] || "Standard"
      };
    });

    const enrichedOverdue = overdueOrders.map((order: OrderWithBilling) => {
      const dueDate = order.paymentDueDate ? new Date(order.paymentDueDate) : null;
      const daysOverdue = dueDate ? Math.ceil((now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24)) : 0;
      return {
        ...order,
        daysOverdue,
        billingTypeLabel: BILLING_KIND_LABELS_ADMIN[order.billingKind] || "Standard"
      };
    });

    res.json({
      success: true,
      data: {
        upcoming: enrichedUpcoming,
        overdue: enrichedOverdue,
        summary: {
          upcomingCount: upcomingOrders.length,
          overdueCount: overdueOrders.length
        }
      }
    });
  } catch (error) {
    console.error("❌ Error getting upcoming payments:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get upcoming payments",
      error: error instanceof Error ? error.message : "Unknown error"
    });
  }
}
