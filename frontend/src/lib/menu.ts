import { apiClient } from "./apiClient";
import type { Category, CategoryInput, MenuItem, MenuItemInput } from "../types/menu";

export const listCategories = () =>
  apiClient.get<{ categories: Category[] }>("/api/v1/categories");

export const createCategory = (data: CategoryInput) =>
  apiClient.post<Category>("/api/v1/categories", data);

export const updateCategory = (id: number, data: CategoryInput) =>
  apiClient.put<Category>(`/api/v1/categories/${id}`, data);

export const deleteCategory = (id: number) =>
  apiClient.delete(`/api/v1/categories/${id}`);

export const listMenuItems = (categoryId?: number) =>
  apiClient.get<{ menu_items: MenuItem[] }>("/api/v1/menu-items", {
    params: categoryId ? { category_id: categoryId } : undefined,
  });

export const createMenuItem = (data: MenuItemInput) =>
  apiClient.post<MenuItem>("/api/v1/menu-items", data);

export const updateMenuItem = (id: number, data: MenuItemInput) =>
  apiClient.put<MenuItem>(`/api/v1/menu-items/${id}`, data);

export const updateMenuItemAvailability = (id: number, isAvailable: boolean) =>
  apiClient.patch<MenuItem>(`/api/v1/menu-items/${id}/availability`, { is_available: isAvailable });

export const deleteMenuItem = (id: number) =>
  apiClient.delete(`/api/v1/menu-items/${id}`);

export interface MenuImageUploadResponse {
  image_url: string;
  path: string;
}

export const uploadMenuImage = (file: File) => {
  const formData = new FormData();
  formData.append("image", file);
  return apiClient.post<MenuImageUploadResponse>("/api/v1/menu-items/upload-image", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
};
