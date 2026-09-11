export interface IngredientCategory {
  ID: number;
  restaurant_id: number;
  name: string;
  display_order: number;
  is_active: boolean;
  CreatedAt?: string;
  UpdatedAt?: string;
}

export interface Ingredient {
  ID: number;
  restaurant_id: number;
  name: string;
  // sku/image_url/yield_percent are no longer collected in the inventory form,
  // but the API still returns them and the menu page reads yield_percent for
  // per-dish cost — so the response type keeps them.
  sku?: string;
  category_id?: number | null;
  image_url?: string;
  unit: string;
  /** Every unit a quantity may be entered in for this ingredient, computed by
   *  the server from `unit`. Drives the unit picker; the list is authoritative,
   *  so the client never keeps its own conversion table. */
  unit_family?: IngredientUnitOption[];
  stock: number;
  min_stock: number;
  /**
   * The most this shelf has been proved to hold. It rises to meet any stock
   * level above it and never falls, so it is a real observed number rather than
   * a target anyone typed — which is what makes it safe to divide by. Zero
   * means nothing has been observed yet: draw no bar rather than invent one.
   */
  max_stock?: number;
  /**
   * The reorder level as a share of max_stock. When it is above zero the server
   * recomputes min_stock from it every time max_stock moves, so a shop that
   * starts buying in larger loads keeps being warned at the same proportion.
   */
  min_percent?: number;
  cost_per_unit: number;
  yield_percent?: number;
  storage_type?: string;
  /**
   * How many days the current stock lasts at the rate this ingredient was
   * actually consumed over the last 30 days. Computed at read time, absent when
   * nothing was consumed in the window — there is no rate to divide by, and a 0
   * would read as "runs out today". Render the absent case as "no usage data",
   * never as an empty bar.
   */
  days_left?: number;
  /** The daily rate days_left was derived from, for showing the working. */
  daily_use?: number;
  category?: IngredientCategory;
  CreatedAt?: string;
  UpdatedAt?: string;
}

export type TransactionType = "in" | "out" | "adjust";

export interface IngredientTransaction {
  ID: number;
  restaurant_id: number;
  ingredient_id: number;
  type: TransactionType;
  quantity: number;
  /** What a restock cost. Only "in" carries money; "out" and "adjust" are always 0. */
  amount: number;
  note: string;
  created_by_id: number;
  // The log stores ids only — the API joins these names on so a whole-inventory
  // read is readable. They are empty when the row points at a deleted record.
  ingredient_name: string;
  ingredient_unit: string;
  category_name: string;
  created_by_name: string;
  CreatedAt?: string;
}

export interface TransactionQuery {
  ingredient_id?: number;
  category_id?: number;
  type?: TransactionType | "";
  search?: string;
  /** Inclusive YYYY-MM-DD in the shop timezone. */
  from?: string;
  /** Inclusive YYYY-MM-DD — the API widens it to cover the whole day. */
  to?: string;
  page?: number;
  limit?: number;
}

export interface TransactionListResponse {
  transactions: IngredientTransaction[];
  total: number;
  page: number;
  limit: number;
}

export interface CSVExportResult {
  filename: string;
  /** Rows actually written. Fewer than `total` when the server capped the file. */
  rows: number;
  total: number;
  truncated: boolean;
}

export interface IngredientInput {
  name: string;
  category_id?: number;
  unit: string;
  stock: number;
  min_stock: number;
  /**
   * Omit it and the server leaves whatever percentage is stored alone; send 0
   * to clear it and keep min_stock as an absolute quantity. A client that never
   * sends it can therefore not erase a percentage set from somewhere else.
   */
  min_percent?: number;
  cost_per_unit: number;
  storage_type?: string;
}

/** One entry in a unit picker: a unit this ingredient accepts, and how many of
 *  its own stock units one of them makes (1 กิโลกรัม = 1000 against a gram shelf). */
export interface IngredientUnitOption {
  unit: string;
  stock_per_unit: number;
}

export interface AdjustStockInput {
  type: "in" | "out" | "adjust";
  quantity: number;
  /** Unit the quantity was typed in. Omitted means the ingredient's own unit.
   *  Any other unit of the same family is converted by the server. */
  unit?: string;
  note?: string;
  /** What the restock cost. Stock-in only; a positive value writes an expense entry. */
  amount?: number;
}
