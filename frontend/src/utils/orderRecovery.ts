/**
 * Filet de sécurité "paiement encaissé mais commande non enregistrée".
 *
 * Contexte du bug : sur la page de paiement, la carte du client est débitée
 * (Square) AVANT que la commande soit enregistrée côté serveur. Si cet
 * enregistrement échoue (coupure réseau, serveur momentanément indisponible,
 * onglet fermé…), l'argent est pris mais AUCUNE commande n'existe — le client
 * voit l'écran « Attention requise » et l'admin découvre un paiement orphelin
 * des jours plus tard.
 *
 * Ce module garantit qu'une commande payée n'est JAMAIS perdue :
 *   1. On sauvegarde la commande + le paymentId dans localStorage AVANT de
 *      tenter l'enregistrement.
 *   2. On réessaie automatiquement (backoff) : couvre les coupures passagères.
 *   3. Si tout échoue, la commande reste stockée localement et sera renvoyée
 *      automatiquement au prochain chargement du site (flushPendingOrders).
 *
 * Sécurité anti-doublon : le backend (createOrder) déduplique par squarePaymentId,
 * donc renvoyer plusieurs fois la même commande est sans danger — il renvoie la
 * commande existante au lieu d'en créer une seconde.
 */

import { authHeaders } from "./authHeaders";

const PREFIX = "mf_pending_order_";
// Au-delà de ce délai, on abandonne le renvoi automatique (la commande aura été
// traitée manuellement par le back office entre-temps). Évite un renvoi infini.
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 jours

export interface PendingOrder {
  endpoint: string; // URL complète (/api/orders ou /api/pro-orders)
  payload: any; // corps de la requête (données de la commande)
  paymentId: string; // identifiant du paiement Square (clé de dédup)
  createdAt: number; // epoch ms
}

function keyFor(paymentId: string) {
  return PREFIX + paymentId;
}

export function persistPendingOrder(o: PendingOrder): void {
  try {
    localStorage.setItem(keyFor(o.paymentId), JSON.stringify(o));
  } catch {
    /* localStorage plein / bloqué — best effort */
  }
}

export function clearPendingOrder(paymentId: string): void {
  try {
    localStorage.removeItem(keyFor(paymentId));
  } catch {
    /* ignore */
  }
}

export function listPendingOrders(): PendingOrder[] {
  const out: PendingOrder[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX)) {
        const v = localStorage.getItem(k);
        if (v) {
          try {
            const parsed = JSON.parse(v);
            if (parsed && parsed.paymentId && parsed.endpoint) out.push(parsed);
          } catch {
            /* entrée corrompue — ignore */
          }
        }
      }
    }
  } catch {
    /* ignore */
  }
  return out;
}

async function postOrder(
  endpoint: string,
  payload: any,
): Promise<{ ok: boolean; result?: any; status?: number; error?: string }> {
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: authHeaders(),
      credentials: "include",
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const result = await res.json().catch(() => ({}));
      return { ok: true, result };
    }
    const errData = await res.json().catch(() => ({}));
    return {
      ok: false,
      status: res.status,
      error: errData.error || errData.message || `HTTP ${res.status}`,
    };
  } catch (e: any) {
    // Erreur réseau (pas de réponse) → on considère comme réessayable.
    return { ok: false, status: 0, error: e?.message || "network error" };
  }
}

/**
 * Enregistre une commande PAYÉE avec réessais + persistance anti-perte.
 * Renvoie { ok:true, result } si enregistrée, sinon { ok:false, error }.
 * En cas d'échec, la commande reste dans localStorage et sera renvoyée
 * automatiquement plus tard par flushPendingOrders().
 */
export async function submitPaidOrderWithRetry(args: {
  endpoint: string;
  payload: any;
  paymentId: string;
}): Promise<{ ok: boolean; result?: any; error?: string }> {
  const { endpoint, payload, paymentId } = args;

  // 1) On sauvegarde AVANT toute tentative : si le navigateur meurt maintenant,
  //    la commande est déjà à l'abri.
  persistPendingOrder({ endpoint, payload, paymentId, createdAt: Date.now() });

  // 2) Tentatives avec backoff : 0s, 0.8s, 2s, 4s (4 essais au total).
  const backoffs = [800, 2000, 4000];
  let lastError = "échec inconnu";

  for (let attempt = 0; attempt <= backoffs.length; attempt++) {
    const r = await postOrder(endpoint, payload);
    if (r.ok) {
      clearPendingOrder(paymentId);
      return { ok: true, result: r.result };
    }
    lastError = r.error || "échec inconnu";
    // 4xx (sauf 408/429) = refus déterministe : réessayer ne changera rien.
    // On garde la commande persistée (renvoi auto plus tard / récupération
    // manuelle) et on arrête la boucle.
    const retriable =
      r.status === 0 || // erreur réseau
      r.status === undefined ||
      r.status >= 500 ||
      r.status === 408 ||
      r.status === 429;
    if (!retriable) break;
    if (attempt < backoffs.length) {
      await new Promise((res) => setTimeout(res, backoffs[attempt]));
    }
  }

  // 3) Tout a échoué — la commande reste dans localStorage (renvoi auto).
  return { ok: false, error: lastError };
}

/**
 * Renvoie silencieusement les commandes payées en attente (appelé au chargement
 * du site). Chaque succès nettoie son entrée ; les entrées trop vieilles sont
 * abandonnées. Best effort — n'interrompt jamais le chargement de l'app.
 */
export async function flushPendingOrders(): Promise<void> {
  const pending = listPendingOrders();
  if (pending.length === 0) return;

  for (const p of pending) {
    // Trop vieux → on abandonne le renvoi auto (déjà géré manuellement).
    if (typeof p.createdAt === "number" && Date.now() - p.createdAt > MAX_AGE_MS) {
      clearPendingOrder(p.paymentId);
      continue;
    }
    try {
      const r = await postOrder(p.endpoint, p.payload);
      // Succès OU refus déterministe (4xx hors 408/429) → on nettoie :
      // - succès : commande créée (ou doublon renvoyé).
      // - 4xx : le renvoi ne passera jamais, inutile d'insister éternellement ;
      //   le back office a le paiement dans Square pour traiter à la main.
      const stopRetrying =
        r.ok ||
        (r.status !== undefined &&
          r.status !== 0 &&
          r.status < 500 &&
          r.status !== 408 &&
          r.status !== 429);
      if (stopRetrying) clearPendingOrder(p.paymentId);
    } catch {
      /* on réessaiera au prochain chargement */
    }
  }
}
