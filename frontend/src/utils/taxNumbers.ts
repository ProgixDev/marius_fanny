/**
 * Numéros d'inscription aux taxes affichés sur les pages facture et soumission.
 *
 * Ils sont enregistrés dans les réglages (modifiables par un administrateur) et
 * exposés par GET /api/settings, qui est public. Les valeurs par défaut servent
 * de repli tant que la requête n'a pas répondu, pour qu'une facture ouverte ne
 * s'affiche jamais sans numéro.
 */
import { useEffect, useState } from "react";
import { API_URL } from "./api";

export const DEFAULT_TPS_NUMBER = "144652641RT001";
export const DEFAULT_TVQ_NUMBER = "1201862732TQ0001";

export interface TaxLabels {
  tps: string;
  tvq: string;
}

const buildLabels = (tps: string, tvq: string): TaxLabels => ({
  tps: `TPS (${tps})`,
  tvq: `TVQ (${tvq})`,
});

/** Intitulés « TPS (numéro) » / « TVQ (numéro) » prêts à afficher. */
export function useTaxLabels(): TaxLabels {
  const [labels, setLabels] = useState<TaxLabels>(
    buildLabels(DEFAULT_TPS_NUMBER, DEFAULT_TVQ_NUMBER),
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/settings`);
        if (!res.ok) return;
        const json = await res.json();
        const s = json?.data;
        if (!cancelled && s) {
          setLabels(
            buildLabels(
              (s.tpsNumber || "").trim() || DEFAULT_TPS_NUMBER,
              (s.tvqNumber || "").trim() || DEFAULT_TVQ_NUMBER,
            ),
          );
        }
      } catch {
        // Repli sur les valeurs par défaut : une facture s'affiche toujours.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return labels;
}
