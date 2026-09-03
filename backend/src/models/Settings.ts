import mongoose, { Schema, Document } from "mongoose";
import { DEFAULT_TPS_NUMBER, DEFAULT_TVQ_NUMBER } from "../config/taxNumbers.js";

export interface ISettings extends Document {
  // General
  storeName: string;
  contactEmail: string;
  contactPhone: string;
  contactPhoneMontreal: string;
  address: string;
  addressMontreal: string;

  // Numéros d'inscription aux taxes, affichés sur les factures
  tpsNumber: string;
  tvqNumber: string;

  // Business Hours - Laval
  businessHoursLaval: {
    [key: string]: { open: string; close: string; closed: boolean };
  };

  // Business Hours - Montreal
  businessHoursMontreal: {
    [key: string]: { open: string; close: string; closed: boolean };
  };

  // Email Notifications
  emailOnNewOrder: boolean;
  emailOnOrderConfirmed: boolean;
  emailOnPaymentReceived: boolean;
  emailOnOrderReady: boolean;

  // Closed dates (store holidays — no orders allowed)
  closedDates: string[];

  // Social Media
  facebookUrl: string;
  instagramUrl: string;
  twitterUrl: string;
}

const businessHoursDaySchema = new Schema(
  {
    open: { type: String, default: "09:00" },
    close: { type: String, default: "18:00" },
    closed: { type: Boolean, default: false },
  },
  { _id: false }
);

const settingsSchema = new Schema<ISettings>(
  {
    // General
    storeName: { type: String, default: "Pâtisserie Provençale" },
    contactEmail: { type: String, default: "contact@mariusfanny.com" },
    contactPhone: { type: String, default: "450-689-0655" },
    contactPhoneMontreal: { type: String, default: "514-379-1898" },
    address: { type: String, default: "239-E Boulevard Samson, Laval" },
    addressMontreal: { type: String, default: "2006 rue St-Hubert, Montréal" },

    // Numéros d'inscription aux taxes (voir config/taxNumbers.ts)
    tpsNumber: { type: String, default: DEFAULT_TPS_NUMBER },
    tvqNumber: { type: String, default: DEFAULT_TVQ_NUMBER },

    // Business Hours - Laval
    businessHoursLaval: {
      type: Schema.Types.Mixed,
      default: {
        monday: { open: "07:00", close: "18:00", closed: false },
        tuesday: { open: "07:00", close: "18:00", closed: false },
        wednesday: { open: "07:00", close: "18:00", closed: false },
        thursday: { open: "07:00", close: "18:00", closed: false },
        friday: { open: "07:00", close: "18:30", closed: false },
        saturday: { open: "08:00", close: "18:00", closed: false },
        sunday: { open: "08:00", close: "18:00", closed: false },
      },
    },

    // Business Hours - Montreal
    businessHoursMontreal: {
      type: Schema.Types.Mixed,
      default: {
        monday: { open: "07:00", close: "17:00", closed: false },
        tuesday: { open: "07:00", close: "17:00", closed: false },
        wednesday: { open: "07:00", close: "17:00", closed: false },
        thursday: { open: "07:00", close: "17:00", closed: false },
        friday: { open: "07:00", close: "17:00", closed: false },
        saturday: { open: "08:00", close: "17:00", closed: false },
        sunday: { open: "08:00", close: "17:00", closed: false },
      },
    },

    // Email Notifications
    emailOnNewOrder: { type: Boolean, default: true },
    emailOnOrderConfirmed: { type: Boolean, default: true },
    emailOnPaymentReceived: { type: Boolean, default: true },
    emailOnOrderReady: { type: Boolean, default: true },

    // Closed dates (MM-DD format, e.g. "01-01" for January 1st)
    closedDates: {
      type: [String],
      default: ["01-01", "12-25"],
    },

    // Social Media
    facebookUrl: {
      type: String,
      default: "https://www.facebook.com/mariusetfanny/",
    },
    instagramUrl: {
      type: String,
      default: "https://www.instagram.com/patisseriemariusetfanny/",
    },
    twitterUrl: { type: String, default: "" },
  },
  { timestamps: true }
);

export const Settings = mongoose.model<ISettings>("Settings", settingsSchema);
