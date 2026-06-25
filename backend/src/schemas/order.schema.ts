import { z } from "zod";

// Address schema
export const addressSchema = z.object({
  street: z.string().min(1, "L'adresse est requise"),
  city: z.string().min(1, "La ville est requise"),
  // Accept full names ("Québec") or 2-letter codes ("QC")
  // Province is optional — defaults to "QC" at the DB layer
  province: z.string().max(50).optional(),
  postalCode: z
    .string()
    .min(3, "Le code postal doit contenir au moins 3 caractères")
    .max(10, "Le code postal ne peut pas dépasser 10 caractères"),
  // Détails optionnels : compagnie, étage, local…
  details: z.string().max(300).optional(),
});

// Order item schema
export const orderItemSchema = z.object({
  productId: z.number().int().nonnegative("L'ID du produit doit être 0 ou positif"),
  productName: z.string().min(1, "Le nom du produit est requis"),
  quantity: z.number().int().positive("La quantité doit être positive"),
  unitPrice: z.number().nonnegative("Le prix unitaire doit être non négatif"),
  amount: z.number().nonnegative("Le montant doit être non négatif"),
  taxable: z.boolean().optional(),
  notes: z.string().optional(),
  selectedOptions: z.record(z.string(), z.string()).optional(),
  productionStatus: z.enum(["pending", "in_progress", "ready"]).optional(),
});

// Client info schema. Phone is optional: many self-signup clients don't
// provide one, and the order can still be honored by email confirmation.
// We only require a valid phone format if a phone is actually given — and
// SMS payment-link sending has its own stricter check at payment time.
export const clientInfoSchema = z.object({
  firstName: z.string().min(1, "Le prénom est requis"),
  lastName: z.string().min(1, "Le nom de famille est requis"),
  // Email OPTIONNEL (ex. client âgé sans courriel) : accepte vide ou absent.
  // Le format reste validé si une valeur est fournie.
  email: z.string().email("Format d'email invalide").optional().or(z.literal("")),
  phone: z
    .string()
    .optional()
    .default("")
    .refine(
      (val) => !val || /^[\d\s\-().+]+$/.test(val),
      "Le numéro de téléphone contient des caractères invalides",
    ),
  // Poste téléphonique (optionnel)
  phoneExtension: z.string().max(20).optional(),
});

// Create order schema - for POST /api/orders
export const createOrderSchema = z
  .object({
    clientInfo: clientInfoSchema,
    pickupDate: z.string().datetime().optional(),
    pickupLocation: z.enum(["Montreal", "Laval"], {
      message: "Le lieu de ramassage doit être Montreal ou Laval",
    }),
    deliveryType: z.enum(["pickup", "delivery"], {
      message: "Le type de livraison doit être pickup ou delivery",
    }),
    deliveryDate: z.string().optional(),
    deliveryTimeSlot: z.string().optional(),
    deliveryAddress: addressSchema.optional(),
    items: z
      .array(orderItemSchema)
      .min(1, "Au moins un article est requis")
      .refine(
        (items) => items.every((item) => item.quantity > 0),
        "Tous les articles doivent avoir une quantité positive",
      ),
    notes: z.string().optional(),
    promoCode: z.string().min(2).max(32).optional(),
    paymentType: z
      .enum(["full", "deposit"], {
        message: "Le type de paiement doit être full ou deposit",
      })
      .default("full"),
    paymentLinkChannel: z.enum(["email", "sms"]).optional(),
    depositPaid: z.boolean().optional().default(false),
    squarePaymentId: z.string().optional(),
    billingKind: z.enum(["standard", "representant", "gouvernement"]).optional(),
    billingEmail: z.string().email().optional().or(z.literal("")),
    billingOrganization: z.string().max(120).optional(),
  })
  .refine(
    (data) => {
      // If delivery type is delivery, deliveryAddress is required
      if (data.deliveryType === "delivery") {
        return !!data.deliveryAddress;
      }
      return true;
    },
    {
      message: "L'adresse de livraison est requise pour une livraison",
      path: ["deliveryAddress"],
    },
  );

// Update order schema - for PATCH /api/orders/:id
export const updateOrderSchema = z.object({
  clientInfo: clientInfoSchema.optional(),
  pickupDate: z.string().datetime().optional(),
  pickupLocation: z.enum(["Montreal", "Laval"]).optional(),
  deliveryType: z.enum(["pickup", "delivery"]).optional(),
  deliveryDate: z.string().optional(),
  deliveryTimeSlot: z.string().optional(),
  deliveryAddress: addressSchema.optional(),
  items: z.array(orderItemSchema).optional(),
  status: z
    .enum([
      "pending",
      "confirmed",
      "in_production",
      "ready",
      "completed",
      "cancelled",
      "delivered",
    ])
    .optional(),
  depositPaid: z.boolean().optional(),
  balancePaid: z.boolean().optional(),
  amountPaid: z.number().nonnegative().optional(),
  refunds: z.array(z.object({
    refundedAt: z.string().optional(),
    employeeName: z.string().optional(),
    amountCents: z.number().optional(),
    reason: z.string().optional(),
    refundStatus: z.string().optional(),
    paymentId: z.string().optional(),
    refundId: z.string().optional(),
  })).optional(),
  squarePaymentId: z.string().optional(),
  squareInvoiceId: z.string().optional(),
  paymentLinkChannel: z.enum(["email", "sms"]).optional(),
  assignedDriver: z.object({
    id: z.string(),
    name: z.string(),
    assignedAt: z.string(),
  }).optional(),
  notes: z.string().optional(),
  billingKind: z.enum(["standard", "representant", "gouvernement"]).optional(),
  billingEmail: z.string().email().optional().or(z.literal("")),
  billingOrganization: z.string().max(120).optional(),
});

// Validate delivery fee schema - for POST /api/orders/validate-delivery
export const validateDeliverySchema = z.object({
  postalCode: z.string().min(3, "Le code postal doit contenir au moins 3 caractères"),
  subtotal: z.number().nonnegative("Le sous-total doit être non négatif"),
});

// Query parameters for listing orders
export const orderQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(500).optional().default(20),
  status: z
    .enum([
      "pending",
      "confirmed",
      "in_production",
      "ready",
      "completed",
      "cancelled",
      "delivered",
    ])
    .optional(),
  deliveryType: z.enum(["pickup", "delivery"]).optional(),
  paymentStatus: z.enum(["unpaid", "deposit_paid", "paid"]).optional(),
  fromDate: z.string().datetime().optional(),
  toDate: z.string().datetime().optional(),
});

// Export types inferred from schemas
export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type UpdateOrderInput = z.infer<typeof updateOrderSchema>;
export type ValidateDeliveryInput = z.infer<typeof validateDeliverySchema>;
export type OrderQueryParams = z.infer<typeof orderQuerySchema>;
