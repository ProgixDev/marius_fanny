import { authClient } from "./AuthClient";

const API_URL = import.meta.env.VITE_API_URL || (typeof window !== "undefined" ? window.location.origin : "http://localhost:3000");
const normalizedApiUrl = API_URL.startsWith("http")
  ? API_URL
  : `https://${API_URL}`;

export interface PromoCodeDto {
  _id: string;
  code: string;
  description?: string;
  discountPercent: number;
  appliesToProductIds?: number[];
  minSubtotal?: number;
  maxDiscountAmount?: number;
  startsAt?: string;
  endsAt?: string;
  isActive: boolean;
  deletedAt?: string;
  usageLimit?: number;
  usageLimitPerUser?: number;
  timesUsed: number;
  createdByUserId?: string;
  createdAt: string;
  updatedAt: string;
}

class PromoAPI {
  private baseURL = `${normalizedApiUrl}/api/promos`;

  private async request<T>(endpoint: string, options: RequestInit = {}, retryOn401 = true): Promise<T> {
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
        .catch(() => ({ error: "An error occurred" }));
      let message =
        errorData.message || errorData.error || `HTTP ${response.status}`;

      const details = errorData.details;
      if (Array.isArray(details) && details.length > 0) {
        const first = details[0];
        if (first?.field && first?.message) {
          message = `${message} (${first.field}: ${first.message})`;
        }
      }

      throw new Error(message);
    }

    return response.json();
  }

  /** POST /api/promos/validate */
  async validatePromo(data: {
    code: string;
    items: { productId: number; amount: number }[];
    subtotal?: number;
    email?: string;
  }) {
    return this.request<{
      success: boolean;
      data: {
        code: string;
        discountPercent: number;
        discountAmount: number;
        eligibleProductIds: number[];
        appliesToProductIds: number[] | null;
      };
    }>("/validate", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  /** GET /api/promos (admin) */
  async listPromos(params?: {
    page?: number;
    limit?: number;
    includeInactive?: boolean;
    includeDeleted?: boolean;
    q?: string;
  }) {
    const query = new URLSearchParams();
    if (params?.page) query.set("page", String(params.page));
    if (params?.limit) query.set("limit", String(params.limit));
    // Don't send "false" because backend uses boolean coercion and "false" becomes true.
    if (params?.includeInactive === true) query.set("includeInactive", "true");
    if (params?.includeDeleted === true) query.set("includeDeleted", "true");
    if (params?.q) query.set("q", params.q);

    const qs = query.toString();
    return this.request<{
      success: boolean;
      data: {
        promos: PromoCodeDto[];
        pagination: { page: number; limit: number; total: number; totalPages: number };
      };
    }>(qs ? `?${qs}` : "");
  }

  /** POST /api/promos (admin) */
  async createPromo(data: {
    code: string;
    description?: string;
    discountPercent: number;
    appliesToProductIds?: number[];
    startsAt?: string;
    endsAt?: string;
    usageLimit?: number;
    usageLimitPerUser?: number;
    isActive?: boolean;
    minSubtotal?: number;
    maxDiscountAmount?: number;
  }) {
    return this.request<{ success: boolean; data: PromoCodeDto }>("", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  /** PUT /api/promos/:id (admin) */
  async updatePromo(id: string, data: Record<string, any>) {
    return this.request<{ success: boolean; data: PromoCodeDto }>(`/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  }

  /** DELETE /api/promos/:id (admin) */
  async deletePromo(id: string) {
    return this.request<{ success: boolean; message?: string }>(`/${id}`, {
      method: "DELETE",
    });
  }
}

export const promoAPI = new PromoAPI();
