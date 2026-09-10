export interface IngredientCategory {
  ID: number;
  restaurant_id: number;
  name: string;
  display_order: number;
  is_active: boolean;
}

export interface Ingredient {
  ID: number;
  restaurant_id: number;
  name: string;
  sku: string;
  category_id: number | null;
  image_url: string;
  unit: string;
  stock: number;
  min_stock: number;
  cost_per_unit: number;
  yield_percent: number;
  storage_type: string;
  category?: IngredientCategory;
  /** Days of cover at the last 30 days' kitchen usage; null with no usage yet. */
  days_left?: number | null;
  /** Bumped by every stock write, so it is a truthful "last moved". */
  UpdatedAt?: string;
}

export interface IngredientTransaction {
  ID: number;
  restaurant_id: number;
  ingredient_id: number;
  type: 'in' | 'out' | 'adjust';
  quantity: number;
  note: string;
  created_by_id: number;
  created_by?: { ID: number; first_name: string; last_name: string };
  created_by_name?: string;
  /** Money that moved with the stock; only a restock carries one today. */
  amount?: number;
  CreatedAt?: string;
}

export interface IngredientMetadataInput {
  name: string;
  sku: string;
  category_id?: number;
  image_url: string;
  unit: string;
  min_stock: number;
  cost_per_unit: number;
  yield_percent: number;
  storage_type: string;
}

export interface IngredientInput extends IngredientMetadataInput {
  stock: number;
}

export interface AdjustStockInput {
  type: 'in' | 'out' | 'adjust';
  quantity: number;
  note?: string;
}
