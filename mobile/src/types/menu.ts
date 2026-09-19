export interface Category {
  ID: number;
  restaurant_id: number;
  name: string;
  display_order: number;
  is_active: boolean;
}

export interface CategoryInput {
  name: string;
  display_order: number;
  /** Optional on the API (`*bool` server-side): omit it and the stored value is
   *  left alone. Send it only when creating, where the category starts active. */
  is_active?: boolean;
}

export interface MenuItem {
  ID: number;
  restaurant_id: number;
  category_id: number;
  name: string;
  price: number;
  image_url: string;
  description: string;
  is_available: boolean;
  display_order: number;
  /** Computed by the server when read: portions the stock can still make after
   *  queued orders' claims. Absent or null for a dish without a recipe. */
  remaining_servings?: number | null;
  category?: Category;
  categories?: MenuItemCategory[];
  option_groups?: MenuOptionGroup[];
  ingredients?: MenuItemIngredient[];
}

export interface MenuItemCategory {
  ID: number;
  restaurant_id: number;
  menu_item_id: number;
  category_id: number;
  category?: Category;
}

export interface MenuItemIngredient {
  ID: number;
  restaurant_id: number;
  menu_item_id: number;
  ingredient_id: number;
  quantity: number;
  unit: string;
  note: string;
  ingredient?: { ID: number; name: string; unit: string; stock: number; min_stock: number; cost_per_unit: number; yield_percent?: number };
}

export interface MenuOptionGroup {
  ID: number;
  restaurant_id: number;
  menu_item_id: number;
  name: string;
  required: boolean;
  min_select: number;
  max_select: number;
  display_order: number;
  is_active: boolean;
  options?: MenuOption[];
}

export interface MenuOption {
  ID: number;
  restaurant_id: number;
  menu_item_id: number;
  option_group_id: number;
  name: string;
  price_delta: number;
  is_default: boolean;
  display_order: number;
  is_active: boolean;
  ingredients?: MenuOptionIngredient[];
}

export interface MenuIngredientInput {
  ingredient_id: number;
  quantity: number;
  unit?: string;
  note?: string;
}

export interface MenuOptionInput {
  name: string;
  price_delta: number;
  is_default: boolean;
  display_order: number;
  is_active: boolean;
  /**
   * Set on the web menu editor only. It is declared here because a save posts the
   * whole option aggregate and the backend replaces it, so a mobile edit that
   * dropped this field would delete every ingredient link on the dish.
   */
  ingredients?: MenuOptionIngredientInput[];
}

export interface MenuOptionIngredientInput {
  ingredient_id: number;
  direction: 'add' | 'remove';
  quantity: number;
  unit?: string;
}

export interface MenuOptionIngredient {
  ID: number;
  restaurant_id: number;
  menu_item_id: number;
  option_group_id: number;
  menu_option_id: number;
  ingredient_id: number;
  direction: 'add' | 'remove';
  quantity: number;
  unit: string;
}

export interface MenuOptionGroupInput {
  name: string;
  required: boolean;
  min_select: number;
  max_select: number;
  display_order: number;
  is_active: boolean;
  options: MenuOptionInput[];
}

export interface MenuItemInput {
  category_id: number;
  category_ids?: number[];
  name: string;
  price: number;
  image_url?: string;
  description?: string;
  is_available: boolean;
  display_order: number;
  option_groups?: MenuOptionGroupInput[];
  ingredients?: MenuIngredientInput[];
}
