/**
 * Central error-to-French translator.
 *
 * Backend/API errors arrive as raw technical strings ("Forbidden",
 * "Unauthorized", "Failed to fetch", "HTTP 500", ...). Showing those to a user
 * in an alert ("localhost says: Forbidden") looks broken and scary. This maps
 * the known technical categories to clear, friendly French. Anything that is
 * already a specific French message is passed through unchanged.
 *
 * Usage:
 *   try { ... } catch (err) { alert(getErrorMessage(err)); }
 *   setError(getErrorMessage(err));
 */

const DEFAULT_FALLBACK =
  "Une erreur s'est produite. Veuillez réessayer dans un instant.";

function extractRaw(err: unknown): { text: string; status?: number } {
  if (err == null) return { text: "" };
  if (typeof err === "string") return { text: err };
  const anyErr = err as any;
  const status =
    typeof anyErr.status === "number"
      ? anyErr.status
      : typeof anyErr.statusCode === "number"
        ? anyErr.statusCode
        : undefined;
  const text = String(anyErr.message ?? anyErr.error ?? "");
  return { text, status };
}

const has = (s: string, ...needles: string[]) =>
  needles.some((n) => s.includes(n));

/**
 * Translate any error into a clear, user-facing French message.
 * @param err      The caught error (Error, string, or API error object).
 * @param fallback Message to use when the error is generic/technical with no
 *                 useful detail. Defaults to a polite "try again" message.
 */
export function getErrorMessage(
  err: unknown,
  fallback: string = DEFAULT_FALLBACK,
): string {
  const { text, status } = extractRaw(err);
  const s = text.toLowerCase().trim();

  // ── Network / connectivity ────────────────────────────────────────────────
  if (
    has(s, "failed to fetch", "networkerror", "network error", "load failed", "err_internet", "err_network", "fetch failed")
  ) {
    return "Problème de connexion. Vérifiez votre internet et réessayez.";
  }

  // ── Permission (403) ──────────────────────────────────────────────────────
  if (
    status === 403 ||
    has(s, "forbidden", "insufficient permissions", "minimum role required", "access denied", "acces denied")
  ) {
    return "Vous n'avez pas l'autorisation d'effectuer cette action.";
  }

  // ── Session / authentication (401) ────────────────────────────────────────
  if (
    status === 401 ||
    has(s, "unauthorized", "authentication required", "invalid or expired session", "auth not initialized", "not authenticated")
  ) {
    return "Votre session a expiré. Veuillez vous reconnecter, puis réessayer.";
  }

  // ── Server errors (5xx) ───────────────────────────────────────────────────
  if (
    status === 500 || status === 502 || status === 503 || status === 504 ||
    has(s, "internal server error") ||
    /\bhttp 5\d\d\b/.test(s)
  ) {
    return "Une erreur s'est produite de notre côté. Réessayez dans un instant.";
  }

  // ── Generic English "not found" (keep specific French "introuvable") ──────
  if (status === 404 || /\bhttp 404\b/.test(s) || s === "not found") {
    return "Élément introuvable. Il a peut-être été supprimé ou modifié.";
  }

  // ── Bare HTTP codes / empty / generic with no useful detail → fallback ────
  if (
    s === "" ||
    s === "request failed" ||
    s === "bad request" ||
    /^http \d+$/.test(s) ||
    s === "error"
  ) {
    return fallback;
  }

  // ── Otherwise: it's already a specific (usually French) message → show it ──
  return text;
}
