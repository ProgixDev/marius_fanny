import { authClient } from "./AuthClient";

const API_URL = import.meta.env.VITE_API_URL || (typeof window !== "undefined" ? window.location.origin : "http://localhost:3000");
const normalizedApiUrl = API_URL.startsWith("http")
  ? API_URL
  : `https://${API_URL}`;

export interface DailyInventoryEntry {
  productId: string;
  productName: string;
  stock_stdo: number;
  stdo: number;
  berri: number;
  comm_berri: number;
  client: number;
  clientManual?: number;
  total: number;
}

export interface DailyInventoryRecord {
  date: string;
  entries: DailyInventoryEntry[];
  savedBy: string | null;
  updatedAt: string | null;
}

class DailyInventoryAPI {
  private baseURL = `${normalizedApiUrl}/api/daily-inventory`;

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    retryOn401 = true,
  ): Promise<T> {
    const url = `${this.baseURL}${endpoint}`;
    const token = localStorage.getItem("bearer_token");
    const response = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
      credentials: "include",
    });

    if (response.status === 401) {
      if (retryOn401) {
        try {
          await authClient.getSession();
          return this.request<T>(endpoint, options, false);
        } catch {
          // silently ignore auth errors
        }
      }
      return undefined as any;
    }

    if (!response.ok) {
      const errorData = await response
        .json()
        .catch(() => ({ error: "Une erreur est survenue" }));
      throw new Error(
        errorData.error || errorData.message || `HTTP ${response.status}`,
      );
    }

    return response.json();
  }

  /** GET /api/daily-inventory?date=YYYY-MM-DD */
  async getByDate(date: string): Promise<{ success: boolean; data: DailyInventoryRecord }> {
    return this.request(`?date=${date}`);
  }

  /**
   * GET /api/daily-inventory/computed-client?date=YYYY-MM-DD
   * Live CLIENT-column quantities recomputed from current orders, so deleted/
   * cancelled orders no longer leave phantom numbers. Returns per-product maps
   * for the journalier and four (frais) sheets.
   */
  async getComputedClient(
    date: string,
  ): Promise<{
    success: boolean;
    data: { date: string; journalier: Record<string, number>; four: Record<string, number> };
  }> {
    return this.request(`/computed-client?date=${date}`);
  }

  /** POST /api/daily-inventory */
  async save(payload: {
    date: string;
    entries: DailyInventoryEntry[];
  }): Promise<{ success: boolean; message: string; data: DailyInventoryRecord }> {
    return this.request("", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }
}

export const dailyInventoryAPI = new DailyInventoryAPI();
