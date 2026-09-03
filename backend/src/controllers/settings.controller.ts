import { Request, Response } from "express";
import { Settings } from "../models/Settings.js";
import { setTaxNumbers } from "../config/taxNumbers.js";

/**
 * GET /api/settings
 * Public - returns current site settings
 */
export async function getSettings(req: Request, res: Response) {
  let settings = await Settings.findOne();
  if (!settings) {
    settings = await Settings.create({});
  }
  // Le cache des numeros de taxes suit les reglages : les factures rendues
  // ensuite portent tout de suite les bons numeros.
  setTaxNumbers({ tps: (settings as any).tpsNumber, tvq: (settings as any).tvqNumber });
  res.json({ success: true, data: settings });
}

/**
 * PUT /api/settings
 * Admin only - update site settings
 */
export async function updateSettings(req: Request, res: Response) {
  const allowedFields = [
    "storeName",
    "contactEmail",
    "contactPhone",
    "contactPhoneMontreal",
    "address",
    "addressMontreal",
    "tpsNumber",
    "tvqNumber",
    "businessHoursLaval",
    "businessHoursMontreal",
    "emailOnNewOrder",
    "emailOnOrderConfirmed",
    "emailOnPaymentReceived",
    "emailOnOrderReady",
    "closedDates",
    "facebookUrl",
    "instagramUrl",
    "twitterUrl",
  ];

  const updateData: Record<string, any> = {};
  for (const field of allowedFields) {
    if (req.body[field] !== undefined) {
      updateData[field] = req.body[field];
    }
  }

  let settings = await Settings.findOne();
  if (!settings) {
    settings = await Settings.create(updateData);
  } else {
    Object.assign(settings, updateData);
    if (updateData.businessHoursLaval) settings.markModified("businessHoursLaval");
    if (updateData.businessHoursMontreal) settings.markModified("businessHoursMontreal");
    await settings.save();
  }

  setTaxNumbers({ tps: (settings as any).tpsNumber, tvq: (settings as any).tvqNumber });
  res.json({ success: true, data: settings, message: "Paramètres mis à jour avec succès" });
}
