import { Schema, model } from 'mongoose';

export interface IProduct {
  id: number;
  name: string;
  category: string[];
  price: number;
  discountPercentage?: number;
  available: boolean;
  minOrderQuantity: number;
  maxOrderQuantity: number;
  description?: string;
  image?: string;
  images?: string[];
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
  sales?: number;
  revenue?: number;
  preparationTimeHours?: number;
  availableDays?: number[];
  hasTaxes?: boolean;
  // Mode de taxe : "both" (TPS+TVQ) | "gst_only" (TPS seule) | "none" (aucune).
  // Remplace l'ancienne case oui/non `hasTaxes` (conservée en miroir).
  taxMode?: "both" | "gst_only" | "none";
  allergens?: string;
  productionType: "patisserie" | "cuisinier" | "four";
  targetAudience: "clients" | "pro";
  customOptions?: Array<{
    name: string;
    type?: "choice" | "text";
    choices: string[];
  }>;
  recommendations?: number[]; // IDs des produits recommandés
  displayOrder?: number;
}

const productSchema = new Schema<IProduct>({
  id: { type: Number, required: true, unique: true },
  name: { type: String, required: true },
  category: {
    type: [String],
    required: true,
    set: (value: unknown) => {
      if (Array.isArray(value)) {
        return value.map((v) => String(v).trim()).filter(Boolean);
      }
      if (typeof value === "string") {
        const trimmed = value.trim();
        return trimmed ? [trimmed] : [];
      }
      return [];
    },
    validate: {
      validator: (value: unknown) => Array.isArray(value) && value.length > 0,
      message: "Category must have at least one value",
    },
  },
  price: { type: Number, required: true },
  discountPercentage: { type: Number, min: 0, max: 100, default: 0 },
  available: { type: Boolean, required: true, default: true },
  minOrderQuantity: { type: Number, required: true, default: 1 },
  maxOrderQuantity: { type: Number, required: true, default: 10 },
  description: { type: String },
  image: { type: String },
  images: [{ type: String }],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  deletedAt: { type: Date, index: true },
  sales: { type: Number, default: 0 },
  revenue: { type: Number, default: 0 },
  preparationTimeHours: { type: Number },
  availableDays: [{ type: Number, min: 0, max: 6 }],
  hasTaxes: { type: Boolean, default: true },
  taxMode: {
    type: String,
    enum: ["both", "gst_only", "none"],
    default: "both",
  },
  allergens: { type: String },
  productionType: { type: String, enum: ['patisserie', 'cuisinier', 'four'], required: true },
  targetAudience: { type: String, enum: ['clients', 'pro'], required: true },
  customOptions: [{
    name: { type: String, required: true },
    type: { type: String, enum: ["choice", "text"], default: "choice" },
    choices: [{ type: String, required: true }]
  }],
  recommendations: [{ type: Number }],
  displayOrder: { type: Number, default: 0 }
});

export const Product = model<IProduct>('Product', productSchema);
