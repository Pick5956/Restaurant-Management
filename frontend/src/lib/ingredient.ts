import { apiClient } from "./apiClient";
import type {
  AdjustStockInput,
  CSVExportResult,
  Ingredient,
  IngredientCategory,
  IngredientInput,
  IngredientLot,
  TransactionListResponse,
  TransactionQuery,
} from "../types/ingredient";

export const listIngredientCategories = () =>
  apiClient.get<{ categories: IngredientCategory[] }>("/api/v1/ingredient-categories");

export const createIngredientCategory = (data: {
  name: string;
  display_order?: number;
  is_active?: boolean;
}) => apiClient.post<IngredientCategory>("/api/v1/ingredient-categories", data);

export const updateIngredientCategory = (
  id: number,
  data: { name: string; display_order?: number; is_active?: boolean },
) => apiClient.put<IngredientCategory>(`/api/v1/ingredient-categories/${id}`, data);

export const deleteIngredientCategory = (id: number) =>
  apiClient.delete(`/api/v1/ingredient-categories/${id}`);

export const listIngredients = () =>
  apiClient.get<{ ingredients: Ingredient[] }>("/api/v1/ingredients");

export const createIngredient = (data: IngredientInput) =>
  apiClient.post<Ingredient>("/api/v1/ingredients", data);

export const updateIngredient = (id: number, data: IngredientInput) =>
  apiClient.put<Ingredient>(`/api/v1/ingredients/${id}`, data);

export const deleteIngredient = (id: number) =>
  apiClient.delete(`/api/v1/ingredients/${id}`);

export const adjustStock = (id: number, data: AdjustStockInput) =>
  apiClient.post<Ingredient>(`/api/v1/ingredients/${id}/adjust`, data);

/** Open lots only (remaining > 0), the one that expires first at the top. */
export const listLots = (id: number) =>
  apiClient.get<{ lots: IngredientLot[] }>(`/api/v1/ingredients/${id}/lots`);

/** Sets or, with an empty string, clears one lot's date. Never moves stock. */
export const updateLotExpiry = (id: number, lotId: number, expiresAt: string) =>
  apiClient.put<void>(`/api/v1/ingredients/${id}/lots/${lotId}`, { expires_at: expiresAt });

/**
 * Throws away what is left of one lot. It is an ordinary stock-out in the
 * history, drained from this lot rather than the one that expires first.
 */
export const discardLot = (id: number, lotId: number, reason = "") =>
  apiClient.post<Ingredient>(`/api/v1/ingredients/${id}/lots/${lotId}/discard`, { reason });

/**
 * Drops empty filters instead of sending `type=`/`search=`, which the API would
 * have to defend against one by one.
 */
export function transactionParams(query: TransactionQuery): Record<string, string> {
  const params: Record<string, string> = {};
  if (query.ingredient_id) params.ingredient_id = String(query.ingredient_id);
  if (query.category_id) params.category_id = String(query.category_id);
  if (query.type) params.type = query.type;
  if (query.search?.trim()) params.search = query.search.trim();
  if (query.from) params.from = query.from;
  if (query.to) params.to = query.to;
  if (query.page && query.page > 1) params.page = String(query.page);
  if (query.limit) params.limit = String(query.limit);
  return params;
}

export const listTransactions = (ingredientId: number, query: TransactionQuery = {}) =>
  apiClient.get<TransactionListResponse>(`/api/v1/ingredients/${ingredientId}/transactions`, {
    params: transactionParams(query),
  });

/** The whole-inventory movement log — every ingredient, filtered server-side. */
export const listAllTransactions = (query: TransactionQuery = {}) =>
  apiClient.get<TransactionListResponse>("/api/v1/ingredient-transactions", {
    params: transactionParams(query),
  });

/** Reads the filename the server picked, falling back if CORS hides the header. */
export function filenameFromDisposition(disposition: unknown, fallback: string): string {
  const match = /filename="?([^";]+)"?/i.exec(String(disposition ?? ""));
  return match?.[1]?.trim() || fallback;
}

/**
 * Hands a downloaded file to the browser. The API authenticates on the
 * Authorization and X-Restaurant-ID headers, which a plain `<a href>` cannot
 * send — so the CSV comes back through the same axios client as a blob and is
 * saved from memory instead of navigated to.
 */
function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoking in the same tick cancels the download in Safari.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function downloadCSV(
  path: string,
  params: Record<string, string>,
  fallbackName: string,
): Promise<CSVExportResult> {
  const response = await apiClient.get<Blob>(path, { params, responseType: "blob" });
  const filename = filenameFromDisposition(response.headers["content-disposition"], fallbackName);
  const total = Number(response.headers["x-export-total"] ?? 0);
  const rows = Number(response.headers["x-export-rows"] ?? 0);
  saveBlob(response.data, filename);
  return { filename, rows, total, truncated: total > rows };
}

export const exportTransactionsCSV = (query: TransactionQuery, lang: "th" | "en") =>
  downloadCSV(
    "/api/v1/ingredient-transactions/export",
    { ...transactionParams(query), lang },
    "inventory-history.csv",
  );

export const exportStockCSV = (
  filters: {
    search?: string;
    status?: string;
    category_id?: number;
    sort?: string;
    order?: string;
  },
  lang: "th" | "en",
) => {
  const params: Record<string, string> = { lang };
  if (filters.search?.trim()) params.search = filters.search.trim();
  if (filters.status && filters.status !== "all") params.status = filters.status;
  if (filters.category_id) params.category_id = String(filters.category_id);
  if (filters.sort) params.sort = filters.sort;
  if (filters.order) params.order = filters.order;
  return downloadCSV("/api/v1/ingredient-stock/export", params, "inventory-stock.csv");
};
