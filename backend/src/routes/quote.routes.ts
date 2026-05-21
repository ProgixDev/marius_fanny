import { Router } from "express";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import {
  createQuote,
  listQuotes,
  getQuote,
  updateQuote,
  cancelQuote,
  hardDeleteQuote,
  acceptQuote,
  refuseQuote,
} from "../controllers/quote.controller.js";

const router = Router();

// Public endpoints (client accepts/refuses via email link)
router.get("/:id/public", asyncHandler(getQuote));
router.post("/:id/accept", asyncHandler(acceptQuote));
router.post("/:id/refuse", asyncHandler(refuseQuote));

// Admin endpoints
router.get("/", requireAuth, requireAdmin, asyncHandler(listQuotes));
router.post("/", requireAuth, requireAdmin, asyncHandler(createQuote));
router.get("/:id", requireAuth, requireAdmin, asyncHandler(getQuote));
router.patch("/:id", requireAuth, requireAdmin, asyncHandler(updateQuote));
router.delete("/:id", requireAuth, requireAdmin, asyncHandler(cancelQuote));
router.delete("/:id/hard", requireAuth, requireAdmin, asyncHandler(hardDeleteQuote));

export default router;
