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
import { sendOrderBalanceEmail, sendInvoiceOrderConfirmation } from "../utils/mail.js";
import { sendSms } from "../utils/smsService.js";
import {
  calculatePromoDiscount,
  isPromoCurrentlyValid,
  normalizePromoCode,
} from "../utils/promo.js";

// Tax rate for Quebec (TPS + TVQ)
const TAX_RATE = 0.14975;

async function computeTaxAmount(
  items: { productId: number; quantity: number; amount: number; taxable?: boolean }[],
) {
  const ids = Array.from(new Set(items.map((i) => i.productId).filter((id) => id > 0)));
  const products = ids.length
    ? await Product.find({ id: { $in: ids }, deletedAt: { $exists: false } }).select("id category productionType hasTaxes").lean()
    : [];
  const productMap = new Map<number, any>(products.map((p: any) => [p.id, p]));

  const categoryText = (category: unknown) => {
    if (Array.isArray(category)) return category.join(" ").toLowerCase();
    return String(category || "").toLowerCase();
  };

  const viennoiseriesCount = items.reduce((sum, item) => {
    const p = productMap.get(item.productId);
    const category = categoryText(p?.category);
    return category.includes("viennoiser") ? sum + (item.quantity || 0) : sum;
  }, 0);

  const patisseriesCount = items.reduce((sum, item) => {
    const p = productMap.get(item.productId);
    const category = categoryText(p?.category);
    const isPatisserie = p?.productionType === "patisserie" || category.includes("patisser");
    return isPatisserie ? sum + (item.quantity || 0) : sum;
  }, 0);

  const bakedGoodsExempt = viennoiseriesCount + patisseriesCount >= 6;

  return items.reduce((sum, item) => {
    if ((item.productId || 0) <= 0) {
      const customItemTaxable = item.taxable !== undefined ? !!item.taxable : true;
      if (!customItemTaxable) return sum;
      return sum + (item.amount || 0) * TAX_RATE;
    }

    const p = productMap.get(item.productId);
    const category = categoryText(p?.category);
    const isViennoiserie = category.includes("viennoiser");
    const isPatisserie = p?.productionType === "patisserie" || category.includes("patisser");
    const isBakedGood = isViennoiserie || isPatisserie;

    const hasTaxes = p?.hasTaxes !== undefined ? !!p.hasTaxes : true;
    const itemIsTaxable = isBakedGood ? hasTaxes && !bakedGoodsExempt : hasTaxes;

    if (!itemIsTaxable) return sum;
    return sum + (item.amount || 0) * TAX_RATE;
  }, 0);
}

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
    // Displayed to users as 14h00; real backend cutoff is 14h15.
    const CUTOFF_MINUTES = 14 * 60 + 15;

    const now = new Date();
    const targetDateStr =
      orderData.pickupDate
        ? toMontrealDate(new Date(orderData.pickupDate))
        : orderData.deliveryDate
          ? toMontrealDate(new Date(orderData.deliveryDate))
          : null;

    if (targetDateStr) {
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
      const prepDays = Math.ceil(maxPrepHours / 24);

      // Build the minimum date in Montreal time, then add the 14h-cutoff
      // penalty (+1 day if ordering past the cutoff).
      const [tY, tM, tD] = todayStr.split("-").map((s) => parseInt(s, 10));
      const minDate = new Date(Date.UTC(tY, tM - 1, tD));
      minDate.setUTCDate(minDate.getUTCDate() + prepDays);
      if (pastCutoff) {
        minDate.setUTCDate(minDate.getUTCDate() + 1);
      }
      const minDateStr = minDate.toISOString().split("T")[0];

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

      if (!promoDoc) {
        return res.status(400).json({
          success: false,
          error: "Code promo invalide",
        });
      }

      const validity = isPromoCurrentlyValid(promoDoc, nowForPromo);
      if (!validity.ok) {
        return res.status(400).json({
          success: false,
          error: validity.reason,
        });
      }

      const discount = calculatePromoDiscount({
        promo: promoDoc,
        items: orderData.items,
        subtotal,
      });

      if (discount.discountAmount <= 0) {
        return res.status(400).json({
          success: false,
          error: "Ce code promo ne s'applique pas à votre panier.",
        });
      }

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
          return res.status(400).json({
            success: false,
            error: "Limite d'utilisation atteinte pour ce code promo.",
          });
        }
      }

      promoDiscountAmount = discount.discountAmount;
      promoDiscountPercent = promoDoc.discountPercent;
      promoAppliesToProductIds = promoDoc.appliesToProductIds || undefined;
    }

    const taxAmount = await computeTaxAmount(orderData.items as any);
    let deliveryFee = 0;

    // If delivery, calculate and validate delivery fee
    if (orderData.deliveryType === "delivery" && orderData.deliveryAddress) {
      const deliveryInfo = calculateDeliveryFee(
        orderData.deliveryAddress.postalCode,
      );

      if (!deliveryInfo.isValid) {
        return res.status(400).json({
          success: false,
          error: "Code postal non valide pour la livraison",
        });
      }

      deliveryFee = deliveryInfo.fee;

      // Validate minimum order
      const minimumValidation = validateMinimumOrder(
        orderData.deliveryAddress.postalCode,
        subtotal,
      );

      if (!minimumValidation.isValid) {
        return res.status(400).json({
          success: false,
          error: `Montant minimum de commande non atteint. Minimum requis: ${minimumValidation.minimumOrder.toFixed(2)}$ pour ${minimumValidation.postalCode}. Il manque ${minimumValidation.shortfall.toFixed(2)}$.`,
        });
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

    // Create order
    let pickupDate: Date | undefined;
    if (orderData.pickupDate) {
      pickupDate = new Date(orderData.pickupDate);
    } else if (orderData.deliveryType === "pickup" && orderData.deliveryDate) {
      const slot = String(orderData.deliveryTimeSlot || "00:00").trim() || "00:00";
      pickupDate = new Date(`${orderData.deliveryDate}T${slot}:00`);
    }

    // For representatives: payment due on pickup/delivery date (not 60 days like government)
    if (billingKind === "representant" && !paymentDueDate) {
      if (pickupDate) {
        paymentDueDate = pickupDate;
        console.log("📋 [BILLING] Setting representative paymentDueDate to pickupDate:", paymentDueDate);
      } else if (orderData.deliveryDate) {
        paymentDueDate = new Date(orderData.deliveryDate);
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
          await order.deleteOne();
          return res.status(400).json({
            success: false,
            error: "Ce code promo n'est plus disponible.",
          });
        }

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
      } catch (promoErr: any) {
        // Best-effort rollback
        try {
          await PromoCode.updateOne(
            { _id: promoDoc._id },
            { $inc: { timesUsed: -1 } },
          );
        } catch {}
        await order.deleteOne();
        return res.status(400).json({
          success: false,
          error: promoErr?.message || "Erreur lors de l'application du code promo.",
        });
      }
    }

    // Automatically create a client record when this email does not exist yet.
    try {
      const normalizedEmail = orderData.clientInfo.email.trim().toLowerCase();
      const firstName = orderData.clientInfo.firstName.trim();
      const lastName = orderData.clientInfo.lastName.trim();
      const fullName = `${firstName} ${lastName}`.trim();
      const normalizedPhone = orderData.clientInfo.phone.trim();

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
      const isPaymentLinkFlow =
        !paidInStore && !orderData.squarePaymentId && !isGovernment;

      if (isPaymentLinkFlow) {
        console.log(
          `📧 [ORDER] Skipping confirmation email — payment-link flow; createInvoice will send the branded email with the Square link.`,
        );
      } else {
        const receiptMode: "full" | "deposit" | "invoice" = paidInStore
          ? "full"
          : isGovernment
            ? "invoice"
            : orderData.squarePaymentId && orderData.paymentType === "deposit"
              ? "deposit"
              : "full";

        const receiptPayload = {
          email: orderData.clientInfo.email,
          name: customerName,
          orderNumber: order.orderNumber,
          items: orderData.items.map((item) => ({
            productName: item.productName,
            quantity: item.quantity,
            amount: item.amount,
          })),
          subtotal,
          taxAmount,
          deliveryFee,
          total,
          depositAmount: depositPaid ? depositAmount : undefined,
          paymentId: orderData.squarePaymentId,
          invoiceUrl: undefined, // Will be updated via webhook or separate call
          orderDate: order.orderDate,
          pickupDate: order.pickupDate || (orderData.deliveryDate ? new Date(orderData.deliveryDate) : undefined),
          pickupTimeSlot: orderData.deliveryTimeSlot || undefined,
          deliveryType: orderData.deliveryType,
          clientNote: orderData.notes,
          orderId: order._id.toString(),
        };

        if (isGovernment) {
          // Gov contact #1: a CONFIRMATION without the facture breakdown — just
          // the order + total. The facture (with tax breakdown) goes to the
          // billing email below.
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
        const contactEmail = orderData.clientInfo.email.trim().toLowerCase();
        if (isGovernment && billingEmail && billingEmail !== contactEmail) {
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
      // Treat YYYY-MM-DD as a local calendar day (avoid UTC shift with `new Date(date)`).
      const startOfDay = new Date(`${date}T00:00:00.000`);
      const endOfDay = new Date(`${date}T23:59:59.999`);

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
        const resolvedProductionType =
          normalizeProductionType(productById?.productionType) ??
          normalizeProductionType(productByName?.productionType);

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

    // Execute query with pagination
    const skip = (Number(page) - 1) * Number(limit);
    const [orders, total] = await Promise.all([
      Order.find(query).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
      Order.countDocuments(query),
    ]);

    // Backfill amountPaid for old orders that don't have it set
    for (const order of orders) {
      if ((!order.amountPaid || order.amountPaid === 0) && order.paymentStatus === "paid") {
        order.amountPaid = order.total;
        order.save().catch(() => {});
      }
    }

    // Add payment status indicators
    const ordersWithStatus = orders.map((order: any) => {
      const orderObj = order.toObject?.() || order;
      const isPaymentOverdue = 
        orderObj.paymentDueDate && 
        orderObj.paymentStatus === "unpaid" &&
        new Date() > new Date(orderObj.paymentDueDate);
      
      const daysOverdue = isPaymentOverdue && orderObj.paymentDueDate
        ? Math.ceil((new Date().getTime() - new Date(orderObj.paymentDueDate).getTime()) / (1000 * 60 * 60 * 24))
        : 0;

      return {
        ...orderObj,
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

    // Track and update client info
    if (updateData.clientInfo) {
      const oldClientInfo = { ...order.clientInfo };
      order.clientInfo = updateData.clientInfo;
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

      const taxAmount = await computeTaxAmount(updateData.items as any);
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
      order.deliveryFee = deliveryFee;
      order.total = total;
      order.depositAmount = depositAmount;

      changes.push({
        changedAt: new Date(),
        changedBy: userId,
        field: "items",
        oldValue: oldItems,
        newValue: updateData.items,
        changeType: "items_modified",
        notes: `Order items modified. Total: ${oldTotal.toFixed(2)}$ -> ${total.toFixed(2)}$`
      });

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

    // Add all changes to order history
    if (changes.length > 0) {
      order.changeHistory.push(...changes);
    }

    await order.save();

    console.log(`✅ Order ${order.orderNumber} updated with ${changes.length} changes`);

    // NOTE: Balance email is no longer sent automatically here.
    // The admin explicitly chooses via the balance modal (email with link OR in-store).
    // This avoids duplicate emails and ensures the email has a proper payment link.

    res.json({
      success: true,
      data: order,
      message: "Commande mise à jour avec succès",
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
        in_transit: `Votre livreur est arrivé pour la commande #${shortNumber} il vous attend à l'entrée principale. Ce numéro n'accepte pas les appels.`,
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
