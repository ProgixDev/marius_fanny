import { Request, Response } from "express";
import { Quote } from "../models/Quote.js";
import { User } from "../models/User.js";
import Order from "../models/Order.js";
import { sendQuoteEmail } from "../utils/mail.js";
import { AuthRequest } from "../middleware/auth.js";
import { createInvoiceForExistingOrder } from "./payment.controller.js";

const TAX_RATE = 0.14975;

/**
 * Compute totals from items (server-side to avoid tampering)
 */
function computeTotals(items: any[], deliveryFee = 0) {
  let subtotal = 0;
  let taxableSubtotal = 0;
  for (const item of items) {
    const amount = (Number(item.unitPrice) || 0) * (Number(item.quantity) || 0);
    subtotal += amount;
    if (item.taxable !== false) taxableSubtotal += amount;
  }
  const taxAmount = taxableSubtotal * TAX_RATE;
  const total = subtotal + taxAmount + (Number(deliveryFee) || 0);
  return {
    subtotal: Math.round(subtotal * 100) / 100,
    taxAmount: Math.round(taxAmount * 100) / 100,
    total: Math.round(total * 100) / 100,
  };
}

/**
 * Auto-expire quotes older than 30 days
 */
async function expireOldQuotes() {
  const now = new Date();
  await Quote.updateMany(
    { status: "pending", expiresAt: { $lt: now } },
    { $set: { status: "expired" } },
  );
}

/**
 * POST /api/quotes
 * Create a new quote (admin)
 */
export async function createQuote(req: AuthRequest, res: Response) {
  try {
    const {
      clientInfo,
      items,
      deliveryType = "pickup",
      deliveryDate,
      deliveryTimeSlot,
      pickupLocation,
      deliveryAddress,
      deliveryFee = 0,
      billingKind = "standard",
      billingOrganization,
      notes,
      paymentMethod,
      paymentLinkChannel,
    } = req.body;

    if (!clientInfo?.email || !clientInfo?.firstName) {
      return res.status(400).json({ success: false, error: "Informations client incomplètes" });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, error: "Aucun article fourni" });
    }

    // Recalculate items amount server-side
    const normalizedItems = items.map((it: any) => ({
      productId: Number(it.productId) || 0,
      productName: String(it.productName || "").trim(),
      quantity: Math.max(1, Number(it.quantity) || 1),
      unitPrice: Math.max(0, Number(it.unitPrice) || 0),
      amount: (Number(it.unitPrice) || 0) * (Number(it.quantity) || 0),
      taxable: it.taxable,
      notes: it.notes,
      selectedOptions: it.selectedOptions,
    }));

    const totals = computeTotals(normalizedItems, deliveryFee);

    // Create the client in DB if not exists
    const email = String(clientInfo.email).trim().toLowerCase();
    const existingUser = await User.findOne({ email });
    if (!existingUser) {
      await User.create({
        email,
        name: `${clientInfo.firstName} ${clientInfo.lastName || ""}`.trim(),
        role: "user",
        status: "active",
        emailVerified: true,
        profile: { phoneNumber: clientInfo.phone },
        billing: {
          kind: billingKind,
          organization: billingOrganization,
          paymentTermsDays: billingKind === "gouvernement" ? 180 : 0,
          allowUnpaidOrders: billingKind !== "standard",
        },
      }).catch(() => null);
    }

    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const quote = new Quote({
      clientInfo: {
        firstName: clientInfo.firstName,
        lastName: clientInfo.lastName || "",
        email,
        phone: clientInfo.phone,
      },
      items: normalizedItems,
      subtotal: totals.subtotal,
      taxAmount: totals.taxAmount,
      deliveryFee: Number(deliveryFee) || 0,
      total: totals.total,
      deliveryType,
      deliveryDate: deliveryDate || undefined,
      deliveryTimeSlot: deliveryTimeSlot || undefined,
      pickupLocation,
      deliveryAddress: deliveryType === "delivery" ? deliveryAddress : undefined,
      billingKind,
      billingOrganization,
      notes,
      paymentMethod: paymentMethod === "payment_link" ? "payment_link" : "in_store",
      paymentLinkChannel: paymentLinkChannel === "sms" ? "sms" : "email",
      expiresAt,
      createdBy: req.user?.id,
    });

    await quote.save();

    // Send email with link
    try {
      await sendQuoteEmail({
        to: email,
        clientName: `${clientInfo.firstName} ${clientInfo.lastName || ""}`.trim(),
        quoteNumber: quote.quoteNumber,
        quoteId: quote._id.toString(),
        items: normalizedItems.map((i) => ({
          productName: i.productName,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          amount: i.amount,
        })),
        subtotal: totals.subtotal,
        taxAmount: totals.taxAmount,
        deliveryFee: Number(deliveryFee) || 0,
        total: totals.total,
        expiresAt,
      });
    } catch (e: any) {
      console.error("Quote email failed:", e?.message);
    }

    res.status(201).json({ success: true, data: quote });
  } catch (error: any) {
    console.error("createQuote error:", error);
    res.status(500).json({ success: false, error: error?.message || "Failed to create quote" });
  }
}

/**
 * GET /api/quotes
 * List quotes (admin)
 */
export async function listQuotes(req: AuthRequest, res: Response) {
  try {
    await expireOldQuotes();
    const { status, page = 1, limit = 50 } = req.query as any;
    const query: any = {};
    if (status) query.status = status;

    const pageNum = Math.max(1, Number(page) || 1);
    const limitNum = Math.min(200, Math.max(1, Number(limit) || 50));
    const skip = (pageNum - 1) * limitNum;

    const [items, total] = await Promise.all([
      Quote.find(query).sort({ createdAt: -1 }).skip(skip).limit(limitNum).lean(),
      Quote.countDocuments(query),
    ]);

    res.json({
      success: true,
      data: {
        items,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      },
    });
  } catch (error: any) {
    console.error("listQuotes error:", error);
    res.status(500).json({ success: false, error: error?.message || "Failed to list quotes" });
  }
}

/**
 * GET /api/quotes/:id
 * Get quote by ID (admin OR public via email link)
 */
export async function getQuote(req: Request, res: Response) {
  try {
    const quote = await Quote.findById(req.params.id).lean();
    if (!quote) {
      return res.status(404).json({ success: false, error: "Soumission introuvable" });
    }
    // Auto-expire if needed
    if (quote.status === "pending" && new Date(quote.expiresAt) < new Date()) {
      await Quote.findByIdAndUpdate(req.params.id, { status: "expired" });
      (quote as any).status = "expired";
    }
    res.json({ success: true, data: quote });
  } catch (error: any) {
    console.error("getQuote error:", error);
    res.status(500).json({ success: false, error: error?.message || "Failed to fetch quote" });
  }
}

/**
 * PATCH /api/quotes/:id
 * Update a quote (admin only, while pending)
 */
export async function updateQuote(req: AuthRequest, res: Response) {
  try {
    const quote = await Quote.findById(req.params.id);
    if (!quote) {
      return res.status(404).json({ success: false, error: "Soumission introuvable" });
    }
    if (quote.status !== "pending") {
      return res.status(400).json({
        success: false,
        error: "Seules les soumissions en attente peuvent être modifiées",
      });
    }

    const {
      clientInfo,
      items,
      deliveryType,
      deliveryDate,
      deliveryTimeSlot,
      pickupLocation,
      deliveryAddress,
      deliveryFee,
      notes,
      billingKind,
      billingOrganization,
      paymentMethod,
      paymentLinkChannel,
    } = req.body;

    if (clientInfo) quote.clientInfo = { ...quote.clientInfo, ...clientInfo };
    if (Array.isArray(items)) {
      quote.items = items.map((it: any) => ({
        productId: Number(it.productId) || 0,
        productName: String(it.productName || "").trim(),
        quantity: Math.max(1, Number(it.quantity) || 1),
        unitPrice: Math.max(0, Number(it.unitPrice) || 0),
        amount: (Number(it.unitPrice) || 0) * (Number(it.quantity) || 0),
        taxable: it.taxable,
        notes: it.notes,
        selectedOptions: it.selectedOptions,
      }));
      const totals = computeTotals(quote.items, deliveryFee ?? quote.deliveryFee);
      quote.subtotal = totals.subtotal;
      quote.taxAmount = totals.taxAmount;
      quote.total = totals.total;
    }
    if (deliveryType) quote.deliveryType = deliveryType;
    if (deliveryDate !== undefined) quote.deliveryDate = deliveryDate || undefined;
    if (deliveryTimeSlot !== undefined) quote.deliveryTimeSlot = deliveryTimeSlot || undefined;
    if (pickupLocation !== undefined) quote.pickupLocation = pickupLocation;
    if (deliveryAddress !== undefined) quote.deliveryAddress = deliveryAddress;
    if (deliveryFee !== undefined) quote.deliveryFee = Number(deliveryFee) || 0;
    if (notes !== undefined) quote.notes = notes;
    if (billingKind) quote.billingKind = billingKind;
    if (billingOrganization !== undefined) quote.billingOrganization = billingOrganization;
    if (paymentMethod === "in_store" || paymentMethod === "payment_link") {
      quote.paymentMethod = paymentMethod;
    }
    if (paymentLinkChannel === "email" || paymentLinkChannel === "sms") {
      quote.paymentLinkChannel = paymentLinkChannel;
    }

    // Recompute totals after any change
    const totals = computeTotals(quote.items, quote.deliveryFee);
    quote.subtotal = totals.subtotal;
    quote.taxAmount = totals.taxAmount;
    quote.total = totals.total;

    await quote.save();
    res.json({ success: true, data: quote });
  } catch (error: any) {
    console.error("updateQuote error:", error);
    res.status(500).json({ success: false, error: error?.message || "Failed to update quote" });
  }
}

/**
 * DELETE /api/quotes/:id
 * Cancel a quote (admin) — soft delete, keeps the record for history.
 */
export async function cancelQuote(req: AuthRequest, res: Response) {
  try {
    const quote = await Quote.findByIdAndUpdate(
      req.params.id,
      { status: "cancelled" },
      { new: true },
    );
    if (!quote) return res.status(404).json({ success: false, error: "Soumission introuvable" });
    res.json({ success: true, data: quote });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || "Failed to cancel quote" });
  }
}

/**
 * DELETE /api/quotes/:id/hard
 * Permanently remove a quote (admin). Used when the soumission was created
 * by mistake or is no longer relevant — gone from the DB, not just hidden.
 */
export async function hardDeleteQuote(req: AuthRequest, res: Response) {
  try {
    const quote = await Quote.findByIdAndDelete(req.params.id);
    if (!quote) return res.status(404).json({ success: false, error: "Soumission introuvable" });
    res.json({ success: true, data: { _id: quote._id } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || "Failed to delete quote" });
  }
}

/**
 * POST /api/quotes/:id/accept
 * Public: client accepts the quote → convert to Order
 */
export async function acceptQuote(req: Request, res: Response) {
  try {
    const quote = await Quote.findById(req.params.id);
    if (!quote) {
      return res.status(404).json({ success: false, error: "Soumission introuvable" });
    }
    if (quote.status !== "pending") {
      return res.status(400).json({
        success: false,
        error: `Cette soumission est déjà ${quote.status}`,
      });
    }
    if (new Date(quote.expiresAt) < new Date()) {
      quote.status = "expired";
      await quote.save();
      return res.status(400).json({ success: false, error: "Cette soumission a expiré" });
    }

    // Build address only when delivery AND required fields are present
    // (province is optional — defaults to "QC" at the DB layer)
    const addr = quote.deliveryAddress as any;
    const hasValidAddress =
      quote.deliveryType === "delivery" &&
      addr &&
      addr.street &&
      addr.city &&
      addr.postalCode;

    const orderData: any = {
      clientInfo: {
        firstName: quote.clientInfo.firstName,
        lastName: quote.clientInfo.lastName || "",
        email: quote.clientInfo.email,
        phone: quote.clientInfo.phone || "",
      },
      items: quote.items.map((i) => ({
        productId: i.productId,
        productName: i.productName,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        amount: i.amount,
        taxable: i.taxable,
        notes: i.notes,
        selectedOptions: i.selectedOptions,
        productionStatus: "pending",
      })),
      subtotal: quote.subtotal,
      taxAmount: quote.taxAmount,
      deliveryFee: quote.deliveryFee,
      total: quote.total,
      depositAmount: quote.total,
      deliveryType: quote.deliveryType,
      // Reporter la date/heure choisie à la création de la soumission (et non la
      // date du moment de l'acceptation). pickupDate est calculé comme dans
      // createOrder pour que l'affichage « Date / heure » et l'inventaire soient
      // corrects.
      deliveryDate: quote.deliveryDate || undefined,
      deliveryTimeSlot: quote.deliveryTimeSlot || undefined,
      // Extract HH:MM from the slot (delivery slots are ranges like
      // "08:00 - 09:00", so a raw concat would build an invalid Date).
      pickupDate: quote.deliveryDate
        ? (() => {
            const m = String(quote.deliveryTimeSlot || "").match(/^(\d{2}):(\d{2})/);
            const hhmm = m ? `${m[1]}:${m[2]}` : "00:00";
            return new Date(`${quote.deliveryDate}T${hhmm}:00`);
          })()
        : undefined,
      pickupLocation: quote.pickupLocation || "Montreal",
      billingKind: quote.billingKind,
      billingOrganization: quote.billingOrganization,
      paymentType: "full",
      depositPaid: false,
      balancePaid: false,
      paymentStatus: "unpaid",
      amountPaid: 0,
      status: "pending",
      deliveryStatus: "pending",
      orderDate: new Date(),
      notes: quote.notes,
      paymentMethod: quote.paymentMethod || "in_store",
      paymentLinkChannel: quote.paymentLinkChannel || "email",
    };

    if (hasValidAddress) {
      orderData.deliveryAddress = {
        street: addr.street,
        city: addr.city,
        province: addr.province || "QC",
        postalCode: addr.postalCode,
      };
    }

    // Rattacher la commande au compte du client (créé/retrouvé à la création du
    // devis) pour qu'elle apparaisse dans son « Mon compte ».
    const quoteUser = await User.findOne({ email: quote.clientInfo.email })
      .select("_id")
      .lean();
    if (quoteUser?._id) {
      orderData.userId = quoteUser._id.toString();
    }

    const order = new Order(orderData);
    await order.save();

    quote.status = "accepted";
    quote.acceptedAt = new Date();
    quote.orderId = order._id.toString();
    await quote.save();

    // If the original soumission asked for "lien de paiement", auto-issue
    // a Square invoice and notify the customer on the chosen channel.
    // Skip for government clients (they pay by cheque/transfer per the
    // existing convention) and for in-store payment.
    let paymentLinkSent = false;
    let paymentLinkError: string | undefined;
    if (
      quote.paymentMethod === "payment_link" &&
      quote.billingKind !== "gouvernement"
    ) {
      try {
        await createInvoiceForExistingOrder(
          order._id.toString(),
          quote.paymentLinkChannel === "sms" ? "sms" : "email",
        );
        paymentLinkSent = true;
        console.log(
          `✅ [QUOTE-ACCEPT] Payment link auto-sent (${quote.paymentLinkChannel}) for order ${order.orderNumber}`,
        );
      } catch (linkErr: any) {
        paymentLinkError = linkErr?.message || "Echec envoi lien de paiement";
        // Log the FULL error (including Square SDK details) so we can
        // diagnose from Vercel logs. The errors[] field holds Square's
        // structured error response when present.
        console.error(
          `⚠️ [QUOTE-ACCEPT] Auto payment link failed for ${order.orderNumber}:`,
          {
            message: paymentLinkError,
            stack: linkErr?.stack,
            errors: linkErr?.errors,
            statusCode: linkErr?.statusCode,
            body: linkErr?.body,
          },
        );
      }
    } else {
      // No payment-link flow → still send a branded "Commande confirmée"
      // email so the customer (and especially government clients who pay
      // later by cheque/transfer) has a written confirmation with the full
      // breakdown. Without this, government quote acceptances landed in
      // production silently and the client got nothing.
      try {
        const { sendOrderReceipt } = await import("../utils/emailService.js");
        await sendOrderReceipt("invoice", {
          email: quote.clientInfo.email,
          name: `${quote.clientInfo.firstName} ${quote.clientInfo.lastName || ""}`.trim(),
          orderNumber: order.orderNumber,
          items: quote.items.map((i) => ({
            productName: i.productName,
            quantity: i.quantity,
            amount: i.amount,
          })),
          subtotal: quote.subtotal,
          taxAmount: quote.taxAmount,
          deliveryFee: quote.deliveryFee,
          total: quote.total,
          orderDate: order.orderDate,
          pickupDate: (order as any).pickupDate || undefined,
          pickupTimeSlot: (order as any).deliveryTimeSlot || undefined,
          deliveryType: order.deliveryType,
          clientNote: quote.notes,
          orderId: order._id.toString(),
        });
        console.log(
          `✅ [QUOTE-ACCEPT] Branded confirmation email sent to ${quote.clientInfo.email} (gov=${quote.billingKind === "gouvernement"})`,
        );
      } catch (emailErr: any) {
        console.error(
          `⚠️ [QUOTE-ACCEPT] Failed to send confirmation email for ${order.orderNumber}:`,
          emailErr?.message || emailErr,
        );
      }
    }

    res.json({
      success: true,
      data: {
        quote,
        orderId: order._id.toString(),
        orderNumber: order.orderNumber,
        paymentLinkSent,
        paymentLinkChannel: paymentLinkSent ? quote.paymentLinkChannel : undefined,
        paymentLinkError,
      },
    });
  } catch (error: any) {
    console.error("acceptQuote error:", error);
    res.status(500).json({ success: false, error: error?.message || "Failed to accept quote" });
  }
}

/**
 * POST /api/quotes/:id/refuse
 * Public: client refuses the quote
 */
export async function refuseQuote(req: Request, res: Response) {
  try {
    const quote = await Quote.findById(req.params.id);
    if (!quote) {
      return res.status(404).json({ success: false, error: "Soumission introuvable" });
    }
    if (quote.status !== "pending") {
      return res.status(400).json({
        success: false,
        error: `Cette soumission est déjà ${quote.status}`,
      });
    }
    quote.status = "refused";
    quote.refusedAt = new Date();
    await quote.save();
    res.json({ success: true, data: quote });
  } catch (error: any) {
    console.error("refuseQuote error:", error);
    res.status(500).json({ success: false, error: error?.message || "Failed to refuse quote" });
  }
}
