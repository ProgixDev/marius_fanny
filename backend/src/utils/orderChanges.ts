/**
 * Comparaison des articles d'une commande — logique PURE et testable.
 *
 * Pourquoi : l'historique consignait une ligne « Produits modifiés » dès que la
 * requête contenait une clé `items`, SANS jamais comparer quoi que ce soit.
 * Or cocher une case « emballé » renvoie tout le tableau d'articles. Résultat
 * mesuré en production : 1427 entrées, dont 1369 (96 %) ne consignaient aucun
 * changement — et chacune stocke une copie complète des articles, ce qui gonfle
 * la commande et alourdit toutes les lectures.
 */

export interface ComparableItem {
  productName: string;
  quantity: number;
  unitPrice: number;
  selectedOptions?: Record<string, string>;
}

/**
 * Regroupe les articles par produit + options choisies.
 * `productionStatus` est volontairement ignoré : c'est l'avancement de
 * l'emballage, pas le contenu de la commande.
 */
function tallyItems(items: ComparableItem[] | undefined) {
  const map = new Map<string, { label: string; quantity: number; unitPrice: number }>();
  for (const it of items || []) {
    const options = it.selectedOptions
      ? Object.entries(it.selectedOptions)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => `${k}: ${v}`)
          .join(", ")
      : "";
    const key = `${it.productName}||${options}`;
    const label = options ? `${it.productName} (${options})` : it.productName;
    const entry = map.get(key);
    if (entry) {
      entry.quantity += it.quantity;
    } else {
      map.set(key, { label, quantity: it.quantity, unitPrice: it.unitPrice });
    }
  }
  return map;
}

/**
 * Décrit en français ce qui a changé dans les articles. Liste vide = rien n'a
 * bougé, donc rien à consigner ni à annoncer au client.
 */
export function describeItemChanges(
  before: ComparableItem[] | undefined,
  after: ComparableItem[] | undefined,
): string[] {
  const lines: string[] = [];
  const oldItems = tallyItems(before);
  const newItems = tallyItems(after);

  for (const [key, next] of newItems) {
    const prev = oldItems.get(key);
    if (!prev) {
      lines.push(`Ajouté : ${next.quantity} × ${next.label}`);
    } else if (prev.quantity !== next.quantity) {
      lines.push(`${next.label} : ${prev.quantity} → ${next.quantity}`);
    } else if (Math.abs((prev.unitPrice || 0) - (next.unitPrice || 0)) > 0.001) {
      lines.push(
        `${next.label} : prix unitaire ${(prev.unitPrice || 0).toFixed(2)}$ → ${(next.unitPrice || 0).toFixed(2)}$`,
      );
    }
  }
  for (const [key, prev] of oldItems) {
    if (!newItems.has(key)) {
      lines.push(`Retiré : ${prev.quantity} × ${prev.label}`);
    }
  }

  return lines;
}

/**
 * Faut-il inscrire une entrée « Produits modifiés » dans l'historique ?
 * Oui seulement si le contenu a réellement bougé, ou si le total a changé
 * (remise, frais de livraison… sans que les articles varient).
 */
export function shouldRecordItemChange(
  before: ComparableItem[] | undefined,
  after: ComparableItem[] | undefined,
  previousTotal: number,
  newTotal: number,
): boolean {
  if (Math.abs((newTotal || 0) - (previousTotal || 0)) > 0.001) return true;
  return describeItemChanges(before, after).length > 0;
}
