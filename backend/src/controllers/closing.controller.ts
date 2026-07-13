import { Request, Response } from "express";
import Closing from "../models/Closing.js";

/**
 * Template de la liste de fermeture (fourni par Fanny). Chaque jour, une fiche
 * est générée à partir de ce template. Pour modifier la liste, il suffit d'éditer
 * ce tableau (les fiches déjà créées gardent leur propre instantané).
 */
const CLOSING_TEMPLATE: { title: string; items: string[] }[] = [
  {
    title: "Traiteur",
    items: [
      "Éteindre le four",
      "Éteindre la soupe, la ranger dans le frigo",
      "Éteindre le lave-vaisselle",
      "Laver la planche à découper et couteaux",
      "Faire toute la vaisselle et la ranger",
      "Fermer et ranger les salades et sandwichs à partir de 17:30",
      "Vérifier le micro-onde et laver",
    ],
  },
  {
    title: "Café",
    items: [
      "Vider le café filtre et laver",
      "Vider les mousseurs à lait et laver",
      "Laver la machine espresso",
      "Remplir le frigo à lait",
      "Jeter la poubelle à marc de café",
    ],
  },
  {
    title: "Viennoiserie (à 18:00)",
    items: [
      "Faire les TGTG",
      "Ranger les viennoiseries qu'on garde",
      "Laver la surface en marbre",
      "Ne pas laisser de miette sur la tablette vitrée",
    ],
  },
  {
    title: "Pain (à 18:00)",
    items: [
      "Faire l'inventaire",
      "Mettre les pains dans un sac au traiteur",
      "Laver la surface en marbre",
      "Ne pas laisser de miette sur la tablette vitrée",
    ],
  },
  {
    title: "Pâtisserie / Gâteau",
    items: [
      "Remplir les gâteaux et pâtisseries",
      "S'assurer qu'il n'y en a plus derrière",
    ],
  },
  {
    title: "Magasin",
    items: [
      "Nettoyer les tables et replacer la salle à manger",
      "Fermer les rideaux transparents des frigos",
      "Ranger la desserte (lait, crème, eau)",
      "Passer le balai la fin de semaine",
      "Couvrir les chocolats",
      "Fermer la terrasse à partir de 17:30",
      "Ne pas laisser de miettes sur les comptoirs",
      "Amener les torchons dans le bac salle",
      "Faire inventaire frais, journalier",
      "Compter la caisse",
      "Barrer les portes, vérifier que c'est bien barré",
      "Bien fermer la porte arrière quand on sort",
    ],
  },
];

const todayMontreal = (): string =>
  new Date().toLocaleDateString("en-CA", { timeZone: "America/Montreal" });

const buildFromTemplate = () =>
  CLOSING_TEMPLATE.map((section, si) => ({
    title: section.title,
    items: section.items.map((label, ii) => ({
      key: `s${si}i${ii}`,
      label,
      checked: false,
    })),
  }));

/** Récupère (ou crée) la fiche de fermeture du JOUR. */
export async function getTodayClosing(_req: Request, res: Response) {
  try {
    const date = todayMontreal();
    let closing = await Closing.findOne({ date });
    if (!closing) {
      closing = await Closing.create({ date, sections: buildFromTemplate() });
    }
    return res.json({ success: true, data: closing });
  } catch (error: any) {
    console.error("getTodayClosing error:", error);
    return res.status(500).json({ success: false, error: error?.message });
  }
}

/** Coche / décoche un item de la fiche du jour. */
export async function toggleTodayItem(req: Request, res: Response) {
  try {
    const { key, checked } = req.body as { key?: string; checked?: boolean };
    if (!key) return res.status(400).json({ success: false, error: "key requis" });

    const date = todayMontreal();
    const closing = await Closing.findOne({ date });
    if (!closing) {
      return res.status(404).json({ success: false, error: "Aucune fiche du jour" });
    }
    if (closing.completed) {
      return res.status(409).json({
        success: false,
        error: "La fermeture est déjà terminée et verrouillée.",
      });
    }

    let found = false;
    for (const section of closing.sections) {
      const item = section.items.find((it) => it.key === key);
      if (item) {
        item.checked = !!checked;
        item.checkedAt = checked ? new Date() : undefined;
        found = true;
        break;
      }
    }
    if (!found) return res.status(404).json({ success: false, error: "Item introuvable" });

    await closing.save();
    return res.json({ success: true, data: closing });
  } catch (error: any) {
    console.error("toggleTodayItem error:", error);
    return res.status(500).json({ success: false, error: error?.message });
  }
}

/** Termine la fermeture du jour — TOUT doit être coché + initiales obligatoires. */
export async function completeTodayClosing(req: Request, res: Response) {
  try {
    const initials = String((req.body?.initials || "")).trim().toUpperCase();
    if (!initials) {
      return res.status(400).json({ success: false, error: "Les initiales sont obligatoires." });
    }

    const date = todayMontreal();
    const closing = await Closing.findOne({ date });
    if (!closing) {
      return res.status(404).json({ success: false, error: "Aucune fiche du jour" });
    }
    if (closing.completed) {
      return res.json({ success: true, data: closing });
    }

    const allChecked = closing.sections.every((s) =>
      s.items.every((it) => it.checked),
    );
    if (!allChecked) {
      return res.status(400).json({
        success: false,
        error: "Toutes les tâches doivent être cochées avant de terminer la fermeture.",
      });
    }

    closing.completed = true;
    closing.completedBy = initials;
    closing.completedAt = new Date();
    await closing.save();
    return res.json({ success: true, data: closing });
  } catch (error: any) {
    console.error("completeTodayClosing error:", error);
    return res.status(500).json({ success: false, error: error?.message });
  }
}

/** [Historique] Fiche d'une date précise (lecture seule). */
export async function getClosingByDate(req: Request, res: Response) {
  try {
    const date = String(req.query.date || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ success: false, error: "date invalide (YYYY-MM-DD)" });
    }
    const closing = await Closing.findOne({ date });
    return res.json({ success: true, data: closing, exists: !!closing });
  } catch (error: any) {
    console.error("getClosingByDate error:", error);
    return res.status(500).json({ success: false, error: error?.message });
  }
}

/** [Historique] Liste des dernières fermetures (pour navigation admin). */
export async function getRecentClosings(req: Request, res: Response) {
  try {
    const limit = Math.min(90, Math.max(1, Number(req.query.limit) || 30));
    const closings = await Closing.find({})
      .sort({ date: -1 })
      .limit(limit)
      .select("date completed completedBy completedAt")
      .lean();
    return res.json({ success: true, data: closings });
  } catch (error: any) {
    console.error("getRecentClosings error:", error);
    return res.status(500).json({ success: false, error: error?.message });
  }
}
