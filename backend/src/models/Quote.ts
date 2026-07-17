import mongoose, { Schema, Document } from "mongoose";

export interface IQuoteItem {
  productId: number;
  productName: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  taxable?: boolean;
  notes?: string;
  selectedOptions?: Record<string, string>;
}

export interface IQuote extends Document {
  quoteNumber: string;
  clientInfo: {
    firstName: string;
    lastName: string;
    email: string;
    phone?: string;
  };
  items: IQuoteItem[];
  subtotal: number;
  taxAmount: number;
  tpsAmount?: number;
  tvqAmount?: number;
  deliveryFee: number;
  total: number;
  deliveryType: "pickup" | "delivery";
  // Date/heure de ramassage ou livraison choisie à la création de la soumission.
  // Reportée telle quelle sur la commande lors de l'acceptation (sinon la
  // commande prenait la date du moment de l'acceptation).
  deliveryDate?: string;
  deliveryTimeSlot?: string;
  pickupLocation?: "Montreal" | "Laval";
  deliveryAddress?: {
    street: string;
    city: string;
    province: string;
    postalCode: string;
  };
  billingKind?: "standard" | "representant" | "gouvernement";
  billingOrganization?: string;
  notes?: string;
  paymentMethod?: "in_store" | "payment_link";
  paymentLinkChannel?: "email" | "sms";
  status: "pending" | "accepted" | "refused" | "expired" | "cancelled";
  expiresAt: Date;
  acceptedAt?: Date;
  refusedAt?: Date;
  orderId?: string; // Set when accepted and converted to an order
  createdBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

const QuoteItemSchema = new Schema<IQuoteItem>(
  {
    productId: { type: Number, required: true },
    productName: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
    amount: { type: Number, required: true, min: 0 },
    taxable: { type: Boolean },
    notes: { type: String, trim: true },
    selectedOptions: { type: Schema.Types.Mixed },
  },
  { _id: false },
);

const QuoteSchema = new Schema<IQuote>(
  {
    quoteNumber: { type: String, required: true, unique: true, index: true },
    clientInfo: {
      firstName: { type: String, required: true, trim: true },
      lastName: { type: String, required: true, trim: true },
      email: { type: String, required: true, trim: true, lowercase: true },
      phone: { type: String, trim: true },
    },
    items: { type: [QuoteItemSchema], default: [] },
    subtotal: { type: Number, required: true, min: 0, default: 0 },
    taxAmount: { type: Number, required: true, min: 0, default: 0 },
    tpsAmount: { type: Number, default: 0, min: 0 },
    tvqAmount: { type: Number, default: 0, min: 0 },
    deliveryFee: { type: Number, default: 0 },
    total: { type: Number, required: true, min: 0, default: 0 },
    deliveryType: {
      type: String,
      enum: ["pickup", "delivery"],
      required: true,
      default: "pickup",
    },
    deliveryDate: { type: String },
    deliveryTimeSlot: { type: String },
    pickupLocation: { type: String, enum: ["Montreal", "Laval"] },
    deliveryAddress: {
      street: String,
      city: String,
      province: String,
      postalCode: String,
    },
    billingKind: {
      type: String,
      enum: ["standard", "representant", "gouvernement"],
      default: "standard",
    },
    billingOrganization: { type: String, trim: true },
    notes: { type: String, trim: true },
    paymentMethod: {
      type: String,
      enum: ["in_store", "payment_link"],
      default: "in_store",
    },
    paymentLinkChannel: {
      type: String,
      enum: ["email", "sms"],
      default: "email",
    },
    status: {
      type: String,
      enum: ["pending", "accepted", "refused", "expired", "cancelled"],
      default: "pending",
      index: true,
    },
    expiresAt: { type: Date, required: true },
    acceptedAt: { type: Date },
    refusedAt: { type: Date },
    orderId: { type: String, trim: true },
    createdBy: { type: String },
  },
  { timestamps: true },
);

// Auto-generate quote number BEFORE validation: Q-YYYYMMDD-XXXX
QuoteSchema.pre("validate", async function () {
  if (this.isNew && !this.quoteNumber) {
    const today = new Date();
    const datePart = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
    const prefix = `Q-${datePart}-`;
    const count = await (this.constructor as any).countDocuments({
      quoteNumber: { $regex: `^${prefix}` },
    });
    this.quoteNumber = `${prefix}${String(count + 1).padStart(4, "0")}`;
  }
});

export const Quote = mongoose.model<IQuote>("Quote", QuoteSchema);
