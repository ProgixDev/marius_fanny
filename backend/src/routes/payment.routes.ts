/**
 * Payment Routes
 * Square payment processing endpoints
 */

import { Router } from "express";
import {
  createPayment,
  getPayment,
  listPayments,
  refundPayment,
  refundOrderPayment,
  reconcileOrderRefund,
  resendFacture,
  refundOrderInStore,
  refundBalance,
  getSquareConfig,
  createInvoice,
  getInvoice,
  resendInvoiceLink,
  squareWebhook,
  cancelInvoice,
} from "../controllers/payment.controller.js";
import { validateBody, validateQuery } from "../middleware/validation.js";
import {
  createPaymentSchema,
  refundPaymentSchema,
  refundOrderSchema,
  listPaymentsSchema,
  createInvoiceSchema,
} from "../schemas/payment.schema.js";
import { requireAuth, requireAdmin, requireRole } from "../middleware/auth.js";

const router = Router();

/**
 * Public routes
 */

// Get Square configuration for frontend
router.get("/config", getSquareConfig);

// Square webhook (receives payment notifications)
router.post("/webhook", squareWebhook);

/**
 * Payment processing routes
 */

// Create a new payment
router.post("/create", validateBody(createPaymentSchema), createPayment);

// Get payment by ID
router.get("/:paymentId", getPayment);

// List payments with pagination
router.get("/list", validateQuery(listPaymentsSchema), listPayments);

// Refund a payment
router.post("/refund", requireAuth, requireRole("admin", "vendeur"), validateBody(refundPaymentSchema), refundPayment);
router.post(
  "/refund-order",
  requireAuth,
  requireRole("admin", "vendeur"),
  validateBody(refundOrderSchema),
  refundOrderPayment,
);

// Reconcile an order's refund status from Square (fixes "Payé" stuck after refund)
router.post(
  "/reconcile-refund",
  requireAuth,
  requireRole("admin", "vendeur"),
  reconcileOrderRefund,
);

// Resend the facture to a government order's billing email (the city)
router.post(
  "/resend-facture",
  requireAuth,
  requireAdmin,
  resendFacture,
);

// Partial refund for balance difference
router.post(
  "/refund-balance",
  requireAuth,
  requireRole("admin", "vendeur"),
  refundBalance,
);

// In-store refund (no Square call — bookkeeping only)
router.post(
  "/refund-order-in-store",
  requireAuth,
  requireRole("admin", "vendeur"),
  refundOrderInStore,
);

/**
 * Invoice routes
 */

// Create a Square invoice
router.post(
  "/invoice",
  requireAuth,
  requireRole("admin", "vendeur"),
  validateBody(createInvoiceSchema),
  createInvoice,
);

// Get invoice by ID
router.get("/invoice/:invoiceId", getInvoice);

// Renvoyer le MÊME lien de paiement (facture existante) sans en recréer un
router.post(
  "/resend-invoice-link",
  requireAuth,
  requireRole("admin", "vendeur"),
  resendInvoiceLink,
);

// Cancel a Square invoice
router.post("/cancel-invoice", requireAuth, requireAdmin, cancelInvoice);

export default router;
