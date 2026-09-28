import { File as FileSystemFile } from 'expo-file-system';

import { apiRequest } from './client';
import {
  MENU_IMAGE_UPLOAD_PATH,
  appendMenuImageUpload,
  type MenuImageUploadFile,
  type MenuImageUploadPart,
} from '@/src/lib/menu-image';
import type { Category, CategoryInput, MenuItem, MenuItemInput } from '@/src/types/menu';

/**
 * Turns a picked or cropped file into a part Expo's fetch can serialise. Its
 * bytes are read only when the body is built, so nothing is held in memory
 * while the request is being assembled.
 */
export async function toMenuImageUploadPart(
  source: MenuImageUploadFile,
): Promise<MenuImageUploadPart> {
  const handle = new FileSystemFile(source.uri);
  return {
    name: source.name,
    type: source.type,
    bytes: () => handle.bytes(),
  };
}

export function listCategories() {
  return apiRequest<{ categories: Category[] }>('/api/v1/categories');
}

export function listMenuItems(categoryId?: number) {
  const query = categoryId ? `?category_id=${categoryId}` : '';
  return apiRequest<{ menu_items: MenuItem[] }>(`/api/v1/menu-items${query}`);
}

export function createCategory(data: CategoryInput) {
  return apiRequest<Category>('/api/v1/categories', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateCategory(id: number, data: CategoryInput) {
  return apiRequest<Category>(`/api/v1/categories/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export function deleteCategory(id: number) {
  return apiRequest<{ status: string }>(`/api/v1/categories/${id}`, {
    method: 'DELETE',
  });
}

export function createMenuItem(data: MenuItemInput) {
  return apiRequest<MenuItem>('/api/v1/menu-items', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateMenuItem(id: number, data: MenuItemInput) {
  return apiRequest<MenuItem>(`/api/v1/menu-items/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

export function deleteMenuItem(id: number) {
  return apiRequest<{ status: string }>(`/api/v1/menu-items/${id}`, {
    method: 'DELETE',
  });
}

export function setMenuItemAvailability(id: number, isAvailable: boolean) {
  return apiRequest<MenuItem>(`/api/v1/menu-items/${id}/availability`, {
    method: 'PATCH',
    body: JSON.stringify({ is_available: isAvailable }),
  });
}

export async function uploadMenuImage(source: MenuImageUploadFile) {
  const formData = new FormData();
  const file = await toMenuImageUploadPart(source);
  appendMenuImageUpload(formData, file);
  return apiRequest<{ image_url: string; path: string }>(MENU_IMAGE_UPLOAD_PATH, {
    method: 'POST',
    body: formData,
  });
}
