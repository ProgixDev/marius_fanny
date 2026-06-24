import { Router } from "express";
import { trackVisit, getVisitStats } from "../controllers/visit.controller.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

// Public : enregistrer une visite du site
router.post("/track", trackVisit);

// Admin : statistiques de visites (jour / mois)
router.get("/stats", requireAuth, getVisitStats);

export default router;
