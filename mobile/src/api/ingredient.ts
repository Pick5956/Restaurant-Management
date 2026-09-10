import { apiRequest } from './client';
import type {
  AdjustStockInput,
  Ingredient,
  IngredientCategory,
  IngredientInput,
  IngredientMetadataInput,
  IngredientTransaction,
  TransactionListResponse,
  TransactionQuery,
} from '@/src/types/ingredient';

export const listIngredientCategories = () => apiRequest<{ categories: IngredientCategory[] }>('/api/v1/ingredient-categories');
export const createIngredientCategory = (data: { name: string; display_order?: number; is_active?: boolean }) => apiRequest<IngredientCategory>('/api/v1/ingredient-categories', { method: 'POST', body: JSON.stringify(data) });
export const updateIngredientCategory = (id: number, data: { name?: string; display_order?: number; is_active?: boolean }) => apiRequest<IngredientCategory>(`/api/v1/ingredient-categories/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteIngredientCategory = (id: number) => apiRequest<void>(`/api/v1/ingredient-categories/${id}`, { method: 'DELETE' });
export const listIngredients = () => apiRequest<{ ingredients: Ingredient[] }>('/api/v1/ingredients');
export const createIngredient = (data: IngredientInput) => apiRequest<Ingredient>('/api/v1/ingredients', { method: 'POST', body: JSON.stringify(data) });
export const updateIngredient = (id: number, data: IngredientMetadataInput) => apiRequest<Ingredient>(`/api/v1/ingredients/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const deleteIngredient = (id: number) => apiRequest<void>(`/api/v1/ingredients/${id}`, { method: 'DELETE' });
export const adjustStock = (id: number, data: AdjustStockInput) => apiRequest<Ingredient>(`/api/v1/ingredients/${id}/adjust`, { method: 'POST', body: JSON.stringify(data) });
export const listTransactions = (id: number) => apiRequest<{ transactions: IngredientTransaction[] }>(`/api/v1/ingredients/${id}/transactions`);

/**
 * The whole inventory's movement log, every ingredient in one list. Empty
 * filters are left off the query string rather than sent as `type=`, which the
 * API would have to defend against one by one — same rule the web uses.
 */
export function listAllTransactions(query: TransactionQuery = {}) {
  const params = new URLSearchParams();
  if (query.ingredient_id) params.set('ingredient_id', String(query.ingredient_id));
  if (query.category_id) params.set('category_id', String(query.category_id));
  if (query.type) params.set('type', query.type);
  if (query.search?.trim()) params.set('search', query.search.trim());
  if (query.from) params.set('from', query.from);
  if (query.to) params.set('to', query.to);
  if (query.page && query.page > 1) params.set('page', String(query.page));
  if (query.limit) params.set('limit', String(query.limit));
  const search = params.toString();
  return apiRequest<TransactionListResponse>(`/api/v1/ingredient-transactions${search ? `?${search}` : ''}`);
}
