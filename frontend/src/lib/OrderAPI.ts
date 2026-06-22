import { authClient } from "./AuthClient";

const API_URL = import.meta.env.VITE_API_URL || (typeof window !== "undefined" ? window.location.origin : "http://localhost:3000");
const normalizedApiUrl = API_URL.startsWith("http")
  ? API_URL
  : `https://${API_URL}`;

class OrderAPI {
  private baseURL = `${normalizedApiUrl}/api/orders`;

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

    // Capture any rotated bearer token sent back by better-auth so the
    // session stays warm and the user doesn't have to logout / login.
    const rotated = response.headers.get("set-auth-token");
    if (rotated) {
      localStorage.setItem("bearer_token", rotated);
    }

    if (response.status === 401) {
      if (retryOn401) {
        try {
          // Refresh via universal session helper (covers both cookie and
          // bearer paths and persists any new token).
          const { getSessionUniversal } = await import("../utils/getSession");
          await getSessionUniversal();
          return this.request<T>(endpoint, options, false);
        } catch {
          // fall through to error
        }
      }
      throw new Error("Session expirée — veuillez vous reconnecter");
    }

    if (!response.ok) {
      const errorData = await response
        .json()
        .catch(() => ({ error: "An error occurred" }));
      // Build a descriptive error message including validation details.
      // We surface BOTH `error` (high-level) and `message` (specific reason,
      // e.g. Mongoose validation text) so the staff sees the real cause
      // instead of just "Erreur lors de la sauvegarde de la commande".
      let msg = errorData.error || errorData.message || `HTTP ${response.status}`;
      if (errorData.message && errorData.message !== errorData.error) {
        msg = `${msg} — ${errorData.message}`;
      }
      if (Array.isArray(errorData.details) && errorData.details.length > 0) {
        const fields = errorData.details
          .map((d: any) => `${d.field || "?"}: ${d.message || d.code || ""}`.trim())
          .join(" | ");
        msg = `${msg} — ${fields}`;
      }
      throw new Error(msg);
    }

    return response.json();
  }

  /** GET /api/orders */
  async getOrders(params?: {
    page?: number;
    limit?: number;
    status?: string;
    deliveryType?: string;
    paymentStatus?: string;
  }) {
    const query = new URLSearchParams();
    if (params?.page) query.set("page", String(params.page));
    if (params?.limit) query.set("limit", String(params.limit));
    if (params?.status) query.set("status", params.status);
    if (params?.deliveryType) query.set("deliveryType", params.deliveryType);
    if (params?.paymentStatus)
      query.set("paymentStatus", params.paymentStatus);

    const qs = query.toString();
    return this.request<any>(qs ? `?${qs}` : "");
  }

  /** POST /api/orders */
  async createOrder(data: {
    clientInfo: {
      firstName: string;
      lastName: string;
      email: string;
      phone: string;
    };
    promoCode?: string;
    pickupDate?: string;
    pickupLocation: "Montreal" | "Laval";
    deliveryType: "pickup" | "delivery";
    deliveryDate?: string;
    deliveryTimeSlot?: string;
    deliveryAddress?: {
      street: string;
      city: string;
      province: string;
      postalCode: string;
    };
    items: {
      productId: number;
      productName: string;
      quantity: number;
      unitPrice: number;
      amount: number;
      selectedOptions?: Record<string, string>;
      notes?: string;
    }[];
    notes?: string;
    paymentType?: "full" | "deposit";
    paymentLinkChannel?: "email" | "sms";
    depositPaid?: boolean;
  }) {
    return this.request<any>("", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  /** PATCH /api/orders/:id */
  async updateOrder(id: string, data: Record<string, any>) {
    return this.request<any>(`/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    });
  }

  /** DELETE /api/orders/:id */
  async deleteOrder(id: string) {
    return this.request<any>(`/${id}`, {
      method: "DELETE",
    });
  }
}

export const orderAPI = new OrderAPI();
