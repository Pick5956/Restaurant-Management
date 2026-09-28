export interface Category {
  ID: number;
  restaurant_id: number;
  name: string;
  display_order: number;
  is_active: boolean;
  CreatedAt?: string;
  UpdatedAt?: string;
}

export interface MenuItem {
  ID: number;
  restaurant_id: number;
  category_id: number;
  name: string;
  price: number;
  image_url: string;
  /** The photo image_url was cut from, and its framing (see MenuImageCropper). Empty: only the square exists. */
  image_original_url?: string;
  image_crop_zoom?: number;
  image_crop_x?: number;
  image_crop_y?: number;
  description: string;
  is_available: boolean;
  /**
   * Portions still makeable from current stock after subtracting what queued orders
   * have already claimed. Undefined/null means no recipe (not stock-limited); 0 = sold out.
   */
  remaining_servings?: number | null;
  display_order: number;
  category?: Category;
  categories?: MenuItemCategory[];
  option_groups?: MenuOptionGroup[];
  ingredients?: MenuItemIngredient[];
  CreatedAt?: string;
  UpdatedAt?: string;
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
  ingredient?: {
    ID: number;
    name: string;
    unit: string;
    stock: number;
    min_stock: number;
    cost_per_unit: number;
    yield_percent?: number;
  };
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

/**
 * What picking this option does to the dish's ingredient use. `direction` carries
 * the sign so `quantity` is always positive - the backend stores it that way
 * because every quantity in the schema is checked `> 0` and a sign lost in a JSON
 * round trip would turn "use less" into "use more".
 */
export interface MenuOptionIngredient {
  ID: number;
  restaurant_id: number;
  menu_item_id: number;
  option_group_id: number;
  menu_option_id: number;
  ingredient_id: number;
  direction: MenuOptionIngredientDirection;
  quantity: number;
  unit: string;
  ingredient?: {
    ID: number;
    name: string;
    unit: string;
    stock: number;
    cost_per_unit: number;
  };
}

export type MenuOptionIngredientDirection = "add" | "remove";

export interface CategoryInput {
  name: string;
  display_order: number;
  /** Optional on the API (`*bool` server-side): omit it and the stored value is
   *  left alone. Send it only when you mean to change whether the category is
   *  shown - passing `true` on a rename used to silently un-hide it. */
  is_active?: boolean;
}

export interface MenuItemInput {
  category_id: number;
  category_ids?: number[];
  name: string;
  price: number;
  image_url?: string;
  image_original_url?: string;
  image_crop_zoom?: number;
  image_crop_x?: number;
  image_crop_y?: number;
  description?: string;
  is_available: boolean;
  display_order: number;
  option_groups?: MenuOptionGroupInput[];
  ingredients?: MenuIngredientInput[];
}

export interface MenuIngredientInput {
  ingredient_id: number;
  quantity: number;
  unit?: string;
  note?: string;
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

export interface MenuOptionInput {
  name: string;
  price_delta: number;
  is_default: boolean;
  display_order: number;
  is_active: boolean;
  ingredients?: MenuOptionIngredientInput[];
}

export interface MenuOptionIngredientInput {
  ingredient_id: number;
  direction: MenuOptionIngredientDirection;
  quantity: number;
  unit?: string;
}
