import { Router } from "express";
import { handleBrevoWebhook } from "../controllers/brevoWebhook.controller.js";

const router = Router();

// Webhook Brevo (public — protégé par un jeton ?token= dans l'URL).
// Reçoit les rebonds / adresses invalides pour signaler les commandes.
router.post("/brevo-webhook", handleBrevoWebhook);

export default router;
