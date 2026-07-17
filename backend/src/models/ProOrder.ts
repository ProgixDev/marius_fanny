import mongoose, { Schema, Document } from "mongoose";

export interface IProAddress {
  street: string;
  city: string;
  province: string;
  postalCode: string;
  contactPhone?: string;
  details?: string;
}

export interface IProOrderItem {
  productId: number;
  productName: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  notes?: string;
  selectedOptions?: Record<string, string>;
}

export interface IProClientInfo {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

export interface IProOrder extends Document {
  orderNumber: string;
  userId: string;
  clientInfo: IProClientInfo;
  orderDate: Date;
  pickupDate?: Date;
  pickupLocation: "Montreal" | "Laval";
  deliveryType: "pickup" | "delivery";
  deliveryDate?: string;
  deliveryTimeSlot?: string;
  deliveryAddress?: IProAddress;
  deliveryDistanceTier?: "lt20" | "gt20";
  items: IProOrderItem[];
  subtotal: number;
  taxAmount: number;
  tpsAmount?: number;
  tvqAmount?: number;
  deliveryFee: number;
  total: number;
  notes?: string;
  status: "submitted" | "cancelled";
  adminNotifiedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ProAddressSchema = new Schema<IProAddress>(
  {
    street: { type: String, required: true, trim: true },
    city: { type: String, required: true, trim: true },
    province: { type: String, required: true, trim: true, uppercase: true },
    postalCode: { type: String, required: true, trim: true, uppercase: true },
    contactPhone: { type: String, trim: true },
    details: { type: String, trim: true },
  },
  { _id: false },
);

const ProOrderItemSchema = new Schema<IProOrderItem>(
  {
    productId: { type: Number, required: true },
    productName: { type: String, required: true, trim: true },
    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
    amount: { type: Number, required: true, min: 0 },
    notes: { type: String, trim: true },
    selectedOptions: { type: Schema.Types.Mixed, default: undefined },
  },
  { _id: false },
);

const ProClientInfoSchema = new Schema<IProClientInfo>(
  {
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    phone: { type: String, required: true, trim: true },
  },
  { _id: false },
);

const ProOrderSchema = new Schema<IProOrder>(
  {
    orderNumber: { type: String, required: true, unique: true, trim: true },
    userId: { type: String, required: true, index: true },
    clientInfo: { type: ProClientInfoSchema, required: true },
    orderDate: { type: Date, default: Date.now, index: true },
    pickupDate: { type: Date, index: true },
    pickupLocation: {
      type: String,
      enum: ["Montreal", "Laval"],
      required: true,
    },
    deliveryType: {
      type: String,
      enum: ["pickup", "delivery"],
      required: true,
      index: true,
    },
    deliveryDate: { type: String, trim: true },
    deliveryTimeSlot: { type: String, trim: true },
    deliveryAddress: { type: ProAddressSchema },
    deliveryDistanceTier: { type: String, enum: ["lt20", "gt20"] },
    items: { type: [ProOrderItemSchema], required: true },
    subtotal: { type: Number, required: true, min: 0 },
    taxAmount: { type: Number, required: true, min: 0 },
    tpsAmount: { type: Number, default: 0, min: 0 },
    tvqAmount: { type: Number, default: 0, min: 0 },
    deliveryFee: { type: Number, required: true, min: 0 },
    total: { type: Number, required: true, min: 0 },
    notes: { type: String, trim: true },
    status: { type: String, enum: ["submitted", "cancelled"], default: "submitted" },
    adminNotifiedAt: { type: Date },
  },
  { timestamps: true },
);

const ProOrder =
  mongoose.models.ProOrder || mongoose.model<IProOrder>("ProOrder", ProOrderSchema);

export default ProOrder;

