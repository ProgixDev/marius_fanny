import type { Product } from '../types';
import { authClient } from "./AuthClient";

const API_URL = import.meta.env.VITE_API_URL || (typeof window !== "undefined" ? window.location.origin : "http://localhost:3000");

// Ensure API_URL has protocol
const normalizedApiUrl = API_URL.startsWith('http') ? API_URL : `https://${API_URL}`;

export interface CreateProductData {
  name: string;
  category: string[];
  price: number;
  discountPercentage?: number;
  available?: boolean;
  minOrderQuantity?: number;
  maxOrderQuantity?: number;
  description?: string;
  image?: string;
  images?: string[];
  preparationTimeHours?: number;
  availableDays?: number[];
  hasTaxes?: boolean;
  allergens?: string;
  productionType: "patisserie" | "cuisinier" | "four";
  targetAudience: "clients" | "pro";
  customOptions?: Array<{
    name: string;
    type?: "choice" | "text";
    choices: string[];
  }>;
  recommendations?: number[];
}

export interface UpdateProductData {
  name?: string;
  category?: string[];
  price?: number;
  discountPercentage?: number;
  available?: boolean;
  minOrderQuantity?: number;
  maxOrderQuantity?: number;
  description?: string;
  image?: string;
  images?: string[];
  preparationTimeHours?: number | null;
  availableDays?: number[];
  hasTaxes?: boolean;
  allergens?: string;
  productionType?: "patisserie" | "cuisinier" | "four";
  targetAudience?: "clients" | "pro";
  customOptions?: Array<{
    name: string;
    type?: "choice" | "text";
    choices: string[];
  }>;
  recommendations?: number[];
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  message?: string;
}

export interface PaginatedResponse<T> {
  success: boolean;
  data: {
    products: T[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  };
}

class ProductAPI {
  private baseURL = `${normalizedApiUrl}/api/products`;

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
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
      credentials: 'include',
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
      const errorData = await response.json().catch(() => ({ message: 'An error occurred' }));
      throw new Error(errorData.message || `HTTP ${response.status}`);
    }

    return response.json();
  }

  async getAllProducts(page = 1, limit = 10, targetAudience?: "clients" | "pro"): Promise<PaginatedResponse<Product>> {
    const audience = targetAudience ? `&targetAudience=${targetAudience}` : "";
    return this.request<PaginatedResponse<Product>>(`?page=${page}&limit=${limit}${audience}`);
  }

  async getProductById(id: number): Promise<ApiResponse<Product>> {
    return this.request<ApiResponse<Product>>(`/${id}`);
  }

  async createProduct(data: CreateProductData): Promise<ApiResponse<Product>> {
    return this.request<ApiResponse<Product>>('', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateProduct(id: number, data: UpdateProductData): Promise<ApiResponse<Product>> {
    return this.request<ApiResponse<Product>>(`/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteProduct(id: number): Promise<ApiResponse<void>> {
    return this.request<ApiResponse<void>>(`/${id}`, {
      method: 'DELETE',
    });
  }

  async toggleProductAvailability(id: number): Promise<ApiResponse<Product>> {
    return this.request<ApiResponse<Product>>(`/${id}/toggle-availability`, {
      method: 'PATCH',
    });
  }

  async reorderProducts(orders: { id: number; displayOrder: number }[]): Promise<ApiResponse<void>> {
    return this.request<ApiResponse<void>>('/reorder', {
      method: 'PATCH',
      body: JSON.stringify({ orders }),
    });
  }

  async updateAllProductsAllergens(allergens: string): Promise<ApiResponse<{ modifiedCount: number }>> {
    return this.request<ApiResponse<{ modifiedCount: number }>>('/bulk/allergens', {
      method: 'PATCH',
      body: JSON.stringify({ allergens }),
    });
  }

  async enableClientAllergyTextField(): Promise<ApiResponse<{ modifiedCount: number }>> {
    return this.request<ApiResponse<{ modifiedCount: number }>>('/bulk/client-allergy-field', {
      method: 'PATCH',
    });
  }
}

export const productAPI = new ProductAPI();
