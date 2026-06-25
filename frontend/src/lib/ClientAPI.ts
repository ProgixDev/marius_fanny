import { API_URL } from "../utils/api";
import { authClient } from "./AuthClient";

console.log("ClientAPI using base URL:", API_URL);

export interface Client {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  status: "active" | "inactive" | "placeholder";
  billing?: {
    kind: "standard" | "representant" | "gouvernement";
    organization?: string;
    invoiceEmail?: string;
    paymentTermsDays: number;
    allowUnpaidOrders: boolean;
  };
  createdAt: string;
  updatedAt: string;
  addresses: Array<{
    id: number;
    type: "billing" | "shipping";
    street: string;
    city: string;
    province: string;
    postalCode: string;
    isDefault: boolean;
  }>;
  orders: any[];
}

export interface CreateClientData {
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  status?: "active" | "inactive" | "placeholder";
  billing?: {
    kind?: "standard" | "representant" | "gouvernement";
    organization?: string;
    invoiceEmail?: string;
    paymentTermsDays?: number;
    allowUnpaidOrders?: boolean;
  };
}

class ClientAPI {
  private baseUrl = `${API_URL}/api/users`;

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const token = localStorage.getItem("bearer_token");
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });

    if (response.status === 401) {
      try {
        await authClient.getSession();
        const retryToken = localStorage.getItem("bearer_token");
        const retryResponse = await fetch(`${this.baseUrl}${endpoint}`, {
          ...options,
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            ...(retryToken ? { Authorization: `Bearer ${retryToken}` } : {}),
            ...options.headers,
          },
        });

        if (retryResponse.ok) {
          return retryResponse.json();
        }
      } catch {
        // silently ignore auth errors
      }
      return undefined as any;
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: "Request failed" }));
      throw new Error(error.error || error.message || "Request failed");
    }

    return response.json();
  }

  async getClients(page = 1, limit = 50, search = ""): Promise<{ clients: Client[]; pagination: any }> {
    const params = new URLSearchParams({
      page: page.toString(),
      limit: limit.toString(),
    });
    if (search) {
      params.set("search", search);
    }
    const result = await this.request<any>(`/clients?${params}`);
    return {
      clients: result.data.clients,
      pagination: result.data.pagination,
    };
  }

  async searchClients(q: string): Promise<Client[]> {
    if (!q || q.length < 2) return [];
    const result = await this.request<any>(`/clients/search?q=${encodeURIComponent(q)}`);
    return result.data;
  }

  async createClient(data: CreateClientData): Promise<Client> {
    const result = await this.request<any>("/clients", {
      method: "POST",
      body: JSON.stringify(data),
    });
    return result.data;
  }

  async updateClient(id: number, data: Partial<CreateClientData>): Promise<Client> {
    // Endpoint dédié client : accessible au staff (vendeur) — évite le
    // "Forbidden" de la route admin /users/:id.
    const result = await this.request<any>(`/clients/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
    return result.data;
  }

  async deleteClient(id: number): Promise<void> {
    await this.request(`/${id}`, {
      method: "DELETE",
    });
  }
}

export const clientAPI = new ClientAPI();
