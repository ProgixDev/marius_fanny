import type { Category, CreateCategoryData, UpdateCategoryData } from "../types";
import { authClient } from "./AuthClient";

const API_URL = import.meta.env.VITE_API_URL || (typeof window !== "undefined" ? window.location.origin : "http://localhost:3000");

// Ensure API_URL has protocol
const normalizedApiUrl = API_URL.startsWith('http') ? API_URL : `https://${API_URL}`;

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  message?: string;
}

export interface CategoriesResponse {
  success: boolean;
  data: {
    categories: Category[];
    pagination?: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  };
}

class CategoryAPI {
  private baseURL = `${normalizedApiUrl}/api/categories`;

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

  async getAllCategories(): Promise<CategoriesResponse> {
    return this.request<CategoriesResponse>('/');
  }

  async getAllCategoriesAdmin(page = 1, limit = 10): Promise<CategoriesResponse> {
    return this.request<CategoriesResponse>(`/admin/all?page=${page}&limit=${limit}`);
  }

  async getCategoryById(id: number): Promise<ApiResponse<Category>> {
    return this.request<ApiResponse<Category>>(`/${id}`);
  }

  async createCategory(data: CreateCategoryData): Promise<ApiResponse<Category>> {
    return this.request<ApiResponse<Category>>('', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateCategory(id: number, data: UpdateCategoryData): Promise<ApiResponse<Category>> {
    return this.request<ApiResponse<Category>>(`/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteCategory(id: number): Promise<ApiResponse<void>> {
    return this.request<ApiResponse<void>>(`/${id}`, {
      method: 'DELETE',
    });
  }

  async toggleCategoryStatus(id: number): Promise<ApiResponse<Category>> {
    return this.request<ApiResponse<Category>>(`/${id}/toggle-status`, {
      method: 'PATCH',
    });
  }
}

export const categoryAPI = new CategoryAPI();
