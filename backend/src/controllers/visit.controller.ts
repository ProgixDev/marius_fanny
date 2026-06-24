import { Request, Response } from "express";
import { Visit } from "../models/Visit.js";

// Date du jour en heure de Montréal, format "YYYY-MM-DD".
const montrealDate = (d = new Date()): string =>
  d.toLocaleDateString("en-CA", { timeZone: "America/Montreal" });

/**
 * POST /api/visits/track — incrémente le compteur de visites du jour.
 * Public (appelé par le site). Ne renvoie jamais d'erreur pour ne pas casser
 * le chargement du site côté visiteur.
 */
export const trackVisit = async (_req: Request, res: Response) => {
  try {
    const date = montrealDate();
    await Visit.updateOne({ date }, { $inc: { count: 1 } }, { upsert: true });
  } catch {
    /* non bloquant */
  }
  res.json({ success: true });
};

/**
 * GET /api/visits/stats — visites aujourd'hui / ce mois / mois dernier (+ %).
 * Réservé à l'admin (requireAuth sur la route).
 */
export const getVisitStats = async (_req: Request, res: Response) => {
  try {
    const today = montrealDate(); // "YYYY-MM-DD"
    const ym = today.slice(0, 7); // "YYYY-MM"
    const [y, m] = ym.split("-").map(Number);
    const prevYm = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;

    const all = await Visit.find({}).select("date count").lean();
    const sumFor = (prefix: string) =>
      all.filter((v) => v.date.startsWith(prefix)).reduce((s, v) => s + (v.count || 0), 0);

    const todayCount = all.find((v) => v.date === today)?.count || 0;
    const thisMonth = sumFor(ym);
    const lastMonth = sumFor(prevYm);
    const monthChange =
      lastMonth > 0
        ? Math.round(((thisMonth - lastMonth) / lastMonth) * 1000) / 10
        : thisMonth > 0
          ? 100
          : 0;

    res.json({
      success: true,
      data: { today: todayCount, thisMonth, lastMonth, monthChange },
    });
  } catch (error: any) {
    res
      .status(500)
      .json({ success: false, error: error?.message || "Failed to compute visit stats" });
  }
};
