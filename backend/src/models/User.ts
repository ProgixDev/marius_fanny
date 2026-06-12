import mongoose, { Schema, Document } from "mongoose";

export interface IUser extends Document {
  email: string;
  name: string;
  role: "user" | "pro" | "staff" | "customerService" | "admin" | "deliveryDriver" | "cuisinier" | "patissier" | "four" | "vendeur";
  status?: "active" | "inactive" | "placeholder";
  isDeleted?: boolean;
  deletedAt?: Date;
  password?: string;
  emailVerified: boolean;
  emailVerificationCode?: string;
  emailVerificationExpires?: Date;
  profile?: {
    bio?: string;
    avatar?: string;
    phoneNumber?: string;
  };
  billing?: {
    kind: "standard" | "representant" | "gouvernement";
    organization?: string;
    invoiceEmail?: string;
    paymentTermsDays: number; // 0 = same day, 30 = net 30, etc.
    allowUnpaidOrders: boolean;
  };
  createdAt: Date;
  updatedAt: Date;
  resetPasswordToken?: string;
  resetPasswordExpires?: Date;
}

const UserSchema = new Schema<IUser>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    role: {
      type: String,
      enum: ["user", "pro", "staff", "customerService", "admin", "deliveryDriver", "cuisinier", "patissier", "four", "vendeur"],
      default: "user",
    },
    status: {
      type: String,
      enum: ["active", "inactive", "placeholder"],
      default: "active",
    },
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
    deletedAt: {
      type: Date,
    },
    emailVerified: {
      type: Boolean,
      default: false,
    },
    emailVerificationCode: {
      type: String,
      select: false,
    },
    emailVerificationExpires: {
      type: Date,
      select: false,
    },
    profile: {
      bio: String,
      avatar: String,
      phoneNumber: String,
    },
    billing: {
      kind: {
        type: String,
        enum: ["standard", "representant", "gouvernement"],
        default: "standard",
      },
      organization: {
        type: String,
        trim: true,
      },
      // For government clients: default 2nd email (city accounts-payable) that
      // receives the invoice/facture. Can be overridden per order.
      invoiceEmail: {
        type: String,
        trim: true,
        lowercase: true,
      },
      paymentTermsDays: {
        type: Number,
        default: 0,
        min: 0,
        max: 365,
      },
      allowUnpaidOrders: {
        type: Boolean,
        default: false,
      },
    },
    resetPasswordToken: {
      type: String,
      select: false,
    },
    resetPasswordExpires: {
      type: Date,
      select: false,
    },
  },
  {
    timestamps: true,
    collection: "user",
  },
);

UserSchema.methods.toJSON = function () {
  const user = this.toObject();
  delete user.__v;
  return user;
};

export const User = mongoose.model<IUser>("User", UserSchema);
