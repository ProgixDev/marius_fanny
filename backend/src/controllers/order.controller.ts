import { Request, Response } from "express";
import Order from "../models/Order.js";
import { Product } from "../models/Product.js";
import { ProductionItemStatus } from "../models/ProductionItemStatus.js";
import { DailyInventory } from "../models/DailyInventory.js";
import { computeInventoryBuckets } from "../utils/inventoryBuckets.js";
import { loadInventoryLists } from "./dailyInventory.controller.js";
import { User } from "../models/User.js";
import { PromoCode } from "../models/PromoCode.js";
import { PromoRedemption } from "../models/PromoRedemption.js";
import type { ApiResponse, PaginatedResponse } from "../types.js";
import type {
  CreateOrderInput,
  UpdateOrderInput,
  OrderQueryParams,
} from "../schemas/order.schema.js";
import {
  calculateDeliveryFee,
  validateMinimumOrder,
  getAllDeliveryZones,
} from "../utils/deliveryZones.js";
import { sendOrderReceipt } from "../utils/emailService.js";
import {
  sendOrderBalanceEmail,
  sendInvoiceOrderConfirmation,
  sendOrderUpdatedEmail,
} from "../utils/mail.js";
import { parseServiceDate, orderServiceDate } from "../utils/dates.js";
import type { MailAttachment } from "../utils/mail.js";
import { buildInvoicePdf, invoicePdfFilename } from "../utils/invoicePdf.js";
import { sendSms } from "../utils/smsService.js";
import {
  cancelSquareInvoiceById,
  createInvoiceForExistingOrder,
} from "./payment.controller.js";
import { shouldReissuePaymentLink, reissuePaymentLink } from "../utils/paymentLink.js";
import { describeItemChanges, shouldRecordItemChange } from "../utils/orderChanges.js";
import { preparationDays, minimumServiceDate } from "../utils/leadTime.js";
import {
  calculatePromoDiscount,
  isPromoCurrentlyValid,
  normalizePromoCode,
} from "../utils/promo.js";

// Calcul des taxes : source unique partagée avec les commandes pro et les
// soumissions (voir utils/tax.ts).
import { computeTaxBreakdown } from "../utils/tax.js";

/**
 * Create a new order
 * POST /api/orders
 */
export const createOrder = async (
  req: Request<{}, {}, CreateOrderInput>,
  res: Response<ApiResponse>,
) => {
  try {
    const orderData = req.body;

    // --- Anti-doublon : si un paiement Square a déjà servi à créer une commande,
    // on renvoie cette commande au lieu d'en créer une 2e (double-clic / requête
    // rejouée). Chaque paiement Square a un ID unique. ---
    if (orderData.squarePaymentId) {
      const existing = await Order.findOne({
        squarePaymentId: orderData.squarePaymentId,
      });
      if (existing) {
        console.warn(
          `⛔ [ORDER] Doublon évité : le paiement ${orderData.squarePaymentId} a déjà la commande ${existing.orderNumber}`,
        );
        return res.status(200).json({
          success: true,
          data: existing,
          message: "Commande déjà créée pour ce paiement (doublon évité).",
        } as any);
      }
    }

    // --- Cutoff: orders for tomorrow must be placed before 14:00 (Montreal time) ---
    const toMontrealDate = (d: Date) => {
      const s = d.toLocaleDateString("en-CA", { timeZone: "America/Montreal" });
      return s; // "YYYY-MM-DD"
    };
    const getMontrealHour = (d: Date) => {
      return parseInt(d.toLocaleString("en-CA", { timeZone: "America/Montreal", hour: "numeric", hour12: false }));
    };
    // Minutes-since-midnight (Montreal). Used so the *real* cutoff can sit
    // a hair past the *displayed* cutoff — e.g. show "avant 14h00" to
    // customers but accept up to 14:15 internally to absorb clock skew /
    // user hesitation. Change CUTOFF_MINUTES below to retune the margin.
    const getMontrealMinutes = (d: Date) => {
      const hh = parseInt(d.toLocaleString("en-CA", { timeZone: "America/Montreal", hour: "2-digit", hour12: false }));
      const mm = parseInt(d.toLocaleString("en-CA", { timeZone: "America/Montreal", minute: "2-digit" }));
      return hh * 60 + mm;
    };
    // Limite haute acceptée par le serveur = 14h30, pour laisser le BACK OFFICE
    // (admin) saisir une commande jusqu'à 14h30. Le site PUBLIC reste affiché à
    // 14h00 et bloqué à 14h15 côté frontend (Checkout), donc les clients ne sont
    // pas affectés.
    const CUTOFF_MINUTES = 14 * 60 + 30;

    const now = new Date();
    // `deliveryDate` est un jour calendaire « YYYY-MM-DD » : il faut le lire via
    // parseServiceDate, sinon minuit UTC reprojeté à Montréal recule d'un jour
    // et le contrôle de délai porte sur la veille de la date demandée.
    const targetDateStr =
      orderData.pickupDate
        ? toMontrealDate(new Date(orderData.pickupDate))
        : orderData.deliveryDate
          ? String(orderData.deliveryDate).slice(0, 10)
          : null;

    // --- Filet de sécurité "argent sans commande" ---
    // Si la commande est DÉJÀ PAYÉE (paiement Square encaissé), on NE la refuse
    // JAMAIS pour une raison de délai/cutoff/date fermée : la carte du client a
    // été débitée AVANT cet enregistrement, donc refuser ici = argent pris sans
    // commande (exactement le bug "Attention requise" vécu par une cliente).
    // Une commande payée est toujours enregistrée ; si la date pose problème,
    // le back office contacte le client. Les contrôles ci-dessous ne concernent
    // donc que les commandes NON payées à ce stade.
    const isPaidOrder = !!orderData.squarePaymentId;

    if (targetDateStr && !isPaidOrder) {
      const todayStr = toMontrealDate(now);
      const currentMinutes = getMontrealMinutes(now);
      const pastCutoff = currentMinutes >= CUTOFF_MINUTES;
      // Keep currentHour around for any downstream code that still references
      // it; the cutoff decision now uses minutes for the 14h15 margin.
      const currentHour = getMontrealHour(now);
      void currentHour;

      // Compute the minimum allowed pickup date based on the slowest product
      // in the cart. Products are made-to-order, so each item carries its own
      // preparationTimeHours; the order's lead time is the max across items.
      // Items with no prep time (or 0) can ship same-day.
      const productIds = Array.from(
        new Set(
          (orderData.items || [])
            .map((i: any) => i.productId)
            .filter((id: number) => typeof id === "number" && id > 0),
        ),
      );
      const prepProducts = productIds.length
        ? await Product.find({
            id: { $in: productIds },
            deletedAt: { $exists: false },
          })
            .select("id preparationTimeHours")
            .lean()
        : [];
      const prepMap = new Map<number, number>(
        prepProducts.map((p: any) => [p.id, Number(p.preparationTimeHours) || 0]),
      );
      const maxPrepHours = (orderData.items || []).reduce(
        (max: number, item: any) => {
          const h = prepMap.get(item.productId) || 0;
          return h > max ? h : max;
        },
        0,
      );
      const prepDays = preparationDays(maxPrepHours);

      // Délai de préparation + heure limite de 14 h — voir utils/leadTime.ts :
      // la limite ne s'applique qu'à ce qui pourrait être servi dès demain.
      const [tY, tM, tD] = todayStr.split("-").map((s) => parseInt(s, 10));
      const minDateStr = minimumServiceDate(todayStr, prepDays, pastCutoff);

      if (targetDateStr < minDateStr) {
        // Distinguish the "tomorrow blocked because past 14h" case for a
        // clearer error message, since that's the most common rejection.
        const tomorrowDate = new Date(Date.UTC(tY, tM - 1, tD));
        tomorrowDate.setUTCDate(tomorrowDate.getUTCDate() + 1);
        const tomorrowStr = tomorrowDate.toISOString().split("T")[0];

        if (
          prepDays <= 1 &&
          pastCutoff &&
          targetDateStr <= tomorrowStr
        ) {
          return res.status(400).json({
            success: false,
            error:
              "Les commandes pour demain doivent être passées avant 14h00. Veuillez choisir une date ultérieure.",
          });
        }
        return res.status(400).json({
          success: false,
          error:
            prepDays >= 2
              ? `Délai de préparation insuffisant : ${prepDays} jour(s) requis pour les produits sélectionnés.`
              : "Date de ramassage trop proche. Veuillez choisir une autre date.",
        });
      }

      // Reject orders on closed dates (store holidays)
      const { Settings } = await import("../models/Settings.js");
      const siteSettings = await Settings.findOne();
      if (siteSettings?.closedDates && siteSettings.closedDates.length > 0) {
        // targetDateStr is "YYYY-MM-DD", extract "MM-DD"
        const targetMMDD = targetDateStr.slice(5); // "MM-DD"
        if (siteSettings.closedDates.includes(targetMMDD)) {
          return res.status(400).json({
            success: false,
            error:
              "Le magasin est fermé à cette date. Veuillez choisir une autre date.",
          });
        }
      }
    }

    // Calculate totals
    const subtotal = orderData.items.reduce(
      (sum, item) => sum + item.amount,
      0,
    );

    // Promo code (optional)
    const nowForPromo = new Date();
    let promoDoc: any = null;
    let promoCode: string | undefined;
    let promoDiscountAmount = 0;
    let promoDiscountPercent: number | undefined;
    let promoAppliesToProductIds: number[] | undefined;

    if (orderData.promoCode && String(orderData.promoCode).trim()) {
      promoCode = normalizePromoCode(orderData.promoCode);
      promoDoc = await PromoCode.findOne({
        code: promoCode,
        deletedAt: null,
      });

      // Commande DÉJÀ PAYÉE : un souci de code promo ne doit JAMAIS refuser la
      // commande (sinon l'argent est encaissé sans commande). Dans ce cas on
      // abandonne simplement le promo (aucun rabais appliqué) et on continue ;
      // le back office ajuste si besoin. Commande NON payée = comportement
      // habituel (rejet 400).
      const rejectOrSkipPromo = (
        status: number,
        error: string,
      ): "reject" | "skip" => {
        if (isPaidOrder) {
          console.warn(
            `[ORDER] Commande payée : promo "${promoCode}" ignoré (${error}) — commande conservée.`,
          );
          promoCode = undefined;
          promoDoc = null;
          return "skip";
        }
        res.status(status).json({ success: false, error });
        return "reject";
      };

      let promoOk = true;

      if (!promoDoc) {
        if (rejectOrSkipPromo(400, "Code promo invalide") === "reject") return;
        promoOk = false;
      }

      if (promoOk && promoDoc) {
        const validity = isPromoCurrentlyValid(promoDoc, nowForPromo);
        if (!validity.ok) {
          if (rejectOrSkipPromo(400, validity.reason) === "reject") return;
          promoOk = false;
        }
      }

      if (promoOk && promoDoc) {
        const discount = calculatePromoDiscount({
          promo: promoDoc,
          items: orderData.items,
          subtotal,
        });

        if (discount.discountAmount <= 0) {
          if (
            rejectOrSkipPromo(
              400,
              "Ce code promo ne s'applique pas à votre panier.",
            ) === "reject"
          )
            return;
          promoOk = false;
        }

        if (promoOk) {
          const perUserLimit =
            promoDoc.usageLimitPerUser === undefined ? 1 : promoDoc.usageLimitPerUser;

          // Force per-user limit to at least 1 if not explicitly set to 0
          // This ensures promo codes can't be reused infinitely
          const effectivePerUserLimit = perUserLimit === 0 ? 1 : perUserLimit;

          if (effectivePerUserLimit > 0) {
            const userId = req.user?.id;
            const email = (orderData.clientInfo?.email || "").trim().toLowerCase();

            // Get client IP address for additional tracking
            const clientIP = req.headers['x-forwarded-for'] as string ||
                            req.headers['x-real-ip'] as string ||
                            req.ip ||
                            'unknown';
            const ipAddress = clientIP.split(',')[0].trim();

            // Build filter to check usage - match by userId, email, OR IP
            // This prevents users from simply changing email to reuse promo codes
            const filterConditions: Record<string, any>[] = [];

            if (userId) {
              filterConditions.push({ userId });
            }
            if (email) {
              filterConditions.push({ email });
            }
            // Also check by IP address (all IPs including localhost)
            if (ipAddress && ipAddress !== 'unknown') {
              filterConditions.push({ ipAddress });
            }

            // Allow promo code usage even without login - we just track what we can
            // No error is thrown if filterConditions is empty

            // Count usages by this user/email/IP.
            // We also check existing orders by promoCode+email as a safety net.
            console.log("📋 [PROMO] Checking usage for email:", email, "userId:", userId, "IP:", ipAddress);
            const [redemptionCount, orderCountByEmail] = await Promise.all([
              PromoRedemption.countDocuments({
                promoCodeId: promoDoc._id,
                $or: filterConditions,
              }),
              email
                ? Order.countDocuments({
                    promoCode,
                    "clientInfo.email": email,
                  })
                : Promise.resolve(0),
            ]);

            console.log("📋 [PROMO] redemptionCount:", redemptionCount, "orderCountByEmail:", orderCountByEmail, "perUserLimit:", effectivePerUserLimit);

            if (Math.max(redemptionCount, orderCountByEmail) >= effectivePerUserLimit) {
              if (
                rejectOrSkipPromo(
                  400,
                  "Limite d'utilisation atteinte pour ce code promo.",
                ) === "reject"
              )
                return;
              promoOk = false;
            }
          }
        }

        if (promoOk && promoDoc) {
          promoDiscountAmount = discount.discountAmount;
          promoDiscountPercent = promoDoc.discountPercent;
          promoAppliesToProductIds = promoDoc.appliesToProductIds || undefined;
        }
      }
    }

    const taxBreakdown = await computeTaxBreakdown(orderData.items as any);
    const taxAmount = taxBreakdown.total;
    let deliveryFee = 0;

    // If delivery, calculate and validate delivery fee
    if (orderData.deliveryType === "delivery" && orderData.deliveryAddress) {
      const deliveryInfo = calculateDeliveryFee(
        orderData.deliveryAddress.postalCode,
      );

      if (!deliveryInfo.isValid) {
        // Commande DÉJÀ PAYÉE : on ne refuse jamais. Frais 0 par défaut, le back
        // office ajustera. Sinon (commande non payée) on bloque normalement.
        if (!isPaidOrder) {
          return res.status(400).json({
            success: false,
            error: "Code postal non valide pour la livraison",
          });
        }
        console.warn(
          `[ORDER] Commande payée : code postal "${orderData.deliveryAddress.postalCode}" invalide — frais de livraison à vérifier par le back office.`,
        );
      } else {
        deliveryFee = deliveryInfo.fee;

        // Validate minimum order
        const minimumValidation = validateMinimumOrder(
          orderData.deliveryAddress.postalCode,
          subtotal,
        );

        if (!minimumValidation.isValid && !isPaidOrder) {
          return res.status(400).json({
            success: false,
            error: `Montant minimum de commande non atteint. Minimum requis: ${minimumValidation.minimumOrder.toFixed(2)}$ pour ${minimumValidation.postalCode}. Il manque ${minimumValidation.shortfall.toFixed(2)}$.`,
          });
        }
      }
    }

    const total = Math.max(0, subtotal - promoDiscountAmount) + taxAmount + deliveryFee;
    // In-store/full payments are charged at 100%; deposit flow stays at 50%.
    const depositAmount = orderData.paymentType === "full" ? total : total * 0.5;

    // Government clients NEVER have depositPaid=true at creation — they pay by cheque/transfer
    const isGovernmentClient = orderData.billingKind === "gouvernement";

    // Determine payment status based on payment type and depositPaid flag
    const paidInStore = !isGovernmentClient && orderData.paymentType === "full" && orderData.depositPaid === true;
    let depositPaid = false;
    let balancePaid = false;

    if (!isGovernmentClient && orderData.paymentType === "full" && orderData.depositPaid) {
      // Full payment made upfront
      depositPaid = true;
      balancePaid = true;
    } else if (!isGovernmentClient && orderData.paymentType === "deposit" && orderData.depositPaid) {
      // Deposit payment made
      depositPaid = true;
      balancePaid = false;
    }

    // Billing privileges - look up from client email in all cases
    let billingKind: "standard" | "representant" | "gouvernement" | undefined;
    // Organisation (company / school) shown on the facture. Per-order value
    // wins; else the client's saved billing.organization is used.
    let billingOrganization: string | undefined =
      ((orderData as any).billingOrganization || "").trim() || undefined;
    // 2nd email for government clients (e.g. the city's accounts-payable) that
    // receives the invoice/facture. Per-order value wins; else the client's
    // saved billing.invoiceEmail is used.
    let billingEmail: string | undefined =
      ((orderData as any).billingEmail || "").trim().toLowerCase() || undefined;
    let paymentDueDate: Date | undefined;

    const orderEmail = (orderData.clientInfo?.email || "").trim().toLowerCase();
    
    // Always try to look up billing info from the client email
    console.log("📋 [BILLING] Looking up billing for email:", orderEmail);
    
    if (orderEmail) {
      const billingUser = await User.findOne({ email: orderEmail })
        .select("billing")
        .lean();
      const billing = (billingUser as any)?.billing;
      
      console.log("📋 [BILLING] Found user:", billingUser ? "YES" : "NO");
      console.log("📋 [BILLING] Billing info:", JSON.stringify(billing));
      
      if (billing) {
        billingKind = billing?.kind || orderData.billingKind || "standard";
        if (!billingOrganization) billingOrganization = billing?.organization || undefined;
        if (!billingEmail) {
          billingEmail = ((billing as any)?.invoiceEmail || "").trim().toLowerCase() || undefined;
        }
        console.log("📋 [BILLING] Setting billingKind:", billingKind);

        const allowUnpaidOrders = !!billing?.allowUnpaidOrders;
        const termsDays = Number.isFinite(billing?.paymentTermsDays)
          ? Number(billing.paymentTermsDays)
          : 0;
        
        // For government clients, always use 60 days if not explicitly set to something else
        // For representatives, use 0 days (pay on delivery) unless specified
        let effectiveTermsDays: number;
        if (billingKind === "gouvernement") {
          // Always default to 60 days for government, unless explicitly set otherwise
          effectiveTermsDays = termsDays > 0 ? termsDays : 180;
        } else if (billingKind === "representant") {
          effectiveTermsDays = termsDays;
        } else {
          effectiveTermsDays = termsDays;
        }

        // If the client is allowed to order without paying, keep payment status as "unpaid"
        // and track a due date when not paid yet.
        // Also set due date for government clients even if they need to pay
        console.log("📋 [BILLING] allowUnpaidOrders:", allowUnpaidOrders);
        console.log("📋 [BILLING] depositPaid:", depositPaid);
        console.log("📋 [BILLING] billingKind:", billingKind);
        console.log("📋 [BILLING] effectiveTermsDays:", effectiveTermsDays);
        
        // For government and representative clients, ALWAYS set depositPaid to false
        // regardless of what the frontend sent. They should pay later, not upfront.
        if (billingKind === "gouvernement" || billingKind === "representant") {
          console.log("📋 [BILLING] FORCING depositPaid to false for", billingKind);
          depositPaid = false;
          balancePaid = false;
        }
        
        if ((allowUnpaidOrders && !depositPaid) || billingKind === "gouvernement") {
          const due = new Date();
          due.setDate(due.getDate() + Math.max(0, effectiveTermsDays));
          paymentDueDate = due;
          console.log("📋 [BILLING] Setting paymentDueDate to:", paymentDueDate);
        } else {
          console.log("📋 [BILLING] NOT setting paymentDueDate");
        }
      }
    }

    // If no billing info found from DB, use the billingKind from the request body
    if (!billingKind && orderData.billingKind) {
      billingKind = orderData.billingKind;
      if (billingKind === "gouvernement") {
        depositPaid = false;
        balancePaid = false;
        const due = new Date();
        due.setDate(due.getDate() + 180);
        paymentDueDate = due;
      } else if (billingKind === "representant") {
        depositPaid = false;
        balancePaid = false;
      }

      // Create or update the client in DB with the billing info
      if (orderEmail) {
        try {
          const existingUser = await User.findOne({ email: orderEmail });
          if (!existingUser) {
            await User.create({
              email: orderEmail,
              name: `${orderData.clientInfo.firstName} ${orderData.clientInfo.lastName}`.trim(),
              role: "user",
              status: "placeholder",
              emailVerified: false,
              billing: {
                kind: billingKind,
                allowUnpaidOrders: billingKind !== "standard",
                paymentTermsDays: billingKind === "gouvernement" ? 180 : 0,
              },
            });
            console.log(`✅ New client created: ${orderEmail} (${billingKind})`);
          } else if (!existingUser.billing?.kind || existingUser.billing.kind === "standard") {
            existingUser.billing = {
              kind: billingKind,
              allowUnpaidOrders: billingKind !== "standard",
              paymentTermsDays: billingKind === "gouvernement" ? 180 : 0,
            };
            await existingUser.save();
            console.log(`✅ Client billing updated: ${orderEmail} (${billingKind})`);
          }
        } catch (userErr: any) {
          console.error(`⚠️ Failed to create/update client:`, userErr.message);
        }
      }
    }

    // Filet de sécurité : un client représentant/gouvernement a une commande
    // TOUJOURS créée IMPAYÉE (sauf s'il y a un vrai paiement Square), quel que
    // soit le chemin de détection ci-dessus (profil client en base OU billingKind
    // du formulaire). Sans ça, une commande représentant pouvait être enregistrée
    // « payée » et envoyer un faux email « paiement complet effectué » sans créer
    // de lien de paiement (cas Martine Mousseau, 4 juillet 2026).
    if (
      (billingKind === "representant" || billingKind === "gouvernement") &&
      !orderData.squarePaymentId
    ) {
      depositPaid = false;
      balancePaid = false;
    }

    // Create order
    let pickupDate: Date | undefined;
    if (orderData.pickupDate) {
      pickupDate = new Date(orderData.pickupDate);
    } else if (orderData.deliveryType === "pickup" && orderData.deliveryDate) {
      // Sans créneau connu on ancre à MIDI, pas à minuit : minuit heure serveur
      // (UTC en production) reprojeté à Montréal retombe sur la VEILLE, et la
      // date de ramassage affichée reculait alors d'un jour.
      const raw = String(orderData.deliveryTimeSlot || "").trim();
      const slot = /^([01]\d|2[0-3]):[0-5]\d/.test(raw) ? raw.slice(0, 5) : "12:00";
      pickupDate = new Date(`${orderData.deliveryDate}T${slot}:00`);
    }

    // For representatives: payment due on pickup/delivery date (not 60 days like government).
    // On force TOUJOURS cette date (sans le garde !paymentDueDate) : sinon, quand
    // le client est reconnu via son profil, la date limite avait déjà été fixée au
    // jour de création (termes = 0), et le paiement était considéré en retard dès
    // le départ → annulation auto erronée (cas Martine Mousseau 0080, 8 juillet).
    if (billingKind === "representant") {
      if (pickupDate) {
        paymentDueDate = pickupDate;
        console.log("📋 [BILLING] Setting representative paymentDueDate to pickupDate:", paymentDueDate);
      } else if (orderData.deliveryDate) {
        paymentDueDate = parseServiceDate(orderData.deliveryDate);
        console.log("📋 [BILLING] Setting representative paymentDueDate to deliveryDate:", paymentDueDate);
      } else {
        // No pickup/delivery date - payment due same day as order
        paymentDueDate = new Date();
        console.log("📋 [BILLING] Setting representative paymentDueDate to today (same day payment)");
      }
    }

    // Resolve which user this order belongs to. req.user is whoever is
    // *posting* the request — often an admin acting on behalf of a client.
    // If we naively use req.user.id, the admin's id ends up on the order and
    // the actual client can't see it on their /Mon compte page (the query
    // there filters by their own user id). Always prefer matching the
    // order's clientInfo.email to a real user record.
    let resolvedUserId: string | undefined = req.user?.id;
    if (orderEmail) {
      const matched = await User.findOne({ email: orderEmail }).select("_id").lean();
      if (matched?._id) {
        resolvedUserId = matched._id.toString();
      }
    }

    const order = new Order({
      userId: resolvedUserId,
      clientInfo: orderData.clientInfo,
      pickupDate,
      pickupLocation: orderData.pickupLocation,
      deliveryType: orderData.deliveryType,
      deliveryDate: orderData.deliveryDate,
      deliveryTimeSlot: orderData.deliveryTimeSlot,
      deliveryAddress: orderData.deliveryAddress,
      items: orderData.items,
      subtotal,
      promoCode,
      promoDiscountPercent,
      promoDiscountAmount,
      promoAppliesToProductIds,
      taxAmount,
      tpsAmount: taxBreakdown.tps,
      tvqAmount: taxBreakdown.tvq,
      deliveryFee,
      total,
      depositAmount,
      paymentType: orderData.paymentType || "full",
      paymentLinkChannel: orderData.paymentLinkChannel || "email",
      depositPaid,
      balancePaid,
      amountPaid: balancePaid ? total : depositPaid ? depositAmount : 0,
      billingKind,
      billingOrganization,
      billingEmail,
      takenByInitials: (orderData as any).takenByInitials || undefined,
      paymentDueDate,
      squarePaymentId: orderData.squarePaymentId,
      notes: orderData.notes,
    });

    try {
      await order.save();
      console.log("✅ Order saved successfully:", order.orderNumber);
    } catch (saveError: any) {
      console.error("❌ Error saving order:", saveError.message, saveError.stack);
      return res.status(500).json({
        success: false,
        error: "Erreur lors de la sauvegarde de la commande",
        message: saveError.message,
      });
    }

    // Redeem promo (if any) before other side-effects
    if (promoDoc && promoCode && promoDiscountAmount > 0) {
      try {
        const promoUpdateFilter: Record<string, any> = {
          _id: promoDoc._id,
          deletedAt: null,
          isActive: true,
        };
        if (promoDoc.usageLimit !== undefined) {
          promoUpdateFilter.timesUsed = { $lt: promoDoc.usageLimit };
        }

        const updated = await PromoCode.updateOne(
          promoUpdateFilter,
          { $inc: { timesUsed: 1 } },
        );

        if (!updated.modifiedCount) {
          // Commande DÉJÀ PAYÉE : ne JAMAIS supprimer une commande payée pour un
          // souci de code promo. On garde la commande telle quelle (le rabais
          // reste appliqué, le back office peut ajuster) et on saute juste le
          // suivi de redemption.
          if (isPaidOrder) {
            console.warn(
              `[ORDER] Commande payée ${order.orderNumber} : promo "${promoCode}" non décrémenté (plus disponible) — commande conservée.`,
            );
          } else {
            await order.deleteOne();
            return res.status(400).json({
              success: false,
              error: "Ce code promo n'est plus disponible.",
            });
          }
        } else {
          await new PromoRedemption({
          promoCodeId: promoDoc._id,
          code: promoCode,
          orderId: order._id,
          userId: req.user?.id,
          email: (orderData.clientInfo?.email || "").trim().toLowerCase() || undefined,
          ipAddress: (() => {
            const clientIP = req.headers['x-forwarded-for'] as string || 
                            req.headers['x-real-ip'] as string || 
                            req.ip || 
                            'unknown';
            const ip = clientIP.split(',')[0].trim();
            return (ip && ip !== 'unknown' && ip !== '127.0.0.1' && ip !== '::1') ? ip : undefined;
          })(),
          discountAmount: promoDiscountAmount,
          redeemedAt: new Date(),
          }).save();
        }
      } catch (promoErr: any) {
        // Best-effort rollback
        try {
          await PromoCode.updateOne(
            { _id: promoDoc._id },
            { $inc: { timesUsed: -1 } },
          );
        } catch {}
        // Commande DÉJÀ PAYÉE : ne jamais supprimer / refuser pour un souci de
        // promo. On garde la commande (le back office ajuste si nécessaire).
        if (isPaidOrder) {
          console.warn(
            `[ORDER] Commande payée ${order.orderNumber} : erreur promo ignorée — commande conservée.`,
            promoErr?.message,
          );
        } else {
          await order.deleteOne();
          return res.status(400).json({
            success: false,
            error: promoErr?.message || "Erreur lors de l'application du code promo.",
          });
        }
      }
    }

    // Automatically create a client record when this email does not exist yet.
    try {
      const normalizedEmail = (orderData.clientInfo?.email || "").trim().toLowerCase();
      // Pas d'email (client sans courriel) → aucun compte client à créer/synchroniser.
      if (normalizedEmail) {
      const firstName = (orderData.clientInfo?.firstName || "").trim();
      const lastName = (orderData.clientInfo?.lastName || "").trim();
      const fullName = `${firstName} ${lastName}`.trim();
      const normalizedPhone = (orderData.clientInfo?.phone || "").trim();

      const existingClient = await User.findOne({ email: normalizedEmail });

      if (!existingClient) {
        await User.findOneAndUpdate(
          { email: normalizedEmail },
          {
            $setOnInsert: {
              email: normalizedEmail,
              role: "user",
              status: "active",
              emailVerified: true,
            },
            $set: {
              name: fullName,
              "profile.phoneNumber": normalizedPhone,
            },
          },
          {
            upsert: true,
            new: true,
            setDefaultsOnInsert: true,
            runValidators: true,
          },
        );

        console.log("✅ Client auto-created from order:", normalizedEmail);
      } else if (existingClient.role === "user") {
        const needsUpdate =
          existingClient.name !== fullName ||
          (existingClient.profile?.phoneNumber || "") !== normalizedPhone ||
          existingClient.status !== "active" ||
          existingClient.emailVerified !== true ||
          existingClient.isDeleted === true;

        if (needsUpdate) {
          await User.updateOne(
            { _id: existingClient._id },
            {
              $set: {
                name: fullName,
                status: "active",
                emailVerified: true,
                isDeleted: false,
                "profile.phoneNumber": normalizedPhone,
              },
              $unset: {
                deletedAt: 1,
              },
            },
            { runValidators: true },
          );

          console.log("✅ Existing client synced from order:", normalizedEmail);
        }
      } else {
        console.warn(
          "⚠️ Auto-create client skipped because email belongs to non-client role:",
          normalizedEmail,
          existingClient.role,
        );
      }
      } // fin if (normalizedEmail)
    } catch (clientError: any) {
      console.error(
        "⚠️ Failed to auto-create client from order:",
        clientError.message,
        clientError.stack,
      );
    }

    // Update daily inventory - add order quantities to Comm CLIENT column
    // Auto-create entry if product doesn't exist but is in known inventory list
    try {
      const inventoryDate = orderData.pickupDate 
        ? new Date(orderData.pickupDate).toISOString().split('T')[0]
        : orderData.deliveryDate 
          ? new Date(orderData.deliveryDate).toISOString().split('T')[0]
          : new Date().toISOString().split('T')[0];

      console.log(`📦 [INVENTORY] Processing order for inventory date: ${inventoryDate}`);
      console.log(`📦 [INVENTORY] Order items:`, orderData.items.map(i => `${i.productName}: ${i.quantity}`).join(', '));

      // The app stores TWO inventory docs per day:
      //   - Journalier   →  date "YYYY-MM-DD"
      //   - Frais / Four →  date "YYYY-MM-DD__four"
      // Each product belongs to exactly one of those feuilles; routing them
      // to the wrong doc means the Frais page never sees éclairs etc.
      // Product lists (JOURNALIER_PRODUCTS / FOUR_PRODUCTS) and the matching
      // logic now live in ../utils/inventoryBuckets.ts. Only `normalize` is
      // kept here, used by applyToInventory to match an existing inventory row.

      // Normalize for fuzzy matching. The basic version (lowercase + remove
      // accents + collapse spaces) missed real-world variations like:
      //   "Mille-feuilles" vs "Millefeuille"            (hyphen + plural)
      //   "Tartelette aux fraise" vs "Tartelette fraise" (article)
      //   "\u00c9clairs chocolat" vs "\u00c9clair chocolat"        (plural)
      // So we additionally strip hyphens/apostrophes, drop common French
      // articles ("aux", "au", "de"\u2026), and strip trailing 's' from each
      // significant word before comparing.
      const STOPWORDS = new Set([
        "aux", "au", "a", "de", "du", "des", "le", "la", "les", "et", "l",
      ]);
      const stripPlural = (w: string) =>
        w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w;
      const normalize = (s: string) =>
        s
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[-''`]/g, " ")
          .replace(/[^a-z0-9\s.]/g, " ")
          .split(/\s+/)
          .filter((w) => w && !STOPWORDS.has(w))
          .map(stripPlural)
          // Join WITHOUT spaces: spelling variants that differ only by a
          // space/hyphen collapse to the SAME token, so "Mille-feuilles" and
          // "Millefeuille" both become "millefeuille" and match correctly.
          // Genuinely different products stay distinct because they have
          // different WORDS: "croissant" vs "croissantfromage" vs
          // "croissantpistache" — so they never merge into one inventory row.
          .join("")
          .trim();

      // Bucket order items onto the Journalier / Frais rows. The matching logic
      // lives in ../utils/inventoryBuckets.ts and runs against the LIVE editable
      // lists (the names Fanny maintains on the inventory screens) so a renamed
      // row catches its orders instead of spawning an orphan row.
      const { journalier: journalierList, four: fourList } = await loadInventoryLists();
      const { journalierQty, fourQty } = computeInventoryBuckets(
        orderData.items,
        journalierList,
        fourList,
      );

      // Apply a bucket of {productName: qty} to the inventory doc at dateKey,
      // either updating an existing entry's client column or creating one.
      const applyToInventory = async (
        dateKey: string,
        quantities: Record<string, number>,
        label: string,
      ) => {
        if (Object.keys(quantities).length === 0) {
          console.log(`📦 [INVENTORY:${label}] Nothing to apply to ${dateKey}`);
          return;
        }
        let inventory = await DailyInventory.findOne({ date: dateKey });
        if (!inventory) {
          inventory = new DailyInventory({ date: dateKey, entries: [] });
        }
        let updated = 0;
        let created = 0;
        for (const [productName, quantity] of Object.entries(quantities)) {
          const normalizedName = normalize(productName);
          // Match an existing inventory row ONLY by exact name or exact
          // normalized name. We deliberately DO NOT use substring/.includes()
          // matching here: it collapsed distinct products into one row
          // ("croissant pistache" contains "croissant", so all croissant
          // variants summed into a single "Croissant" entry = 8 instead of
          // 3 separate rows). Each distinct product keeps its own row.
          let entryIndex = inventory.entries.findIndex(e => e.productName === productName);
          if (entryIndex < 0) {
            entryIndex = inventory.entries.findIndex(e => normalize(e.productName) === normalizedName);
          }
          if (entryIndex >= 0) {
            const currentClient =
              typeof inventory.entries[entryIndex].client === "number"
                ? (inventory.entries[entryIndex].client as number)
                : 0;
            const currentStdo =
              typeof inventory.entries[entryIndex].stdo === "number"
                ? (inventory.entries[entryIndex].stdo as number)
                : 0;
            inventory.entries[entryIndex].client = currentClient + quantity;
            inventory.entries[entryIndex].total = currentStdo + currentClient + quantity;
            updated++;
          } else {
            inventory.entries.push({
              productId: productName,
              productName: productName,
              stock_stdo: 0,
              stdo: 0,
              berri: 0,
              comm_berri: 0,
              client: quantity,
              total: quantity,
            });
            created++;
          }
        }
        await inventory.save();
        console.log(`✅ [INVENTORY:${label}] ${dateKey} — ${updated} updated, ${created} created`);
      };

      await applyToInventory(inventoryDate, journalierQty, "Journalier");
      await applyToInventory(`${inventoryDate}__four`, fourQty, "Frais");
    } catch (inventoryError: any) {
      console.error(`⚠️ Failed to update daily inventory:`, inventoryError.message);
    }

    // Send order receipt email based on payment type
    try {
      const customerName = `${orderData.clientInfo.firstName} ${orderData.clientInfo.lastName}`;

      // Determine receipt mode:
      // - Paid in store / has squarePaymentId → "full" (receipt with summary, payment confirmed)
      // - Deposit-only paid via Square → "deposit" (shows deposit + remaining balance)
      // - Government → "invoice" (no Square link, paid later by cheque/transfer)
      // - Pending payment-link → SKIP. The frontend will call createInvoice
      //   right after, which sends its own branded "Confirmation de commande"
      //   email containing the actual Square publicUrl. Sending one here too
      //   would duplicate the email AND the first copy would have no link
      //   (the Square invoice hasn't been published yet at this point).
      const isGovernment = billingKind === "gouvernement";
      const isRepresentant = billingKind === "representant";
      // « Payé en magasin » réel = basé sur l'état FINAL du client (après forçage
      // représentant/gouvernement), pas sur le depositPaid brut reçu. Empêche un
      // reçu « paiement complet effectué » sur une commande représentant/
      // gouvernement créée impayée (qui doit recevoir un lien, pas un reçu).
      const effectivePaidInStore =
        paidInStore && !isGovernment && !isRepresentant;
      const isPaymentLinkFlow =
        !effectivePaidInStore && !orderData.squarePaymentId && !isGovernment;

      if (isPaymentLinkFlow) {
        console.log(
          `📧 [ORDER] Skipping confirmation email — payment-link flow; createInvoice will send the branded email with the Square link.`,
        );
      } else if (!(orderData.clientInfo?.email || "").trim()) {
        console.log("📧 [ORDER] Pas d'email client — aucun reçu envoyé.");
      } else {
        const receiptMode: "full" | "deposit" | "invoice" = effectivePaidInStore
          ? "full"
          : isGovernment
            ? "invoice"
            : orderData.squarePaymentId && orderData.paymentType === "deposit"
              ? "deposit"
              : "full";

        const receiptPayload = {
          email: orderData.clientInfo.email || "",
          name: customerName,
          orderNumber: order.orderNumber,
          items: orderData.items.map((item) => ({
            productName: item.productName,
            quantity: item.quantity,
            amount: item.amount,
          })),
          subtotal,
          taxAmount,
          tpsAmount: taxBreakdown.tps,
          tvqAmount: taxBreakdown.tvq,
          deliveryFee,
          total,
          depositAmount: depositPaid ? depositAmount : undefined,
          paymentId: orderData.squarePaymentId,
          invoiceUrl: undefined, // Will be updated via webhook or separate call
          orderDate: order.orderDate,
          pickupDate: orderServiceDate(order),
          pickupTimeSlot: orderData.deliveryTimeSlot || undefined,
          deliveryType: orderData.deliveryType,
          clientNote: orderData.notes,
          orderId: order._id.toString(),
        };

        // Clients gouvernementaux : la facture part EN PIÈCE JOINTE (PDF). Le
        // service des comptes payables d'une ville doit archiver un fichier —
        // le bouton « Télécharger la facture » ne suffit pas.
        const contactEmail = (orderData.clientInfo.email || "").trim().toLowerCase();
        const hasSeparateBillingEmail = !!billingEmail && billingEmail !== contactEmail;
        let invoiceAttachments: MailAttachment[] | undefined;

        if (isGovernment) {
          try {
            const pdf = await buildInvoicePdf({
              orderNumber: order.orderNumber,
              orderDate: order.orderDate,
              clientName: customerName,
              clientEmail: orderData.clientInfo.email,
              clientPhone: orderData.clientInfo.phone,
              organization: billingOrganization,
              deliveryType: orderData.deliveryType,
              pickupLocation: (order as any).pickupLocation,
              deliveryAddress: (order as any).deliveryAddress,
              serviceDate: orderServiceDate(order) || null,
              timeSlot: orderData.deliveryTimeSlot || undefined,
              items: orderData.items.map((item: any) => ({
                productName: item.productName,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                amount: item.amount,
                notes: item.notes,
                selectedOptions: item.selectedOptions,
              })),
              subtotal,
              tpsAmount: taxBreakdown.tps,
              tvqAmount: taxBreakdown.tvq,
              taxAmount,
              deliveryFee,
              total,
              amountPaid: (order as any).amountPaid || 0,
              notes: orderData.notes,
            });
            invoiceAttachments = [
              {
                filename: invoicePdfFilename(order.orderNumber),
                content: pdf,
                contentType: "application/pdf",
              },
            ];
          } catch (pdfError: any) {
            // Une facture PDF ratée ne doit jamais empêcher le courriel.
            console.error(
              "⚠️ [FACTURE PDF] Génération impossible:",
              pdfError?.message || pdfError,
            );
          }
        }

        if (isGovernment) {
          // Gov contact #1: a CONFIRMATION without the facture breakdown — just
          // the order + total. The facture (with tax breakdown) goes to the
          // billing email below. Le PDF n'y est joint QUE s'il n'y a pas de
          // courriel de facturation distinct — sinon personne ne recevrait la
          // facture.
          await sendInvoiceOrderConfirmation(
            receiptPayload.email,
            receiptPayload.name,
            receiptPayload.orderNumber,
            receiptPayload.items,
            receiptPayload.subtotal,
            receiptPayload.taxAmount,
            receiptPayload.deliveryFee,
            receiptPayload.total,
            undefined,
            receiptPayload.orderDate,
            receiptPayload.pickupDate,
            receiptPayload.pickupTimeSlot,
            receiptPayload.deliveryType,
            receiptPayload.clientNote,
            receiptPayload.orderId,
            false, // asFacture → stays a "Confirmation"
            true,  // hideBreakdown → no facture for the contact
            billingOrganization, // organization shown in the header
            { tps: receiptPayload.tpsAmount, tvq: receiptPayload.tvqAmount },
            hasSeparateBillingEmail ? undefined : invoiceAttachments,
          );
        } else {
          await sendOrderReceipt(receiptMode, receiptPayload);
        }

        console.log(
          `✅ Order receipt email (mode=${receiptMode}) sent to ${orderData.clientInfo.email}`,
        );

        // Receipt already sent here → mark so a later Square payment webhook
        // doesn't email a second receipt for the same order.
        order.paymentReceiptEmailSent = true;
        await order.save().catch(() => {});

        // Government clients: also send the invoice/facture to the billing
        // email (e.g. the city's accounts-payable), on top of the confirmation
        // sent to the contact above.
        if (isGovernment && hasSeparateBillingEmail && billingEmail) {
          try {
            // The 2nd email is the FACTURE (not the confirmation): same data,
            // but framed/subjected as an invoice for the city to pay.
            await sendInvoiceOrderConfirmation(
              billingEmail,
              receiptPayload.name,
              receiptPayload.orderNumber,
              receiptPayload.items,
              receiptPayload.subtotal,
              receiptPayload.taxAmount,
              receiptPayload.deliveryFee,
              receiptPayload.total,
              undefined,
              receiptPayload.orderDate,
              receiptPayload.pickupDate,
              receiptPayload.pickupTimeSlot,
              receiptPayload.deliveryType,
              receiptPayload.clientNote,
              receiptPayload.orderId,
              true,  // asFacture
              false, // hideBreakdown
              billingOrganization, // organization shown on the facture
              { tps: receiptPayload.tpsAmount, tvq: receiptPayload.tvqAmount },
              invoiceAttachments, // facture PDF en pièce jointe
            );
            console.log(`✅ Facture sent to billing email ${billingEmail}`);
          } catch (e: any) {
            console.error(
              `⚠️ Failed to send facture to billing email ${billingEmail}:`,
              e?.message || e,
            );
          }
        }
      }
    } catch (emailError: any) {
      // Log email error but don't fail the order creation
      console.error(
        `⚠️ Failed to send order receipt email to ${orderData.clientInfo.email}:`,
        emailError?.message || emailError,
        emailError?.stack,
      );
    }

    res.status(201).json({
      success: true,
      data: order,
      message: "Commande créée avec succès",
    });
  } catch (error: any) {
    console.error("Error creating order:", error);
    res.status(500).json({
      success: false,
      error: "Erreur lors de la création de la commande",
      message: error.message,
    });
  }
};

/**
 * Get production list - orders broken down by product for kitchen staff
 * GET /api/orders/production
 */
// Bornes UTC d'un JOUR CALENDAIRE de Montréal (gère l'heure d'été/hiver) pour
// une date "YYYY-MM-DD". Sans ça, `new Date("2026-06-27T00:00")` donne des
// bornes en UTC (serveur), et une commande du 26 au soir à Montréal (= 27 à
// 00:00 UTC) apparaît à tort dans la page du 27.
function montrealDayRangeUTC(dateStr: string): { start: Date; end: Date } {
  const offsetMinutes = (utc: Date): number => {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Montreal",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    });
    const p: Record<string, string> = {};
    for (const part of dtf.formatToParts(utc)) p[part.type] = part.value;
    const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    return (asUTC - utc.getTime()) / 60000; // ex. -240 (EDT) ou -300 (EST)
  };
  const guessStart = new Date(`${dateStr}T00:00:00.000Z`);
  const start = new Date(guessStart.getTime() - offsetMinutes(guessStart) * 60000);
  const guessEnd = new Date(`${dateStr}T23:59:59.999Z`);
  const end = new Date(guessEnd.getTime() - offsetMinutes(guessEnd) * 60000);
  return { start, end };
}

export const getProductionList = async (
  req: Request,
  res: Response<ApiResponse>,
) => {
  try {
    const { date } = req.query as { date?: string };

    // Build query: orders that need production
    const query: any = {
      status: { $in: ["confirmed", "in_production", "pending"] },
    };

    // Filter by pickup/delivery date if provided
    if (date) {
      // Bornes du jour calendaire de Montréal (et non du serveur/UTC), pour ne
      // pas faire apparaître une commande du 26 au soir dans la page du 27.
      const { start: startOfDay, end: endOfDay } = montrealDayRangeUTC(date);

      query.$or = [
        { pickupDate: { $gte: startOfDay, $lte: endOfDay } },
        { deliveryDate: date },
        // Fallback: only include orders created this day when no scheduled date exists.
        {
          $and: [
            { $or: [{ pickupDate: { $exists: false } }, { pickupDate: null }] },
            {
              $or: [
                { deliveryDate: { $exists: false } },
                { deliveryDate: null },
                { deliveryDate: "" },
              ],
            },
            { orderDate: { $gte: startOfDay, $lte: endOfDay } },
          ],
        },
      ];
    }

    const orders = await Order.find(query).sort({ createdAt: -1 });

    // One-shot backfill: legacy orders may have a pickupDate but no
    // deliveryTimeSlot, which made the production list show "—". Derive the
    // time from pickupDate (in America/Toronto) and persist it so the field
    // is correct everywhere going forward. Use a direct $set to skip the
    // full-document validation and pre-save hooks that can otherwise abort.
    const backfillUpdates: Promise<unknown>[] = [];
    for (const order of orders) {
      const slotMissing = !order.deliveryTimeSlot || !order.deliveryTimeSlot.trim();
      if (!slotMissing) continue;
      if (!order.pickupDate) {
        console.log(`⏰ [BACKFILL] Skip ${order.orderNumber}: no pickupDate`);
        continue;
      }
      try {
        const formatted = new Intl.DateTimeFormat("fr-CA", {
          timeZone: "America/Toronto",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }).format(new Date(order.pickupDate));
        const clean = formatted.trim();
        if (!clean) {
          console.log(`⏰ [BACKFILL] Skip ${order.orderNumber}: empty formatted time`);
          continue;
        }
        // Save whatever the timezone conversion gives, including 00:00 — the
        // admin can correct it via the order edit form if needed, and "00:00"
        // is at least visible info versus a dash.
        order.deliveryTimeSlot = clean;
        backfillUpdates.push(
          Order.updateOne(
            { _id: order._id },
            { $set: { deliveryTimeSlot: clean } },
          )
            .then(() =>
              console.log(`⏰ [BACKFILL] ${order.orderNumber} → ${clean}`),
            )
            .catch((e) =>
              console.log(`⏰ [BACKFILL] ${order.orderNumber} save FAILED: ${e?.message}`),
            ),
        );
      } catch (e: any) {
        console.log(`⏰ [BACKFILL] ${order.orderNumber} format error: ${e?.message}`);
      }
    }
    if (backfillUpdates.length > 0) {
      await Promise.all(backfillUpdates);
    }

    // Get all unique product IDs from orders
    const productIds = [...new Set(orders.flatMap(order => 
      order.items.map(item => item.productId)
    ))];
    const productNames = [...new Set(orders.flatMap(order =>
      order.items.map(item => item.productName).filter(Boolean)
    ))];

    // Fetch product data for all products (ID first, name fallback for legacy/mismatch cases)
    const products = await Product.find({
      deletedAt: { $exists: false },
      $or: [
        { id: { $in: productIds } },
        { name: { $in: productNames } },
      ],
    });
    const productMap = new Map(products.map(p => [p.id, p]));
    const productNameMap = new Map(products.map(p => [p.name.toLowerCase(), p]));

    const normalizeProductionType = (value: unknown): "patisserie" | "cuisinier" | "four" | null => {
      if (typeof value !== "string") return null;
      const normalized = value.trim().toLowerCase();
      if (normalized === "patisserie" || normalized === "cuisinier" || normalized === "four") {
        return normalized;
      }
      return null;
    };

    // Flatten orders into production items (one per product per order)
    const productionItems = orders.flatMap((order) =>
      order.items.map((item, idx) => {
        const productById = productMap.get(item.productId);
        const productByName = productNameMap.get(item.productName.toLowerCase());
        // Produit PERSONNALISÉ (productId 0) : aucun type de production défini.
        // On le rattache par défaut aux PÂTISSIERS pour qu'il apparaisse dans
        // leur liste de production (demande de Fanny).
        const isCustomItem = !item.productId || item.productId === 0;
        const resolvedProductionType =
          normalizeProductionType(productById?.productionType) ??
          normalizeProductionType(productByName?.productionType) ??
          (isCustomItem ? "patisserie" : null);

        return {
          id: `${order._id}-${idx}`,
          orderId: order._id,
          orderNumber: order.orderNumber,
          productId: item.productId,
          productName: item.productName,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          productionType: resolvedProductionType,
          customerName: `${order.clientInfo.firstName} ${order.clientInfo.lastName}`,
          customerPhone: order.clientInfo.phone,
          deliveryDate: order.deliveryDate || (order.pickupDate ? order.pickupDate.toISOString().split('T')[0] : order.orderDate.toISOString().split('T')[0]),
          // Derive time from deliveryTimeSlot, or from pickupDate interpreted
          // in America/Toronto (server may run in UTC on Vercel).
          deliveryTimeSlot: (() => {
            if (order.deliveryTimeSlot && order.deliveryTimeSlot.trim()) return order.deliveryTimeSlot;
            if (order.pickupDate) {
              try {
                const formatted = new Intl.DateTimeFormat("fr-CA", {
                  timeZone: "America/Toronto",
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: false,
                }).format(new Date(order.pickupDate));
                // fr-CA returns "14:30" style — strip any stray whitespace
                const clean = formatted.trim();
                if (clean && clean !== "00:00") return clean;
              } catch {
                /* fall through */
              }
            }
            return "—";
          })(),
          deliveryType: order.deliveryType,
          pickupLocation: order.pickupLocation,
          orderStatus: order.status,
          notes: item.notes || order.notes || "",
          selectedOptions: (item as any).selectedOptions || undefined,
          done: false,
        };
      })
    );

    if (date && productionItems.length > 0) {
      const ids = productionItems.map((i) => i.id);
      const statuses = await ProductionItemStatus.find({
        date,
        productionItemId: { $in: ids },
      });
      const statusMap = new Map(statuses.map((s) => [s.productionItemId, s]));
      productionItems.forEach((i) => {
        i.done = statusMap.get(i.id)?.done ?? false;
      });
    }

    res.json({
      success: true,
      data: {
        items: productionItems,
        totalOrders: orders.length,
        totalItems: productionItems.length,
      },
    });
  } catch (error: any) {
    console.error("Error fetching production list:", error);
    res.status(500).json({
      success: false,
      error: "Erreur lors de la récupération de la liste de production",
      message: error.message,
    });
  }
};

/**
 * Update a production item status (done/undone).
 * PATCH /api/orders/production/status
 */
export const setProductionItemStatus = async (
  req: Request,
  res: Response<ApiResponse>,
) => {
  try {
    const {
      productionItemId,
      date,
      done,
      productId,
      productName,
      quantity,
      location,
    } = req.body as {
      productionItemId: string;
      date: string;
      done: boolean;
      productId: number;
      productName: string;
      quantity: number;
      location: "Montreal" | "Laval";
    };

    const existing = await ProductionItemStatus.findOne({
      productionItemId,
      date,
    });
    void existing;

    const status = await ProductionItemStatus.findOneAndUpdate(
      { productionItemId, date },
      {
        $set: {
          done,
          productId,
          productName,
          quantity,
          location,
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );

    res.json({
      success: true,
      data: { status },
    });
  } catch (error: any) {
    console.error("Error updating production item status:", error);
    res.status(500).json({
      success: false,
      error: "Erreur lors de la mise à jour du statut de production",
      message: error.message,
    });
  }
};

/**
 * Get all orders with pagination and filters
 * GET /api/orders
 */
export const getOrders = async (
  req: Request,
  res: Response<PaginatedResponse<any> | ApiResponse>,
) => {
  try {
    const {
      page = 1,
      limit = 20,
      status,
      deliveryType,
      paymentStatus,
      fromDate,
      toDate,
    } = req.query as any;

    // Build query
    const query: any = {};

    if (status) query.status = status;
    if (deliveryType) query.deliveryType = deliveryType;
    if (paymentStatus) query.paymentStatus = paymentStatus;

    // Date range filter
    if (fromDate || toDate) {
      query.orderDate = {};
      if (fromDate) query.orderDate.$gte = new Date(fromDate);
      if (toDate) query.orderDate.$lte = new Date(toDate);
    }

    // Access rules by role
    if (req.user) {
      const productionRoles = new Set([
        "admin",
        "vendeur",
        "patissier",
        "cuisinier",
        "four",
      ]);
      if (req.user.role === "deliveryDriver") {
        // Delivery drivers need access to delivery orders dashboard data.
        query.deliveryType = "delivery";
      } else if (!productionRoles.has(String(req.user.role || ""))) {
        // Regular customers only see their own orders.
        query.userId = req.user.id;
      }
      // Production-side staff (patissier/cuisinier/four) get the same
      // read access as admin/vendeur — they need to plan production and
      // see what's leaving on delivery.
    }

    // Execute query with pagination.
    //
    // `changeHistory` est EXCLU : la liste ne l'affiche jamais (le détail le
    // récupère à part via GET /orders/:id/history), mais il pesait 84 % des
    // 4,5 Mo transférés — d'où une recherche qui semblait figée. `.lean()`
    // évite en plus d'hydrater 470 documents Mongoose pour rien.
    const skip = (Number(page) - 1) * Number(limit);
    const [orders, total] = await Promise.all([
      Order.find(query)
        .select("-changeHistory")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean(),
      Order.countDocuments(query),
    ]);

    // NOTE : le rattrapage de `amountPaid` qui se trouvait ici écrivait en base
    // à CHAQUE lecture de page. Une lecture ne doit pas muter les données ;
    // ce rattrapage appartient à un script de maintenance.

    // Add payment status indicators
    const ordersWithStatus = orders.map((order: any) => {
      const orderObj = order;
      const isPaymentOverdue =
        orderObj.paymentDueDate && 
        orderObj.paymentStatus === "unpaid" &&
        new Date() > new Date(orderObj.paymentDueDate);
      
      const daysOverdue = isPaymentOverdue && orderObj.paymentDueDate
        ? Math.ceil((new Date().getTime() - new Date(orderObj.paymentDueDate).getTime()) / (1000 * 60 * 60 * 24))
        : 0;

      // Anciennes commandes payées sans `amountPaid` : on renvoie la valeur
      // correcte SANS l'écrire en base (une lecture ne doit rien muter).
      const amountPaid =
        (!orderObj.amountPaid || orderObj.amountPaid === 0) &&
        orderObj.paymentStatus === "paid"
          ? orderObj.total
          : orderObj.amountPaid;

      return {
        ...orderObj,
        amountPaid,
        isPaymentOverdue,
        daysOverdue,
      };
    });

    const totalPages = Math.ceil(total / Number(limit));

    res.json({
      success: true,
      data: {
        items: ordersWithStatus,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          totalPages,
        },
      },
    });
  } catch (error: any) {
    console.error("Error fetching orders:", error);
    res.status(500).json({
      success: false,
      error: "Erreur lors de la récupération des commandes",
      message: error.message,
    });
  }
};

/**
 * Get a single order by ID
 * GET /api/orders/:id
 */
export const getOrderById = async (
  req: Request<{ id: string }>,
  res: Response<ApiResponse>,
) => {
  try {
    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({
        success: false,
        error: "Commande non trouvée",
      });
    }

    // Check if user has permission to view this order
    if (
      req.user &&
      req.user.role !== "admin" &&
      req.user.role !== "vendeur" &&
      order.userId !== req.user.id
    ) {
      return res.status(403).json({
        success: false,
        error: "Accès non autorisé à cette commande",
      });
    }

    // Add payment status indicators
    const orderObj = order.toObject?.() || order;
    const isPaymentOverdue = 
      orderObj.paymentDueDate && 
      orderObj.paymentStatus === "unpaid" &&
      new Date() > new Date(orderObj.paymentDueDate);
    
    const daysOverdue = isPaymentOverdue && orderObj.paymentDueDate
      ? Math.ceil((new Date().getTime() - new Date(orderObj.paymentDueDate).getTime()) / (1000 * 60 * 60 * 24))
      : 0;

    res.json({
      success: true,
      data: {
        ...orderObj,
        isPaymentOverdue,
        daysOverdue,
      },
    });
  } catch (error: any) {
    console.error("Error fetching order:", error);
    res.status(500).json({
      success: false,
      error: "Erreur lors de la récupération de la commande",
      message: error.message,
    });
  }
};

/**
 * Update an order
 * PATCH /api/orders/:id
 */
/** Jour calendaire « YYYY-MM-DD » d'une date de service, pour comparaison. */
const serviceDayKey = (order: any): string => {
  const d = orderServiceDate(order);
  return d ? d.toLocaleDateString("en-CA", { timeZone: "America/Montreal" }) : "";
};

/** Libellé lisible d'une date de service (courriel client). */
const serviceDayLabel = (key: string): string => {
  const d = parseServiceDate(key);
  return d
    ? d.toLocaleDateString("fr-CA", {
        year: "numeric",
        month: "long",
        day: "numeric",
        timeZone: "America/Montreal",
      })
    : "non précisée";
};

/**
 * Décrit, en français et du point de vue du CLIENT, ce qui a changé sur une
 * commande. Renvoie une liste vide quand rien de visible pour lui n'a bougé
 * (statut, paiement, notes internes, avancement de l'emballage) — c'est ce qui
 * évite d'inonder le client de courriels à chaque case cochée en cuisine.
 */
function describeCustomerFacingChanges(
  before: {
    items: Array<{
      productName: string;
      quantity: number;
      unitPrice: number;
      selectedOptions?: Record<string, string>;
    }>;
    deliveryDate?: string;
    pickupDate?: Date;
    deliveryTimeSlot?: string;
    deliveryType: string;
  },
  after: any,
): string[] {
  // --- Articles : même comparateur que celui qui décide d'inscrire ou non une
  // ligne dans l'historique (utils/orderChanges.ts), pour que les deux ne
  // puissent jamais diverger.
  const lines: string[] = describeItemChanges(
    before.items,
    (after.items || []).map((it: any) => ({
      productName: it.productName,
      quantity: it.quantity,
      unitPrice: it.unitPrice,
      selectedOptions: it.selectedOptions,
    })),
  );

  // --- Date et créneau de service
  const oldDay = serviceDayKey(before);
  const newDay = serviceDayKey(after);
  if (oldDay !== newDay) {
    const label = after.deliveryType === "delivery" ? "livraison" : "ramassage";
    lines.push(
      `Date de ${label} : ${serviceDayLabel(oldDay)} → ${serviceDayLabel(newDay)}`,
    );
  }

  const oldSlot = (before.deliveryTimeSlot || "").trim();
  const newSlot = (after.deliveryTimeSlot || "").trim();
  if (oldSlot !== newSlot) {
    lines.push(`Heure : ${oldSlot || "non précisée"} → ${newSlot || "non précisée"}`);
  }

  if (before.deliveryType !== after.deliveryType) {
    const label = (t: string) => (t === "delivery" ? "Livraison" : "Ramassage");
    lines.push(`Type : ${label(before.deliveryType)} → ${label(after.deliveryType)}`);
  }

  return lines;
}

/**
 * Update an order
 * PATCH /api/orders/:id
 */
export const updateOrder = async (
  req: Request<{ id: string }, {}, UpdateOrderInput>,
  res: Response<ApiResponse>,
) => {
  try {
    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({
        success: false,
        error: "Commande non trouvée",
      });
    }

    // Permission already verified by requireAdmin middleware

    const updateData = req.body;
    const changes: any[] = [];
    const userId = req.user?.id;

    // État AVANT modification — sert à décrire au client ce qui a changé
    // (courriel « commande modifiée » envoyé après l'enregistrement).
    const before = {
      items: (order.items || []).map((it: any) => ({
        productName: it.productName,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        selectedOptions: it.selectedOptions,
      })),
      deliveryDate: order.deliveryDate,
      pickupDate: order.pickupDate,
      deliveryTimeSlot: order.deliveryTimeSlot,
      deliveryType: order.deliveryType,
      status: order.status,
      // Sert à décider s'il faut réémettre le lien de paiement : un montant qui
      // bouge rend l'ancienne facture Square caduque.
      total: order.total,
    };

    // Track and update client info
    if (updateData.clientInfo) {
      const oldClientInfo = { ...order.clientInfo };
      order.clientInfo = {
        ...updateData.clientInfo,
        email: updateData.clientInfo.email || "",
      };

      // Si on a CHANGÉ de client (courriel différent), re-rattacher la commande
      // au bon compte (userId) pour qu'elle apparaisse dans le « Mon compte » du
      // nouveau client. On ne met à jour QUE si un compte correspond — sinon on
      // ne déracine pas la commande (client saisi sans compte).
      const newEmail = (updateData.clientInfo.email || "").trim().toLowerCase();
      const prevEmail = ((oldClientInfo as any).email || "").trim().toLowerCase();
      if (newEmail && newEmail !== prevEmail) {
        const matchedUser = await User.findOne({ email: newEmail }).select("_id").lean();
        if (matchedUser?._id) {
          order.userId = matchedUser._id.toString();
        }
      }

      changes.push({
        changedAt: new Date(),
        changedBy: userId,
        field: "clientInfo",
        oldValue: oldClientInfo,
        newValue: updateData.clientInfo,
        changeType: "updated",
        notes: "Client information updated"
      });
    }

    // Track and update pickup date
    if (updateData.pickupDate) {
      const oldPickupDate = order.pickupDate;
      order.pickupDate = new Date(updateData.pickupDate);
      changes.push({
        changedAt: new Date(),
        changedBy: userId,
        field: "pickupDate",
        oldValue: oldPickupDate,
        newValue: order.pickupDate,
        changeType: "updated",
        notes: "Pickup date changed"
      });
    }

    // Track and update deliveryDate (chaîne "YYYY-MM-DD" utilisée par le portail
    // livreur et la liste de production). Sans ça, modifier la date d'une
    // commande en LIVRAISON laissait l'ancienne date affichée au livreur / sur
    // la production (pickupDate changeait mais pas deliveryDate).
    if (
      updateData.deliveryDate !== undefined &&
      updateData.deliveryDate !== order.deliveryDate
    ) {
      const oldDeliveryDate = order.deliveryDate;
      order.deliveryDate = updateData.deliveryDate;
      changes.push({
        changedAt: new Date(),
        changedBy: userId,
        field: "deliveryDate",
        oldValue: oldDeliveryDate,
        newValue: updateData.deliveryDate,
        changeType: "updated",
        notes: "Delivery date changed",
      });
    }

    // Track and update pickup/delivery time slot. This was previously not
    // handled at all, so modifying the hour through the admin form looked
    // like it worked (the local React state showed the new value) but the
    // backend silently dropped it — and on refresh the table read the old
    // deliveryTimeSlot back, making it look like the change reverted.
    if (
      typeof updateData.deliveryTimeSlot === "string" &&
      updateData.deliveryTimeSlot.trim() &&
      updateData.deliveryTimeSlot !== order.deliveryTimeSlot
    ) {
      const oldSlot = order.deliveryTimeSlot;
      order.deliveryTimeSlot = updateData.deliveryTimeSlot.trim();
      changes.push({
        changedAt: new Date(),
        changedBy: userId,
        field: "deliveryTimeSlot",
        oldValue: oldSlot,
        newValue: order.deliveryTimeSlot,
        changeType: "updated",
        notes: "Pickup/delivery time changed",
      });
    }

    // Track and update delivery date (string field used by delivery orders;
    // pickup orders use pickupDate above). Same silent-drop bug as the time
    // slot — fields the frontend sends but the backend never persisted.
    if (
      typeof updateData.deliveryDate === "string" &&
      updateData.deliveryDate.trim() &&
      updateData.deliveryDate !== order.deliveryDate
    ) {
      const oldDeliveryDate = order.deliveryDate;
      order.deliveryDate = updateData.deliveryDate.trim();
      changes.push({
        changedAt: new Date(),
        changedBy: userId,
        field: "deliveryDate",
        oldValue: oldDeliveryDate,
        newValue: order.deliveryDate,
        changeType: "updated",
        notes: "Delivery date changed",
      });
    }

    // Track and update pickup location
    if (updateData.pickupLocation) {
      const oldLocation = order.pickupLocation;
      order.pickupLocation = updateData.pickupLocation;
      changes.push({
        changedAt: new Date(),
        changedBy: userId,
        field: "pickupLocation",
        oldValue: oldLocation,
        newValue: updateData.pickupLocation,
        changeType: "updated",
        notes: "Pickup location changed"
      });
    }

    // Track and update delivery type
    if (updateData.deliveryType) {
      const oldDeliveryType = order.deliveryType;
      order.deliveryType = updateData.deliveryType;
      changes.push({
        changedAt: new Date(),
        changedBy: userId,
        field: "deliveryType",
        oldValue: oldDeliveryType,
        newValue: updateData.deliveryType,
        changeType: "updated",
        notes: "Delivery type changed"
      });
    }

    // Track and update delivery address
    if (updateData.deliveryAddress) {
      const oldAddress = order.deliveryAddress;
      order.deliveryAddress = updateData.deliveryAddress;
      changes.push({
        changedAt: new Date(),
        changedBy: userId,
        field: "deliveryAddress",
        oldValue: oldAddress,
        newValue: updateData.deliveryAddress,
        changeType: "updated",
        notes: "Delivery address updated"
      });
    }

    // Track and update items - recalculate totals if items changed
    if (updateData.items) {
      const oldTotal = order.total;
      const oldDepositAmount = order.depositAmount;
      const oldPaymentStatus = order.paymentStatus;
      const oldItems = [...order.items];
      order.items = updateData.items;
      
      // Recalculate totals
      const subtotal = updateData.items.reduce((sum, item) => sum + item.amount, 0);

      let promoDiscountAmount = order.promoDiscountAmount || 0;
      if (order.promoCode && (order.promoDiscountPercent ?? 0) > 0) {
        const discount = calculatePromoDiscount({
          promo: {
            code: order.promoCode,
            discountPercent: order.promoDiscountPercent ?? 0,
            appliesToProductIds: order.promoAppliesToProductIds,
            isActive: true,
            timesUsed: 0,
          } as any,
          items: updateData.items,
          subtotal,
        });
        promoDiscountAmount = discount.discountAmount;
        order.promoDiscountAmount = promoDiscountAmount;
      }

      const taxBreakdown = await computeTaxBreakdown(updateData.items as any);
      const taxAmount = taxBreakdown.total;
      let deliveryFee = order.deliveryFee;

      // Recalculate delivery fee if needed
      if (order.deliveryType === "delivery" && order.deliveryAddress) {
        const deliveryInfo = calculateDeliveryFee(order.deliveryAddress.postalCode);
        deliveryFee = deliveryInfo.fee;
      }

      const total = Math.max(0, subtotal - promoDiscountAmount) + taxAmount + deliveryFee;
      const depositAmount = order.paymentType === "full" ? total : total * 0.5;

      const estimatedPaidAmount = order.amountPaid > 0
        ? order.amountPaid
        : oldPaymentStatus === "paid"
          ? oldTotal
          : oldPaymentStatus === "deposit_paid"
            ? oldDepositAmount
            : 0;
      const epsilon = 0.01;

      const previousDepositPaid = order.depositPaid;
      const previousBalancePaid = order.balancePaid;
      const previousPaymentStatus = order.paymentStatus;

      // On FIGE le montant déjà encaissé sur la commande. Tant qu'il restait
      // déduit (`amountPaid` à 0 sur les vieilles commandes), le back office
      // recevait « 0$ payé » après modification : l'encadré « comment payer la
      // balance ? » ne s'ouvrait pas et la commande restait affichée « payée ».
      order.amountPaid = Number(estimatedPaidAmount.toFixed(2));

      if (estimatedPaidAmount >= total - epsilon) {
        order.depositPaid = true;
        order.balancePaid = true;
        order.paymentStatus = "paid";
      } else if (estimatedPaidAmount > epsilon) {
        // Any partial payment counts as deposit_paid (preserves "in_store" channel icon)
        order.depositPaid = true;
        order.balancePaid = false;
        order.paymentStatus = "deposit_paid";
      } else {
        order.depositPaid = false;
        order.balancePaid = false;
        order.paymentStatus = "unpaid";
      }

      if (!order.depositPaid) {
        order.depositPaidAt = undefined;
      } else if (!order.depositPaidAt) {
        order.depositPaidAt = new Date();
      }

      if (!order.balancePaid) {
        order.balancePaidAt = undefined;
      } else if (!order.balancePaidAt) {
        order.balancePaidAt = new Date();
      }

      order.subtotal = subtotal;
      order.taxAmount = taxAmount;
      order.tpsAmount = taxBreakdown.tps;
      order.tvqAmount = taxBreakdown.tvq;
      order.deliveryFee = deliveryFee;
      order.total = total;
      order.depositAmount = depositAmount;

      // Ne consigner que si les articles ont RÉELLEMENT bougé. Cocher une case
      // « emballé » renvoie tout le tableau : sans cette condition, chaque clic
      // ajoutait une ligne « Produits modifiés » vide. 96 % des 1427 entrées
      // existantes ne consignaient aucun changement, et chacune stocke une
      // copie complète des articles — d'où des commandes qui enflent sans fin.
      if (shouldRecordItemChange(oldItems as any, updateData.items as any, oldTotal, total)) {
        changes.push({
          changedAt: new Date(),
          changedBy: userId,
          field: "items",
          oldValue: oldItems,
          newValue: updateData.items,
          changeType: "items_modified",
          notes: `Order items modified. Total: ${oldTotal.toFixed(2)}$ -> ${total.toFixed(2)}$`
        });
      }

      const paymentDifference = total - estimatedPaidAmount;
      const paymentAdjustmentNote =
        paymentDifference > epsilon
          ? `Additional amount to collect: ${paymentDifference.toFixed(2)}$`
          : paymentDifference < -epsilon
            ? `Customer credit/refund due: ${Math.abs(paymentDifference).toFixed(2)}$`
            : "No payment adjustment needed";

      if (
        order.depositPaid !== previousDepositPaid ||
        order.balancePaid !== previousBalancePaid ||
        order.paymentStatus !== previousPaymentStatus
      ) {
        changes.push({
          changedAt: new Date(),
          changedBy: userId,
          field: "paymentStatus",
          oldValue: previousPaymentStatus,
          newValue: order.paymentStatus,
          changeType: "payment_updated",
          notes: paymentAdjustmentNote,
        });
      }
    }

    // Track and update status
    if (updateData.status !== undefined && updateData.status !== order.status) {
      const oldStatus = order.status;
      order.status = updateData.status;
      changes.push({
        changedAt: new Date(),
        changedBy: userId,
        field: "status",
        oldValue: oldStatus,
        newValue: updateData.status,
        changeType: "status_changed",
        notes: `Status changed from ${oldStatus} to ${updateData.status}`
      });
    }

    if (
      updateData.paymentLinkChannel !== undefined &&
      updateData.paymentLinkChannel !== order.paymentLinkChannel
    ) {
      const oldChannel = order.paymentLinkChannel;
      order.paymentLinkChannel = updateData.paymentLinkChannel;
      changes.push({
        changedAt: new Date(),
        changedBy: userId,
        field: "paymentLinkChannel",
        oldValue: oldChannel,
        newValue: updateData.paymentLinkChannel,
        changeType: "payment_updated",
        notes: "Payment link delivery channel updated",
      });
    }

    // Track and update notes
    if (updateData.notes !== undefined) {
      const oldNotes = order.notes;
      order.notes = updateData.notes;
      changes.push({
        changedAt: new Date(),
        changedBy: userId,
        field: "notes",
        oldValue: oldNotes,
        newValue: updateData.notes,
        changeType: "updated",
        notes: "Order notes updated"
      });
    }

    // Track and update billing fields (kind, billing email, organisation).
    // These drive the gov facture flow, so editing a gov order must persist them.
    if (updateData.billingKind !== undefined) {
      order.billingKind = updateData.billingKind;
    }
    if (updateData.billingEmail !== undefined) {
      order.billingEmail =
        (updateData.billingEmail || "").trim().toLowerCase() || undefined;
    }
    if (updateData.billingOrganization !== undefined) {
      order.billingOrganization =
        (updateData.billingOrganization || "").trim() || undefined;
    }
    if ((updateData as any).takenByInitials !== undefined) {
      (order as any).takenByInitials =
        String((updateData as any).takenByInitials || "").trim().toUpperCase() ||
        undefined;
    }

    // Track and update assigned driver
    if (updateData.assignedDriver) {
      const oldDriver = order.assignedDriver;
      order.assignedDriver = {
        id: updateData.assignedDriver.id,
        name: updateData.assignedDriver.name,
        assignedAt: new Date(updateData.assignedDriver.assignedAt),
      };
      order.markModified("assignedDriver");
      changes.push({
        changedAt: new Date(),
        changedBy: userId,
        field: "assignedDriver",
        oldValue: oldDriver?.name || null,
        newValue: updateData.assignedDriver.name,
        changeType: "updated",
        notes: `Driver assigned: ${updateData.assignedDriver.name}`,
      });
    }

    // ------------------------------------------------------------------
    // Clients gouvernementaux : ils règlent par chèque sous 2 mois et ne
    // peuvent JAMAIS être encaissés en magasin ni par lien. `createOrder`
    // l'empêche par quatre garde-fous — `updateOrder` n'en avait aucun, si
    // bien qu'un clic sur « Marquer payé » suffisait. Deux commandes réelles
    // en ont fait les frais (MF-20260818-0370 et MF-20260820-0395), marquées
    // payées alors qu'aucun chèque n'était arrivé : la comptabilité les
    // croyait réglées.
    //
    // Un encaissement Square réel reste évidemment recevable : c'est un fait,
    // pas une saisie.
    // ------------------------------------------------------------------
    const isGovernmentOrder = (order as any).billingKind === "gouvernement";
    if (
      isGovernmentOrder &&
      !order.squarePaymentId &&
      (updateData.depositPaid === true || updateData.balancePaid === true)
    ) {
      return res.status(400).json({
        success: false,
        error:
          "Un client gouvernemental ne peut pas être marqué comme payé : il règle par chèque ou virement. Enregistrez le paiement à la réception du chèque en retirant d'abord la facturation gouvernementale.",
      });
    }

    // Track payment updates
    if (updateData.depositPaid !== undefined && updateData.depositPaid !== order.depositPaid) {
      const oldDepositPaid = order.depositPaid;
      order.depositPaid = updateData.depositPaid;
      if (updateData.depositPaid && !order.depositPaidAt) {
        order.depositPaidAt = new Date();
      }
      changes.push({
        changedAt: new Date(),
        changedBy: userId,
        field: "depositPaid",
        oldValue: oldDepositPaid,
        newValue: updateData.depositPaid,
        changeType: "payment_updated",
        notes: updateData.depositPaid ? "Deposit marked as paid" : "Deposit payment reverted"
      });
    }

    if (updateData.balancePaid !== undefined && updateData.balancePaid !== order.balancePaid) {
      const oldBalancePaid = order.balancePaid;
      order.balancePaid = updateData.balancePaid;
      if (updateData.balancePaid && !order.balancePaidAt) {
        order.balancePaidAt = new Date();
      }
      // A fully paid balance implies the deposit is paid too; otherwise the
      // pre-save hook would downgrade paymentStatus back to "unpaid".
      if (updateData.balancePaid && !order.depositPaid) {
        order.depositPaid = true;
        if (!order.depositPaidAt) order.depositPaidAt = new Date();
      }
      changes.push({
        changedAt: new Date(),
        changedBy: userId,
        field: "balancePaid",
        oldValue: oldBalancePaid,
        newValue: updateData.balancePaid,
        changeType: "payment_updated",
        notes: updateData.balancePaid ? "Balance marked as paid" : "Balance payment reverted"
      });
    }

    // Update amountPaid + paymentStatus explicitly so they don't silently
    // drift if the pre-save hook is bypassed by a later code path.
    if (updateData.depositPaid !== undefined || updateData.balancePaid !== undefined) {
      if (order.depositPaid && order.balancePaid) {
        order.amountPaid = order.total;
        order.paymentStatus = "paid";
      } else if (order.depositPaid) {
        order.amountPaid = order.depositAmount;
        order.paymentStatus = "deposit_paid";
      } else {
        order.paymentStatus = "unpaid";
      }
    }

    // Direct amountPaid update (e.g., after a refund)
    if (typeof (updateData as any).amountPaid === "number") {
      order.amountPaid = (updateData as any).amountPaid;
    }

    // Refunds history append (normalize refundedAt string → Date)
    if (Array.isArray((updateData as any).refunds) && (updateData as any).refunds.length > 0) {
      const incoming = ((updateData as any).refunds as any[]).map((r) => ({
        ...r,
        refundedAt: r.refundedAt ? new Date(r.refundedAt) : new Date(),
        amountCents: Number(r.amountCents) || 0,
      }));
      const existing = (order as any).refunds || [];
      (order as any).refunds = [...existing, ...incoming];
    }

    if (updateData.squarePaymentId && updateData.squarePaymentId !== order.squarePaymentId) {
      const oldPaymentId = order.squarePaymentId;
      order.squarePaymentId = updateData.squarePaymentId;
      changes.push({
        changedAt: new Date(),
        changedBy: userId,
        field: "squarePaymentId",
        oldValue: oldPaymentId,
        newValue: updateData.squarePaymentId,
        changeType: "payment_updated",
        notes: "Square payment ID updated"
      });
    }

    if (updateData.squareInvoiceId && updateData.squareInvoiceId !== order.squareInvoiceId) {
      const oldInvoiceId = order.squareInvoiceId;
      order.squareInvoiceId = updateData.squareInvoiceId;
      // Repère indispensable : un lien de SOLDE ne réclame que le reste à
      // payer. On mémorise ce qui est déjà encaissé pour que l'encaissement de
      // ce lien s'AJOUTE au lieu de remplacer (sinon payer 120$ de solde
      // ferait retomber une commande de 752$ à « 120$ payés »).
      (order as any).squareInvoiceBaselinePaid = order.amountPaid || 0;
      changes.push({
        changedAt: new Date(),
        changedBy: userId,
        field: "squareInvoiceId",
        oldValue: oldInvoiceId,
        newValue: updateData.squareInvoiceId,
        changeType: "payment_updated",
        notes: "Square invoice ID updated"
      });
    }

    // ------------------------------------------------------------------
    // Correction du moyen de paiement depuis « Modifier la commande ».
    //
    // Le moyen de paiement n'est pas un champ stocké : il se DÉDUIT des
    // drapeaux de paiement et de la présence d'une facture Square. Le changer
    // devait donc remettre ces drapeaux à l'endroit — sans quoi la commande
    // restait « payée 🏠 » et aucun lien n'était envoyé.
    // ------------------------------------------------------------------
    const requestedPaymentMethod = (updateData as any).paymentMethod as
      | "in_store"
      | "payment_link"
      | undefined;
    let issuePaymentLinkAfterSave = false;

    if (requestedPaymentMethod === "payment_link") {
      // Garde-fou : on ne « dé-paie » JAMAIS un encaissement Square réel.
      // Ce cas relève du remboursement, pas d'une correction de saisie.
      if (order.squarePaymentId) {
        return res.status(400).json({
          success: false,
          error:
            "Cette commande a été réellement payée via Square : passez par un remboursement plutôt que par un changement de moyen de paiement.",
        });
      }

      // « Payé en magasin » avait été coché par erreur : la commande n'a
      // jamais été encaissée, on la remet donc à « non payée ».
      if (order.depositPaid || order.balancePaid || order.paymentStatus !== "unpaid") {
        const oldStatus = order.paymentStatus;
        order.depositPaid = false;
        order.balancePaid = false;
        order.depositPaidAt = undefined;
        order.balancePaidAt = undefined;
        order.amountPaid = 0;
        order.paymentStatus = "unpaid";
        changes.push({
          changedAt: new Date(),
          changedBy: userId,
          field: "paymentStatus",
          oldValue: oldStatus,
          newValue: "unpaid",
          changeType: "payment_updated",
          notes:
            "Moyen de paiement corrigé : « payé en magasin » retiré, envoi d'un lien de paiement",
        });
      }

      // Pas encore de lien émis → on en crée un APRÈS l'enregistrement.
      if (!order.squareInvoiceId) issuePaymentLinkAfterSave = true;
    }

    // NOTE — on ne traite VOLONTAIREMENT que le sens « → lien de paiement ».
    // Le sens inverse (« → payé en magasin ») serait dangereux ici : le
    // frontend ne reçoit pas de champ `paymentMethod` (il n'existe pas en
    // base) et le déduit de `paymentType === "full"`, ce qui vaut "in_store"
    // même pour une commande NON payée à régler par lien. Marquer payé sur
    // cette base marquerait payée n'importe quelle commande simplement
    // modifiée pour une note. Pour encaisser en boutique, le bouton
    // « Marquer payé » reste la voie explicite.

    // Si cette mise à jour marque la commande PAYÉE (en magasin) alors qu'un
    // lien Square était encore OUVERT et NON payé, on annule ce lien pour éviter
    // un double paiement, et on retire sa référence → l'icône repasse en
    // "boutique". Robuste et automatique, quel que soit le chemin frontend.
    const markedPaidThisUpdate =
      updateData.depositPaid === true || updateData.balancePaid === true;
    if (
      markedPaidThisUpdate &&
      order.paymentStatus === "paid" &&
      !order.squarePaymentId &&
      order.squareInvoiceId
    ) {
      const cancelled = await cancelSquareInvoiceById(order.squareInvoiceId);
      if (cancelled) {
        order.set("squareInvoiceId", undefined);
      }
    }

    // Add all changes to order history
    if (changes.length > 0) {
      order.changeHistory.push(...changes);
    }

    await order.save();

    console.log(`✅ Order ${order.orderNumber} updated with ${changes.length} changes`);

    // --- Courriel « commande modifiée » au client -------------------------
    // Ajouter ou retirer un article (ou déplacer la date) ne prévenait PAS le
    // client : il gardait une confirmation périmée — typiquement une commande
    // déjà payée en magasin à laquelle on ajoute un item. On lui renvoie donc
    // sa commande à jour. Volontairement silencieux pour :
    //   - une commande annulée (elle n'est plus à servir) ;
    //   - un simple pointage d'emballage (le back office renvoie `items` à
    //     chaque case cochée, mais seul `productionStatus` change) ;
    //   - un changement de statut/paiement seul.
    const clientEmail = (order.clientInfo?.email || "").trim();
    const changeLines = describeCustomerFacingChanges(before, order);
    const willEmailCustomer =
      changeLines.length > 0 && !!clientEmail && order.status !== "cancelled";

    // --- Réémission du lien de paiement quand le MONTANT a changé ---------
    // Cette décision était prise par le frontend à partir d'un `paymentMethod`
    // qui n'existe pas en base : il est redéduit à chaque chargement et retombe
    // sur « in_store » dès que la page a été rechargée. Résultat, le client ne
    // recevait jamais le nouveau montant, et « Renvoyer la facture » lui
    // repartait l'ancien — la facture Square n'étant jamais mise à jour.
    // La règle est désormais ici, et ne dépend que des données de la commande.
    let reissuedInvoiceUrl: string | null = null;
    let reissueWarning: string | undefined;
    const mustReissuePaymentLink = shouldReissuePaymentLink({
      previousTotal: before.total,
      newTotal: order.total,
      squareInvoiceId: order.squareInvoiceId,
      squarePaymentId: order.squarePaymentId,
      paymentStatus: order.paymentStatus,
      status: order.status,
      billingKind: (order as any).billingKind,
    });

    if (mustReissuePaymentLink) {
      const outcome = await reissuePaymentLink(
        {
          cancelInvoice: cancelSquareInvoiceById,
          createInvoice: createInvoiceForExistingOrder,
          log: (m) => console.log(m),
          logError: (m) => console.error(m),
        },
        order as any,
        willEmailCustomer,
      );
      reissuedInvoiceUrl = outcome.invoiceUrl;
      reissueWarning = outcome.warning;
    }

    try {
      if (willEmailCustomer) {
        await sendOrderUpdatedEmail({
          email: clientEmail,
          name: `${order.clientInfo.firstName} ${order.clientInfo.lastName}`.trim(),
          orderNumber: order.orderNumber,
          items: (order.items || []).map((it: any) => ({
            productName: it.productName,
            quantity: it.quantity,
            amount: it.amount ?? (it.unitPrice || 0) * (it.quantity || 1),
          })),
          changeLines,
          subtotal: order.subtotal,
          taxAmount: order.taxAmount,
          taxBreakdown: { tps: order.tpsAmount, tvq: order.tvqAmount },
          deliveryFee: order.deliveryFee,
          total: order.total,
          amountPaid: order.amountPaid || 0,
          serviceDate: orderServiceDate(order),
          timeSlot: order.deliveryTimeSlot || undefined,
          deliveryType: order.deliveryType,
          orderId: order._id.toString(),
          invoiceUrl: reissuedInvoiceUrl,
        });
      }
    } catch (mailError: any) {
      // Un envoi raté ne doit jamais faire échouer l'enregistrement.
      console.error(
        `⚠️ [MAJ COMMANDE] Courriel « commande modifiée » non envoyé pour ${order.orderNumber}:`,
        mailError?.message || mailError,
      );
    }

    // Émission du lien de paiement APRÈS l'enregistrement : Square doit voir la
    // commande à jour (montants, articles), et la facture y est créée puis
    // envoyée au client par courriel ou SMS.
    let paymentLinkWarning: string | undefined = reissueWarning;
    let responseOrder: any = order;
    // La réémission a posé un NOUVEAU squareInvoiceId en base : sans relecture,
    // le frontend garderait l'ancien identifiant et « Renvoyer la facture »
    // repartirait sur la facture annulée.
    if (mustReissuePaymentLink) {
      const refreshed = await Order.findById(order._id);
      if (refreshed) responseOrder = refreshed;
    }
    if (issuePaymentLinkAfterSave) {
      try {
        const { invoiceId } = await createInvoiceForExistingOrder(
          order._id.toString(),
          order.paymentLinkChannel === "sms" ? "sms" : "email",
        );
        console.log(
          `✅ Lien de paiement émis pour ${order.orderNumber} (facture ${invoiceId})`,
        );
        // createInvoiceForExistingOrder pose squareInvoiceId sur la commande :
        // on la relit pour que le frontend reçoive l'état à jour (icône lien).
        const refreshed = await Order.findById(order._id);
        if (refreshed) responseOrder = refreshed;
      } catch (e: any) {
        // La commande EST enregistrée et n'est plus marquée payée : on ne
        // masque pas l'échec d'envoi, sinon personne ne saurait que le client
        // n'a jamais reçu son lien.
        paymentLinkWarning = `La commande est enregistrée et n'est plus marquée « payée », mais l'envoi du lien a échoué : ${e?.message}. Utilisez « Renvoyer le lien de paiement ».`;
        console.error(
          `⚠️ [MAJ COMMANDE] échec émission du lien pour ${order.orderNumber}:`,
          e?.message,
        );
      }
    }

    // NOTE: Balance email is no longer sent automatically here.
    // The admin explicitly chooses via the balance modal (email with link OR in-store).
    // This avoids duplicate emails and ensures the email has a proper payment link.

    res.json({
      success: true,
      data: responseOrder,
      message: paymentLinkWarning
        ? paymentLinkWarning
        : issuePaymentLinkAfterSave || reissuedInvoiceUrl
          ? "Commande mise à jour — lien de paiement envoyé au client."
          : "Commande mise à jour avec succès",
      ...(paymentLinkWarning ? { warning: paymentLinkWarning } : {}),
    });
  } catch (error: any) {
    console.error("Error updating order:", error);
    res.status(500).json({
      success: false,
      error: "Erreur lors de la mise à jour de la commande",
      message: error.message,
    });
  }
};

/**
 * Dashboard statistics — computed from REAL orders.
 * GET /api/orders/stats
 *
 * Chiffre d'affaires & ventes totales = commandes PAYÉES uniquement
 * (paymentStatus "paid", hors annulées), pour le mois en cours, avec le %
 * d'évolution vs le mois précédent. Inclut aussi les produits les plus vendus
 * et l'activité récente (vraies dernières commandes).
 */
export const getOrderStats = async (_req: Request, res: Response<ApiResponse>) => {
  try {
    const now = new Date();
    const startThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    // Commandes payées, non annulées
    const paidOrders = await Order.find({
      paymentStatus: "paid",
      status: { $ne: "cancelled" },
    })
      .select("total items orderDate createdAt")
      .lean();

    const dateOf = (o: any): Date => new Date(o.orderDate || o.createdAt);
    const thisMonth = paidOrders.filter((o) => dateOf(o) >= startThisMonth);
    const lastMonth = paidOrders.filter(
      (o) => dateOf(o) >= startLastMonth && dateOf(o) < startThisMonth,
    );

    const sumTotal = (arr: any[]) =>
      arr.reduce((s, o) => s + (Number(o.total) || 0), 0);
    const totalRevenue = sumTotal(thisMonth);
    const lastRevenue = sumTotal(lastMonth);
    const totalSales = thisMonth.length;
    const lastSales = lastMonth.length;

    // % d'évolution (arrondi à 0,1). Si pas de référence le mois dernier :
    // +100% s'il y a de l'activité ce mois, sinon 0%.
    const pct = (cur: number, prev: number) =>
      prev > 0
        ? Math.round(((cur - prev) / prev) * 1000) / 10
        : cur > 0
          ? 100
          : 0;

    // Produits les plus vendus (mois en cours, par quantité)
    const qtyByName: Record<string, number> = {};
    for (const o of thisMonth) {
      for (const it of (o.items as any[]) || []) {
        const name = it?.productName || `Produit #${it?.productId}`;
        qtyByName[name] = (qtyByName[name] || 0) + (Number(it?.quantity) || 0);
      }
    }
    const topProducts = Object.entries(qtyByName)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, quantity]) => ({ name, quantity }));

    // Commandes à préparer : encore actives (ni terminées, ni annulées, ni livrées)
    const ordersToPrepare = await Order.countDocuments({
      status: { $nin: ["completed", "cancelled", "delivered"] },
    });

    // Activité récente : 5 dernières commandes (tous statuts)
    const recent = await Order.find({})
      .sort({ createdAt: -1 })
      .limit(5)
      .select("orderNumber clientInfo total status paymentStatus createdAt")
      .lean();
    const recentActivity = recent.map((o: any) => ({
      orderNumber: o.orderNumber,
      clientName:
        `${o.clientInfo?.firstName || ""} ${o.clientInfo?.lastName || ""}`.trim() ||
        o.clientInfo?.name ||
        "Client",
      total: Number(o.total) || 0,
      status: o.status,
      paymentStatus: o.paymentStatus,
      createdAt: o.createdAt,
    }));

    res.json({
      success: true,
      data: {
        totalRevenue,
        totalSales,
        revenueChange: pct(totalRevenue, lastRevenue),
        salesChange: pct(totalSales, lastSales),
        ordersToPrepare,
        topProducts,
        recentActivity,
      },
    });
  } catch (error: any) {
    console.error("getOrderStats error:", error);
    res
      .status(500)
      .json({ success: false, error: error?.message || "Failed to compute stats" });
  }
};

/**
 * Get order change history
 * GET /api/orders/:id/history
 */
export const getOrderHistory = async (
  req: Request<{ id: string }>,
  res: Response<ApiResponse>,
) => {
  try {
    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({
        success: false,
        error: "Commande non trouvée",
      });
    }

    // Check if user has permission to view this order's history
    if (
      req.user &&
      req.user.role !== "admin" &&
      req.user.role !== "vendeur" &&
      order.userId !== req.user.id
    ) {
      return res.status(403).json({
        success: false,
        error: "Accès non autorisé à l'historique de cette commande",
      });
    }

    res.json({
      success: true,
      data: {
        orderNumber: order.orderNumber,
        changeHistory: order.changeHistory || [],
      },
    });
  } catch (error: any) {
    console.error("Error fetching order history:", error);
    res.status(500).json({
      success: false,
      error: "Erreur lors de la récupération de l'historique",
      message: error.message,
    });
  }
};

/**
 * Delete an order
 * DELETE /api/orders/:id
 */
export const deleteOrder = async (
  req: Request<{ id: string }>,
  res: Response<ApiResponse>,
) => {
  try {
    const order = await Order.findById(req.params.id);

    if (!order) {
      return res.status(404).json({
        success: false,
        error: "Commande non trouvée",
      });
    }

    // Only admin and vendeur can delete orders
    if (req.user && req.user.role !== "admin" && req.user.role !== "vendeur") {
      return res.status(403).json({
        success: false,
        error: "Vous n'avez pas la permission de supprimer cette commande",
      });
    }

    await order.deleteOne();

    res.json({
      success: true,
      message: "Commande supprimée avec succès",
    });
  } catch (error: any) {
    console.error("Error deleting order:", error);
    res.status(500).json({
      success: false,
      error: "Erreur lors de la suppression de la commande",
      message: error.message,
    });
  }
};

/**
 * Validate delivery fee and minimum order
 * POST /api/orders/validate-delivery
 */
export const validateDelivery = async (
  req: Request<{}, {}, { postalCode: string; subtotal: number }>,
  res: Response<ApiResponse>,
) => {
  try {
    const { postalCode, subtotal } = req.body;

    const deliveryInfo = calculateDeliveryFee(postalCode);

    if (!deliveryInfo.isValid) {
      return res.status(400).json({
        success: false,
        error: "Code postal non valide pour la livraison",
        data: deliveryInfo,
      });
    }

    const minimumValidation = validateMinimumOrder(postalCode, subtotal);

    res.json({
      success: true,
      data: {
        deliveryFee: deliveryInfo.fee,
        minimumOrder: deliveryInfo.minimumOrder,
        postalCode: postalCode,
        isValid: deliveryInfo.isValid,
        meetsMinimum: minimumValidation.isValid,
        shortfall: minimumValidation.shortfall,
      },
    });
  } catch (error: any) {
    console.error("Error validating delivery:", error);
    res.status(500).json({
      success: false,
      error: "Erreur lors de la validation de la livraison",
      message: error.message,
    });
  }
};

/**
 * Get all delivery zones
 * GET /api/orders/delivery-zones
 */
export const getDeliveryZones = async (
  req: Request,
  res: Response<ApiResponse>,
) => {
  try {
    const zones = getAllDeliveryZones();

    res.json({
      success: true,
      data: zones,
    });
  } catch (error: any) {
    console.error("Error fetching delivery zones:", error);
    res.status(500).json({
      success: false,
      error: "Erreur lors de la récupération des zones de livraison",
      message: error.message,
    });
  }
};

/**
 * Update delivery status for an order (for delivery drivers)
 * PATCH /api/orders/:id/delivery-status
 */
export const updateDeliveryStatus = async (
  req: Request<{ id: string }, {}, { deliveryStatus: string }>,
  res: Response<ApiResponse>,
) => {
  try {
    const { id } = req.params;
    const { deliveryStatus } = req.body;

    // Validate delivery status
    const validStatuses = ["pending", "in_transit", "arrived", "delivered"];
    if (!validStatuses.includes(deliveryStatus)) {
      return res.status(400).json({
        success: false,
        error: "Statut de livraison invalide",
      });
    }

    const order = await Order.findById(id);

    if (!order) {
      return res.status(404).json({
        success: false,
        error: "Commande non trouvée",
      });
    }

    // Only allow updating delivery orders
    if (order.deliveryType !== "delivery") {
      return res.status(400).json({
        success: false,
        error: "Cette commande n'est pas une livraison",
      });
    }

    // Track change in history
    const oldDeliveryStatus = order.deliveryStatus || "pending";
    const oldStatus = order.status;
    order.deliveryStatus = deliveryStatus as
      | "pending"
      | "in_transit"
      | "arrived"
      | "delivered";

    // If delivery is completed, update order status to delivered
    if (deliveryStatus === "delivered") {
      order.status = "delivered";
    }

    const change = {
      changedAt: new Date(),
      changedBy: req.user?.id || "delivery_driver",
      field: "delivery_status",
      oldValue: oldDeliveryStatus,
      newValue: deliveryStatus,
      changeType: "updated" as const,
      notes: `Delivery status updated by driver: ${deliveryStatus}`,
    };

    order.changeHistory = order.changeHistory || [];
    order.changeHistory.push(change);

    await order.save();

    // Send SMS notification to customer for delivery updates
    let smsSent: string | null = null;
    const customerPhone = order.clientInfo?.phone;
    const shortNumber = order.orderNumber.split("-").pop() || order.orderNumber;

    if (customerPhone && (deliveryStatus === "in_transit" || deliveryStatus === "arrived")) {
      const smsMessages: Record<string, string> = {
        in_transit: `Votre livreur est en route pour la commande #${shortNumber} il vous attendra à l'entrée principale. Ce numéro n'accepte pas les appels.`,
        arrived: `Marius et Fanny: Votre livreur est arrivé pour la commande #${shortNumber}. Bon appétit!`,
      };

      const statusLabel = deliveryStatus === "in_transit" ? "EN ROUTE" : "ARRIVÉ";
      console.log(`\n📱 ============ SMS LIVRAISON ============`);
      console.log(`📱 Commande: #${shortNumber}`);
      console.log(`📱 Client: ${order.clientInfo?.firstName} ${order.clientInfo?.lastName}`);
      console.log(`📱 Téléphone: ${customerPhone}`);
      console.log(`📱 Statut: ${statusLabel}`);
      console.log(`📱 Message: ${smsMessages[deliveryStatus]}`);

      try {
        const smsResult = await sendSms({ to: customerPhone, body: smsMessages[deliveryStatus] });
        smsSent = smsMessages[deliveryStatus];
        console.log(`📱 Résultat: ✅ SMS ENVOYÉ AVEC SUCCÈS`);
        console.log(`📱 SID: ${(smsResult as any)?.sid || (smsResult as any)?.dryRun ? "DRY-RUN" : "N/A"}`);
        console.log(`📱 =========================================\n`);
      } catch (smsErr: any) {
        console.log(`📱 Résultat: ❌ ÉCHEC ENVOI SMS`);
        console.log(`📱 Erreur: ${smsErr?.message || smsErr}`);
        console.log(`📱 =========================================\n`);
      }
    } else if (deliveryStatus === "in_transit" || deliveryStatus === "arrived") {
      console.log(`⚠️ SMS non envoyé pour commande #${shortNumber}: pas de téléphone client`);
    }

    res.json({
      success: true,
      message: "Statut de livraison mis à jour avec succès",
      data: {
        orderId: order._id,
        orderNumber: order.orderNumber,
        status: order.status,
        deliveryStatus: order.deliveryStatus,
        smsSent,
        updatedAt: new Date(),
      },
    });
  } catch (error: any) {
    console.error("Error updating delivery status:", error);
    res.status(500).json({
      success: false,
      error: "Erreur lors de la mise à jour du statut de livraison",
      message: error.message,
    });
  }
};
