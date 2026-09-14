import type { Ingredient } from "@/src/types/ingredient";
import type { MenuIngredientInput, MenuItem, MenuItemInput, MenuOptionGroupInput, MenuOptionIngredientInput } from "@/src/types/menu";

export const emptyItem: MenuItemInput = {
  category_id: 0,
  category_ids: [],
  name: "",
  price: 0,
  image_url: "",
  description: "",
  is_available: true,
  display_order: 0,
  option_groups: [],
  ingredients: [],
};

export const emptyOptionGroup = (): MenuOptionGroupInput => ({
  name: "",
  required: false,
  min_select: 0,
  max_select: 1,
  display_order: 0,
  is_active: true,
  options: [{ name: "", price_delta: 0, is_default: false, display_order: 0, is_active: true }],
});

export const emptyOptionIngredient = (): MenuOptionIngredientInput => ({
  ingredient_id: 0,
  direction: "add",
  quantity: 0,
  unit: "",
});

export const emptyRecipeComponent = (): MenuIngredientInput => ({
  ingredient_id: 0,
  quantity: 0,
  unit: "",
  note: "",
});

/**
 * How many stock units one `unit` of this ingredient makes. cost_per_unit and
 * stock are both quoted in the ingredient's own unit, so any amount typed in a
 * different unit of the same family has to be restated before it can be priced
 * or summed. The backend does this on save; this is the same arithmetic for the
 * live preview, which otherwise showed a kilogram of a gram-stocked ingredient
 * at a thousandth of its cost until the form round-tripped.
 */
export function stockUnitsPer(ingredient: Ingredient | undefined, unit: string | undefined) {
  if (!ingredient) return 1;
  const chosen = (unit || ingredient.unit || "").trim();
  if (!chosen || chosen === ingredient.unit) return 1;
  return ingredient.unit_family?.find((entry) => entry.unit === chosen)?.stock_per_unit ?? 1;
}

export function recipeCost(components: MenuIngredientInput[], ingredients: Ingredient[]) {
  return components.reduce((total, component) => {
    const ingredient = ingredients.find((item) => item.ID === component.ingredient_id);
    if (!ingredient || component.quantity <= 0) return total;
    const yieldPercent = ingredient.yield_percent && ingredient.yield_percent > 0 ? ingredient.yield_percent : 100;
    const inStockUnits = component.quantity * stockUnitsPer(ingredient, component.unit);
    return total + (inStockUnits * ingredient.cost_per_unit) / (yieldPercent / 100);
  }, 0);
}

export function menuCategoryIds(item: MenuItem) {
  const linkedIds = new Set<number>();
  for (const link of item.categories ?? []) {
    if (link.category_id) linkedIds.add(link.category_id);
  }
  if (linkedIds.size) return Array.from(linkedIds);
  return item.category_id ? [item.category_id] : [];
}

export function menuItemToInput(item: MenuItem, isAvailable = item.is_available): MenuItemInput {
  const categoryIds = menuCategoryIds(item);
  return {
    category_id: categoryIds[0] ?? item.category_id,
    category_ids: categoryIds,
    name: item.name,
    price: item.price,
    image_url: item.image_url,
    description: item.description,
    is_available: isAvailable,
    display_order: item.display_order,
    option_groups: (item.option_groups ?? []).map((group) => ({
      name: group.name,
      required: group.required,
      min_select: group.min_select,
      max_select: group.max_select,
      display_order: group.display_order,
      is_active: group.is_active,
      options: (group.options ?? []).map((option) => ({
        name: option.name,
        price_delta: option.price_delta,
        is_default: option.is_default,
        display_order: option.display_order,
        is_active: option.is_active,
        // Must be carried: a save posts the whole option aggregate and the
        // backend replaces it, so a field missing here is a field deleted.
        ingredients: (option.ingredients ?? []).map((row) => ({
          ingredient_id: row.ingredient_id,
          direction: row.direction,
          quantity: row.quantity,
          unit: row.unit || row.ingredient?.unit || "",
        })),
      })),
    })),
    ingredients: (item.ingredients ?? []).map((component) => ({
      ingredient_id: component.ingredient_id,
      quantity: component.quantity,
      unit: component.unit || component.ingredient?.unit || "",
      note: component.note || "",
    })),
  };
}

export function AvailabilitySwitch({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={label}
      aria-pressed={checked}
      onClick={(event) => {
        event.stopPropagation();
        onChange();
      }}
      className={`flex h-6 w-11 items-center rounded-full border p-0.5 transition-[background-color,border-color,opacity] disabled:cursor-not-allowed disabled:opacity-60 ${
        checked
          ? "border-emerald-400 bg-emerald-400 dark:border-emerald-300 dark:bg-emerald-300"
          : "border-gray-400 bg-gray-300 dark:border-gray-600 dark:bg-gray-700"
      }`}
    >
      <span
        className={`h-5 w-5 rounded-full border bg-white shadow-sm transition-transform dark:bg-gray-950 ${
          checked
            ? "translate-x-[19px] border-white dark:border-white"
            : "translate-x-0 border-gray-100 shadow-gray-950/20 dark:border-gray-200"
        }`}
      />
    </button>
  );
}
