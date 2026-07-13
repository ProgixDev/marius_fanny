import { Schema, model, Document } from "mongoose";

/**
 * Liste de fermeture quotidienne — une fiche par JOUR (clé `date` unique).
 * Chaque fiche est générée à partir du template (voir closing.controller.ts) et
 * garde son propre instantané des items, pour que l'historique reste fidèle même
 * si la liste change plus tard.
 */

export interface IClosingItem {
  key: string; // identifiant stable (ex. "s0i2")
  label: string;
  checked: boolean;
  checkedAt?: Date;
}

export interface IClosingSection {
  title: string;
  items: IClosingItem[];
}

export interface IClosing extends Document {
  date: string; // "YYYY-MM-DD" (Amérique/Montréal)
  sections: IClosingSection[];
  completed: boolean;
  completedBy?: string; // initiales
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ClosingItemSchema = new Schema<IClosingItem>(
  {
    key: { type: String, required: true },
    label: { type: String, required: true },
    checked: { type: Boolean, default: false },
    checkedAt: { type: Date },
  },
  { _id: false },
);

const ClosingSectionSchema = new Schema<IClosingSection>(
  {
    title: { type: String, required: true },
    items: { type: [ClosingItemSchema], default: [] },
  },
  { _id: false },
);

const ClosingSchema = new Schema<IClosing>(
  {
    date: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    sections: { type: [ClosingSectionSchema], default: [] },
    completed: { type: Boolean, default: false },
    completedBy: { type: String, trim: true, uppercase: true },
    completedAt: { type: Date },
  },
  { timestamps: true },
);

export const Closing = model<IClosing>("Closing", ClosingSchema);
export default Closing;
