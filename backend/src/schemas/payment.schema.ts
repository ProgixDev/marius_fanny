/**
 * Payment Validation Schemas
 * Zod schemas for Square payment requests
 */

import { z } from "zod";

/**
 * Create Payment Schema
 * POST /api/payments/create
 */
export const createPaymentSchema = z.object({
  sourceId: z.string().min(1, "Payment source ID is required"),
  amount: z.number().positive("Amount must be positive"),
  currency: z.string().optional().default("CAD"),
  customerId: z.string().optional(),
  note: z.string().optional(),
});

/**
 * Refund Payment Schema
 * POST /api/payments/refund
 */
export const refundPaymentSchema = z.object({
  paymentId: z.string().min(1, "Payment ID is required"),
  amount: z.number().positive("Refund amount must be positive"),
  currency: z.string().optional().default("CAD"),
  reason: z.string().optional(),
});

/**
 * List Payments Schema
 * GET /api/payments/list
 */
export const listPaymentsSchema = z.object({
  beginTime: z.string().optional(),
  endTime: z.string().optional(),
  cursor: z.string().optional(),
});

/**
 * Create Invoice Schema
 * POST /api/payments/invoice
 */
export const createInvoiceSchema = z.object({
  orderId: z.string().min(1, "Order ID is required"),
  orderNumber: z.string().optional(),
  // Courriel optionnel : pour l'envoi par SMS, on n'a pas besoin de courriel.
  // Le format reste validé si une valeur non vide est fournie ; l'exigence
  // "email requis pour l'envoi par courriel" est gérée dans le contrôleur.
  customerEmail: z.string().email("Valid email is required").optional().or(z.literal("")),
  customerPhone: z.string().optional(),
  customerName: z.string().min(1, "Customer name is required"),
  deliveryChannel: z.enum(["email", "sms"]).optional().default("email"),
  items: z.array(
    z.object({
      name: z.string(),
      quantity: z.number().positive(),
      unitPrice: z.number().positive(),
    })
  ),
  deliveryFee: z.number().min(0).optional().default(0),
  taxAmount: z.number().min(0),
  total: z.number().positive(),
  dueDate: z.string().optional(), // ISO date string
  notes: z.string().optional(),
});

export const refundOrderSchema = z.object({
  orderId: z.string().min(1, "Order ID is required"),
  reason: z.string().optional(),
  employeeName: z.string().trim().min(1, "Employee name is required"),
});

/**
 * Get Invoice Schema
 * GET /api/payments/invoice/:invoiceId
 */
export const getInvoiceSchema = z.object({
  invoiceId: z.string().min(1, "Invoice ID is required"),
});

// Type exports
export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;
export type RefundPaymentInput = z.infer<typeof refundPaymentSchema>;
export type ListPaymentsInput = z.infer<typeof listPaymentsSchema>;
export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;
export type GetInvoiceInput = z.infer<typeof getInvoiceSchema>;
export type RefundOrderInput = z.infer<typeof refundOrderSchema>;
