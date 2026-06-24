import { Schema, model } from "mongoose";

// Un document par jour (date Montréal "YYYY-MM-DD") avec le nombre de visites.
// Le total mensuel se calcule en sommant les jours du mois.
export interface IVisit {
  date: string; // "YYYY-MM-DD" (heure de Montréal)
  count: number;
  createdAt: Date;
  updatedAt: Date;
}

const VisitSchema = new Schema<IVisit>(
  {
    date: { type: String, required: true, unique: true, index: true },
    count: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export const Visit = model<IVisit>("Visit", VisitSchema);
