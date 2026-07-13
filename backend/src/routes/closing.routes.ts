import { Router } from "express";
import {
  getTodayClosing,
  toggleTodayItem,
  completeTodayClosing,
  getClosingByDate,
  getRecentClosings,
} from "../controllers/closing.controller.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

// Fiche du jour (vendeuse) — récupérer / cocher / terminer.
router.get("/today", requireAuth, getTodayClosing);
router.patch("/today/item", requireAuth, toggleTodayItem);
router.post("/today/complete", requireAuth, completeTodayClosing);

// Historique (admin / Fanny) — n'importe quelle date + liste récente.
router.get("/history", requireAuth, getClosingByDate);
router.get("/recent", requireAuth, getRecentClosings);

export default router;
