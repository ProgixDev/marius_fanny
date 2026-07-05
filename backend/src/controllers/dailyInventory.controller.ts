import { Request, Response } from "express";
import type { ApiResponse } from "../types/api.js";
import { DailyInventory } from "../models/DailyInventory.js";
import Order from "../models/Order.js";
import {
  computeInventoryBuckets,
  JOURNALIER_PRODUCTS,
  FOUR_PRODUCTS,
} from "../utils/inventoryBuckets.js";
import type { SaveDailyInventoryInput } from "../schemas/dailyInventory.schema.js";

// Sentinel "dates" under which the editable product lists are persisted (set by
// the InventaireJournalier / InventaireFour screens). Kept in sync with
// PRODUCTS_SENTINEL_KEY in those frontend components.
const JOURNALIER_LIST_KEY = "__products_config_daily";
const FOUR_LIST_KEY = "__products_config_four";

/**
 * Load the LIVE editable product lists (the names Fanny maintains on screen).
 * Falls back to the hardcoded defaults when a list hasn't been saved yet, so
 * matching keeps working on a fresh database. Shared by the order-creation
 * inventory update and the CLIENT-column recompute so both bucket identically.
 */
export async function loadInventoryLists(): Promise<{
  journalier: string[];
  four: string[];
}> {
  const [dailyCfg, fourCfg] = await Promise.all([
    DailyInventory.findOne({ date: JOURNALIER_LIST_KEY }).lean(),
    DailyInventory.findOne({ date: FOUR_LIST_KEY }).lean(),
  ]);
  const namesOf = (rec: any, fallback: string[]): string[] => {
    const names = (rec?.entries ?? [])
      .map((e: any) => e?.productName)
      .filter((n: any): n is string => typeof n === "string" && n.trim().length > 0);
    return names.length > 0 ? names : fallback;
  };
  return {
    journalier: namesOf(dailyCfg, JOURNALIER_PRODUCTS),
    four: namesOf(fourCfg, FOUR_PRODUCTS),
  };
}

/**
 * GET /daily-inventory?date=YYYY-MM-DD
 * Returns the daily inventory record for the given date, or empty entries if none exists.
 */
export const getDailyInventory = async (
  req: Request,
  res: Response<ApiResponse>,
) => {
  const { date } = req.query as { date: string };

  const record = await DailyInventory.findOne({ date }).lean();

  res.json({
    success: true,
    data: {
      date,
      entries: record?.entries ?? [],
      savedBy: record?.savedBy ?? null,
      updatedAt: record?.updatedAt ?? null,
    },
  });
};

/**
 * GET /daily-inventory/computed-client?date=YYYY-MM-DD
 * Recomputes the "Comm CLIENT" column LIVE from the real (non-cancelled) orders
 * for that date, using the shared bucketing logic. Returns {journalier, four}
 * maps of { productName: quantity }. The frontend overlays these onto the rows
 * so the CLIENT column always reflects current orders — deleted/cancelled
 * orders simply no longer count, so there are no phantom numbers.
 */
export const getInventoryComputedClient = async (
  req: Request,
  res: Response<ApiResponse>,
) => {
  const { date } = req.query as { date: string };

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res
      .status(400)
      .json({ success: false, error: "Date invalide (format YYYY-MM-DD requis)" });
  }

  // Mirror createOrder's inventory-date rule: pickupDate, else deliveryDate,
  // else the order's creation date.
  const inventoryDateOf = (o: any): string | null => {
    const d = o.pickupDate || o.deliveryDate || o.orderDate || o.createdAt;
    return d ? new Date(d).toISOString().split("T")[0] : null;
  };

  const dayMs = 24 * 60 * 60 * 1000;
  const start = new Date(`${date}T00:00:00.000Z`).getTime();
  const lo = new Date(start - dayMs);
  const hi = new Date(start + 2 * dayMs);

  // Cancelled orders are excluded (won't be produced). Deleted orders are gone
  // from the DB entirely, so they naturally don't count.
  const candidates = await Order.find({
    status: { $ne: "cancelled" },
    $or: [
      { pickupDate: { $gte: lo, $lt: hi } },
      { deliveryDate: date },
      { createdAt: { $gte: lo, $lt: hi } },
    ],
  })
    .select("items pickupDate deliveryDate orderDate createdAt")
    .lean();

  const items: { productName?: string; quantity?: number }[] = [];
  for (const o of candidates as any[]) {
    if (inventoryDateOf(o) !== date) continue;
    for (const it of (o.items as any[]) || []) {
      items.push({ productName: it?.productName, quantity: it?.quantity });
    }
  }

  // Bucket against the LIVE editable lists so renamed rows catch their orders.
  const { journalier: journalierList, four: fourList } = await loadInventoryLists();
  const { journalierQty, fourQty } = computeInventoryBuckets(items, journalierList, fourList);

  res.json({
    success: true,
    data: { date, journalier: journalierQty, four: fourQty },
  });
};

/**
 * POST /daily-inventory
 * Upserts (create or replace) the daily inventory for a given date.
 * The total for each entry is recalculated server-side to prevent tampering.
 */
export const saveDailyInventory = async (
  req: Request<unknown, ApiResponse, SaveDailyInventoryInput>,
  res: Response<ApiResponse>,
) => {
  const { date, entries } = req.body;

  // Recalculate totals server-side based on inventory type
  // - Daily inventory (journalier): total = stdo + client
  // - Four inventory (date contains "__four"): total = stdo + comm_berri + client
  const isFourInventory = date.includes("__four");

  // Normalize a value: keep strings as-is (for SUPPLÉMENT row), convert numbers to non-negative
  const normalize = (value: any): number | string => {
    if (typeof value === "string") return value;
    return Math.max(0, Number(value) || 0);
  };
  const numOnly = (value: any): number => {
    if (typeof value === "string") return 0;
    return Math.max(0, Number(value) || 0);
  };

  // Produits dont la colonne "Comm Berri" DOIT s'additionner au total de
  // l'inventaire JOURNALIER (organisation interne). Par défaut, "Comm Berri"
  // n'entre pas dans le total journalier. Doit rester synchronisé avec le
  // frontend (InventaireJournalier.tsx).
  const matchName = (s: any): string =>
    String(s || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .trim()
      .replace(/\s+/g, " ");
  const BERRI_DANS_TOTAL_JOURNALIER = new Set(
    ["Frangipane", "Tropezienne", "Tropezienne fraise", "Croque végé"].map(matchName),
  );

  const sanitizedEntries = (entries as any[]).map((entry) => {
    const commBerriJournalier = BERRI_DANS_TOTAL_JOURNALIER.has(matchName(entry.productName))
      ? numOnly(entry.comm_berri)
      : 0;
    return {
      ...entry,
      stock_stdo: normalize(entry.stock_stdo),
      stdo: normalize(entry.stdo),
      berri: normalize(entry.berri),
      comm_berri: normalize(entry.comm_berri),
      client: normalize(entry.client),
      // Ajout manuel de Fanny (delta au-dessus du calcul auto). Peut être négatif
      // (si elle saisit un total inférieur au compte auto) → pas de clamp à 0.
      clientManual: Number(entry.clientManual) || 0,
      total: isFourInventory
        ? numOnly(entry.stdo) + numOnly(entry.comm_berri) + numOnly(entry.client)
        : numOnly(entry.stdo) + numOnly(entry.client) + commBerriJournalier,
    };
  });

  // @ts-ignore – user injected by requireAuth middleware
  const savedBy: string | undefined = req.user?.email ?? req.user?.id ?? undefined;

  const record = await DailyInventory.findOneAndUpdate(
    { date },
    { date, entries: sanitizedEntries, savedBy },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  res.json({
    success: true,
    message: `Inventaire du ${date} sauvegardé avec succès.`,
    data: {
      date: record.date,
      entries: record.entries,
      savedBy: record.savedBy,
      updatedAt: record.updatedAt,
    },
  });
};
