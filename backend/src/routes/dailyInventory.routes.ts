import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { validateBody, validateQuery } from "../middleware/validation.js";
import {
  dailyInventoryQuerySchema,
  saveDailyInventorySchema,
} from "../schemas/dailyInventory.schema.js";
import {
  getDailyInventory,
  getInventoryComputedClient,
  saveDailyInventory,
} from "../controllers/dailyInventory.controller.js";

const router = Router();

// GET /daily-inventory/computed-client?date=YYYY-MM-DD
// Live CLIENT-column quantities recomputed from current orders.
router.get(
  "/computed-client",
  requireAuth,
  validateQuery(dailyInventoryQuerySchema),
  getInventoryComputedClient,
);

// GET /daily-inventory?date=YYYY-MM-DD
router.get(
  "/",
  requireAuth,
  validateQuery(dailyInventoryQuerySchema),
  getDailyInventory,
);

// POST /daily-inventory
router.post(
  "/",
  requireAuth,
  validateBody(saveDailyInventorySchema),
  saveDailyInventory,
);

export default router;
