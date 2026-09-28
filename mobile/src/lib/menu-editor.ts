import type {
  Category,
  CategoryInput,
  MenuIngredientInput,
  MenuItem,
  MenuItemCategory,
  MenuOptionGroupInput,
  MenuOptionIngredientInput,
  MenuOptionInput,
} from '@/src/types/menu';

type CategoryChoice = Pick<Category, 'ID' | 'display_order' | 'is_active' | 'name'>;
type MenuCategorySource = Pick<MenuItem, 'category_id'> & {
  categories?: Array<Pick<MenuItemCategory, 'category_id'>>;
};

export type MenuOptionGroupIssueCode =
  | 'too_many_groups'
  | 'group_name_required'
  | 'group_name_too_long'
  | 'group_name_duplicate'
  | 'too_many_options'
  | 'option_required'
  | 'option_name_required'
  | 'option_name_too_long'
  | 'option_name_duplicate'
  | 'option_price_negative'
  | 'option_price_too_large'
  | 'max_below_min'
  | 'max_too_large'
  | 'min_exceeds_active_options'
  | 'defaults_exceed_max';

export interface MenuOptionGroupIssue {
  code: MenuOptionGroupIssueCode;
  groupIndex: number;
  optionIndex?: number;
}

export interface MenuOptionGroupValidation {
  groups: MenuOptionGroupInput[];
  issues: MenuOptionGroupIssue[];
}

/** An option's stock row while it is being typed: the amount stays text, like the recipe's. */
export type MenuOptionIngredientDraft = Omit<MenuOptionIngredientInput, 'quantity'> & {
  quantity: string;
};

export type MenuOptionDraft = Omit<MenuOptionInput, 'price_delta' | 'ingredients'> & {
  price_delta: string;
  ingredients?: MenuOptionIngredientDraft[];
};

export type MenuOptionGroupDraft = Omit<MenuOptionGroupInput, 'options'> & {
  options: MenuOptionDraft[];
};

export type MenuIngredientDraft = Omit<MenuIngredientInput, 'quantity'> & {
  quantity: string;
};

const MAX_OPTION_GROUPS = 20;
const MAX_OPTIONS_PER_GROUP = 50;
const MAX_OPTION_NAME_LENGTH = 120;
const MAX_OPTION_PRICE = 1_000_000_000;

function finiteNumber(value: number, fallback: number) {
  return Number.isFinite(value) ? value : fallback;
}

function normalizedInteger(value: number, fallback: number) {
  return Math.trunc(finiteNumber(value, fallback));
}

function decimalInput(value: string) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function menuOptionGroupDrafts(
  groups: readonly MenuOptionGroupInput[],
): MenuOptionGroupDraft[] {
  return groups.map((group) => ({
    ...group,
    options: group.options.map((option) => ({
      ...option,
      price_delta: String(option.price_delta),
      ingredients: option.ingredients?.map((row) => ({ ...row, quantity: String(row.quantity) })),
    })),
  }));
}

export function menuOptionGroupInputs(
  groups: readonly MenuOptionGroupDraft[],
): MenuOptionGroupInput[] {
  return groups.map((group) => ({
    ...group,
    options: group.options.map((option) => ({
      ...option,
      price_delta: decimalInput(option.price_delta),
      ingredients: option.ingredients?.map((row) => ({ ...row, quantity: decimalInput(row.quantity) })),
    })),
  }));
}

export function menuIngredientDrafts(
  ingredients: readonly MenuIngredientInput[],
): MenuIngredientDraft[] {
  return ingredients.map((ingredient) => ({
    ...ingredient,
    quantity: String(ingredient.quantity),
  }));
}

export function menuIngredientInputs(
  ingredients: readonly MenuIngredientDraft[],
): MenuIngredientInput[] {
  return ingredients.map((ingredient) => ({
    ...ingredient,
    quantity: decimalInput(ingredient.quantity),
  }));
}

export function validateMenuOptionGroups(
  sourceGroups: MenuOptionGroupInput[],
): MenuOptionGroupValidation {
  const issues: MenuOptionGroupIssue[] = [];
  if (sourceGroups.length > MAX_OPTION_GROUPS) {
    issues.push({ code: 'too_many_groups', groupIndex: -1 });
  }

  const groupNames = new Set<string>();
  const groups = sourceGroups.map((sourceGroup, groupIndex) => {
    const required = Boolean(sourceGroup.required);
    const requestedMin = normalizedInteger(sourceGroup.min_select, 0);
    const requestedMax = normalizedInteger(sourceGroup.max_select, 1);
    const minSelect = Math.max(required ? 1 : 0, requestedMin);
    const maxSelect = Math.max(1, requestedMax);
    const groupName = sourceGroup.name.trim();

    if (!groupName) {
      issues.push({ code: 'group_name_required', groupIndex });
    } else {
      if ([...groupName].length > MAX_OPTION_NAME_LENGTH) {
        issues.push({ code: 'group_name_too_long', groupIndex });
      }
      const groupNameKey = groupName.toLowerCase();
      if (groupNames.has(groupNameKey)) {
        issues.push({ code: 'group_name_duplicate', groupIndex });
      } else {
        groupNames.add(groupNameKey);
      }
    }

    if (sourceGroup.options.length > MAX_OPTIONS_PER_GROUP) {
      issues.push({ code: 'too_many_options', groupIndex });
    }
    if (!sourceGroup.options.length) {
      issues.push({ code: 'option_required', groupIndex });
    }
    if (maxSelect < minSelect) {
      issues.push({ code: 'max_below_min', groupIndex });
    }
    if (maxSelect > MAX_OPTIONS_PER_GROUP) {
      issues.push({ code: 'max_too_large', groupIndex });
    }

    const optionNames = new Set<string>();
    let activeOptions = 0;
    let defaultOptions = 0;
    const options = sourceGroup.options.map((sourceOption, optionIndex) => {
      const optionName = sourceOption.name.trim();
      const priceDelta = finiteNumber(sourceOption.price_delta, 0);
      const isActive = sourceOption.is_active !== false;
      const isDefault = Boolean(sourceOption.is_default);

      if (!optionName) {
        issues.push({ code: 'option_name_required', groupIndex, optionIndex });
      } else {
        if ([...optionName].length > MAX_OPTION_NAME_LENGTH) {
          issues.push({ code: 'option_name_too_long', groupIndex, optionIndex });
        }
        const optionNameKey = optionName.toLowerCase();
        if (optionNames.has(optionNameKey)) {
          issues.push({ code: 'option_name_duplicate', groupIndex, optionIndex });
        } else {
          optionNames.add(optionNameKey);
        }
      }

      if (priceDelta < 0) {
        issues.push({ code: 'option_price_negative', groupIndex, optionIndex });
      } else if (priceDelta > MAX_OPTION_PRICE) {
        issues.push({ code: 'option_price_too_large', groupIndex, optionIndex });
      }
      if (isActive) {
        activeOptions += 1;
        if (isDefault) defaultOptions += 1;
      }

      return {
        ...sourceOption,
        name: optionName,
        price_delta: priceDelta,
        is_default: isDefault,
        display_order: Math.max(
          1,
          normalizedInteger(sourceOption.display_order, optionIndex + 1),
        ),
        is_active: isActive,
      };
    });

    const isActive = sourceGroup.is_active !== false;
    if (isActive && minSelect > activeOptions) {
      issues.push({ code: 'min_exceeds_active_options', groupIndex });
    }
    if (isActive && defaultOptions > maxSelect) {
      issues.push({ code: 'defaults_exceed_max', groupIndex });
    }

    return {
      ...sourceGroup,
      name: groupName,
      required,
      min_select: minSelect,
      max_select: maxSelect,
      display_order: Math.max(
        1,
        normalizedInteger(sourceGroup.display_order, groupIndex + 1),
      ),
      is_active: isActive,
      options,
    };
  });

  return { groups, issues };
}

export function categoryActiveToggleInput(
  category: CategoryChoice,
): CategoryInput {
  return {
    name: category.name.trim(),
    display_order: category.display_order,
    is_active: !category.is_active,
  };
}

export function initialMenuCategoryIds(
  item: MenuCategorySource | undefined,
  categories: CategoryChoice[],
): number[] {
  if (!item) {
    const firstActive = [...categories]
      .filter((category) => category.is_active)
      .sort(
        (left, right) =>
          left.display_order - right.display_order || left.ID - right.ID,
      )[0];
    return firstActive ? [firstActive.ID] : [];
  }

  const linked = item.categories
    ?.map((category) => category.category_id)
    .filter((categoryId) => categoryId > 0);
  const candidates = linked?.length ? linked : [item.category_id];
  return [...new Set(candidates.filter((categoryId) => categoryId > 0))];
}

export function selectableMenuCategories<T extends CategoryChoice>(
  categories: T[],
  selectedCategoryIds: number[],
): T[] {
  const selected = new Set(selectedCategoryIds);
  return [...categories]
    .filter((category) => category.is_active || selected.has(category.ID))
    .sort(
      (left, right) =>
        left.display_order - right.display_order || left.ID - right.ID,
    );
}
