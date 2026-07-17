import { Request, Response } from "express";
import ProOrder from "../models/ProOrder.js";
import type { ApiResponse } from "../types.js";
import type { CreateProOrderInput } from "../schemas/proOrder.schema.js";
import type { AuthRequest } from "../middleware/auth.js";
import { sendProOrderEmailToAdmin } from "../utils/mail.js";
// Calcul des taxes : source unique partagée avec les commandes et les
// soumissions (voir utils/tax.ts).
import { computeTaxBreakdown } from "../utils/tax.js";

const PRO_DELIVERY_MINIMUM = 150;

function formatYyyyMmDd(date: Date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

async function generateUniqueProOrderNumber() {
  const base = `PRO-${formatYyyyMmDd(new Date())}`;
  for (let attempt = 0; attempt < 8; attempt++) {
    const suffix = Math.floor(10000 + Math.random() * 90000);
    const candidate = `${base}-${suffix}`;
    const exists = await ProOrder.exists({ orderNumber: candidate });
    if (!exists) return candidate;
  }
  return `${base}-${Date.now().toString().slice(-5)}`;
}

export const createProOrder = async (
  req: Request<{}, {}, CreateProOrderInput>,
  res: Response<ApiResponse>,
) => {
  const authReq = req as AuthRequest;
  try {
    if (!authReq.user) {
      return res.status(401).json({
        success: false,
        error: "Unauthorized",
        message: "Authentication required",
      });
    }

    const body = req.body;

    // Anti-doublon : si ce paiement Square a déjà créé une commande pro (renvoi
    // automatique du filet de sécurité après une coupure réseau), on renvoie la
    // commande existante au lieu d'en créer une seconde. Le paymentId est
    // embarqué dans les notes ("Paiement Square: <id>").
    const paymentIdMatch = String(body.notes || "").match(
      /Paiement Square:\s*([A-Za-z0-9]+)/,
    );
    if (paymentIdMatch) {
      const existingPro = await ProOrder.findOne({
        userId: authReq.user.id,
        notes: { $regex: paymentIdMatch[1] },
      });
      if (existingPro) {
        console.warn(
          `⛔ [PRO-ORDER] Doublon évité : le paiement ${paymentIdMatch[1]} a déjà la commande ${existingPro.orderNumber}`,
        );
        return res.status(200).json({
          success: true,
          data: existingPro,
          message: "Commande déjà créée pour ce paiement (doublon évité).",
        });
      }
    }

    const items = body.items.map((item) => {
      const quantity = Math.max(1, Number(item.quantity || 0));
      const unitPrice = Math.max(0, Number(item.unitPrice || 0));
      const amount = unitPrice * quantity;
      return {
        productId: Number(item.productId || 0),
        productName: String(item.productName || "").trim() || `Produit #${item.productId}`,
        quantity,
        unitPrice,
        amount,
        notes: item.notes || undefined,
        selectedOptions:
          item.selectedOptions && Object.keys(item.selectedOptions).length > 0
            ? item.selectedOptions
            : undefined,
      };
    });

    const subtotal = items.reduce((sum, item) => sum + item.amount, 0);

    if (body.deliveryType === "delivery" && subtotal < PRO_DELIVERY_MINIMUM) {
      return res.status(400).json({
        success: false,
        error: `Minimum de ${PRO_DELIVERY_MINIMUM}$ requis pour une livraison professionnelle.`,
      });
    }

    const deliveryFee =
      body.deliveryType === "delivery"
        ? body.deliveryDistanceTier === "gt20"
          ? 30
          : 15
        : 0;

    const taxBreakdown = await computeTaxBreakdown(
      items.map((i) => ({ productId: i.productId, quantity: i.quantity, amount: i.amount })),
    );
    const taxAmount = taxBreakdown.total;

    const total = subtotal + taxAmount + deliveryFee;

    const orderNumber = await generateUniqueProOrderNumber();

    const proOrder = await ProOrder.create({
      orderNumber,
      userId: authReq.user.id,
      clientInfo: body.clientInfo,
      pickupDate: body.pickupDate ? new Date(body.pickupDate) : undefined,
      pickupLocation: body.pickupLocation,
      deliveryType: body.deliveryType,
      deliveryDate: body.deliveryDate || undefined,
      deliveryTimeSlot: body.deliveryTimeSlot || undefined,
      deliveryAddress: body.deliveryAddress || undefined,
      deliveryDistanceTier: body.deliveryDistanceTier || undefined,
      items,
      subtotal,
      taxAmount,
      tpsAmount: taxBreakdown.tps,
      tvqAmount: taxBreakdown.tvq,
      deliveryFee,
      total,
      notes: body.notes || undefined,
      status: "submitted",
    });

    const adminEmail = String(process.env.ADMIN_EMAIL || "").trim() || "fanny.chiecchio@gmail.com";
    try {
      await sendProOrderEmailToAdmin(adminEmail, proOrder.toObject());
      proOrder.adminNotifiedAt = new Date();
      await proOrder.save();
    } catch (emailError) {
      console.error("❌ [PRO-ORDER] Failed to send admin email:", emailError);
    }

    return res.status(201).json({
      success: true,
      data: proOrder,
    });
  } catch (error: any) {
    console.error("❌ [PRO-ORDER] Create failed:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to create pro order",
      message: error?.message,
    });
  }
};

export const getMyProOrders = async (req: Request, res: Response<ApiResponse>) => {
  const authReq = req as AuthRequest;
  try {
    if (!authReq.user) {
      return res.status(401).json({
        success: false,
        error: "Unauthorized",
        message: "Authentication required",
      });
    }

    const orders = await ProOrder.find({ userId: authReq.user.id })
      .sort({ orderDate: -1, createdAt: -1 })
      .lean();

    return res.json({
      success: true,
      data: { orders },
    });
  } catch (error: any) {
    console.error("❌ [PRO-ORDER] List failed:", error);
    return res.status(500).json({
      success: false,
      error: "Failed to fetch pro orders",
      message: error?.message,
    });
  }
};

