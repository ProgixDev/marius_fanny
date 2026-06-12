/**
 * Headers that authenticate via BOTH the session cookie and the bearer token.
 *
 * The frontend and backend live on different domains, so the auth cookie is a
 * cross-site cookie. Safari / iPad (and many in-app browsers) block cross-site
 * cookies via ITP, so cookie-only requests fail there with 401/403 ("vous
 * n'êtes pas autorisé"). The bearer token (saved in localStorage at login) is
 * read by the backend middleware and keeps requests working when cookies are
 * blocked. Always pair these headers with `credentials: "include"`.
 *
 * Usage:
 *   fetch(url, { method: "POST", headers: authHeaders(), credentials: "include", body });
 *   fetch(url, { headers: authHeaders(), credentials: "include" }); // GET
 */
export function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const token =
    typeof localStorage !== "undefined" ? localStorage.getItem("bearer_token") : null;
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(extra || {}),
  };
}

/**
 * Bearer-only header (no Content-Type) for multipart/form-data uploads, where
 * the browser must set the multipart boundary itself. Pair with
 * `credentials: "include"`.
 */
export function bearerHeader(): Record<string, string> {
  const token =
    typeof localStorage !== "undefined" ? localStorage.getItem("bearer_token") : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}
