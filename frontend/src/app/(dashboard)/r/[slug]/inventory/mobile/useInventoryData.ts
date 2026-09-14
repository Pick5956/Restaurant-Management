"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  adjustStock,
  createIngredient,
  createIngredientCategory,
  deleteIngredient,
  deleteIngredientCategory,
  listIngredientCategories,
  listIngredients,
  updateIngredient,
  updateIngredientCategory,
} from "@/src/lib/ingredient";
import { createSingleFlight } from "@/src/lib/singleFlight";
import type {
  AdjustStockInput,
  Ingredient,
  IngredientCategory,
  IngredientInput,
} from "@/src/types/ingredient";

/**
 * Owns the inventory data and every write against it, so a screen only decides
 * what to render. Each mutation reloads from the server rather than patching
 * local state: a restock also flips menu availability and can write an expense,
 * so the row that comes back is the only one that reflects all of it.
 */
export function useInventoryData(canView: boolean) {
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [categories, setCategories] = useState<IngredientCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const alive = useRef(true);

  // Every write goes through its own single-flight gate, so a double tap on a
  // phone cannot post the same restock twice — the API has no idempotency key.
  const writeOnce = useRef(createSingleFlight());

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    if (!canView) {
      setLoading(false);
      return;
    }
    const [ingredientResponse, categoryResponse] = await Promise.all([
      listIngredients(),
      listIngredientCategories(),
    ]);
    if (!alive.current) return;
    setIngredients(ingredientResponse.data.ingredients ?? []);
    setCategories(categoryResponse.data.categories ?? []);
  }, [canView]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      try {
        await reload();
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [reload]);

  const run = useCallback(
    async <T,>(action: () => Promise<T>): Promise<T | undefined> => {
      const result = await writeOnce.current(action);
      await reload();
      return result;
    },
    [reload],
  );

  const actions = useMemo(
    () => ({
      restock: (id: number, input: AdjustStockInput) => run(() => adjustStock(id, input)),
      create: (input: IngredientInput) => run(() => createIngredient(input)),
      update: (id: number, input: IngredientInput) => run(() => updateIngredient(id, input)),
      remove: (id: number) => run(() => deleteIngredient(id)),
      createCategory: (name: string) => run(() => createIngredientCategory({ name })),
      renameCategory: (id: number, name: string) => run(() => updateIngredientCategory(id, { name })),
      removeCategory: (id: number) => run(() => deleteIngredientCategory(id)),
      /**
       * There is no bulk-create endpoint — this posts one row at a time and
       * reports each row's own outcome, so a failure names the row that failed
       * instead of a bare count. Rows that succeeded before a failure stay
       * created; the server has no transaction spanning them.
       */
      createMany: async (rows: IngredientInput[]) => {
        const results = await Promise.allSettled(rows.map((row) => createIngredient(row)));
        await reload();
        return results.map((result, index) => ({
          name: rows[index].name,
          ok: result.status === "fulfilled",
          error:
            result.status === "rejected"
              ? String(
                  (result.reason as { response?: { data?: { error?: string } } })?.response?.data
                    ?.error ?? "",
                )
              : "",
        }));
      },
    }),
    [run, reload],
  );

  return { ingredients, categories, loading, reload, actions };
}

/** Ingredient counts per category, for the category management screen. */
export function categoryUsage(ingredients: Ingredient[]) {
  const counts = new Map<number, { count: number; value: number }>();
  for (const item of ingredients) {
    const key = item.category_id ?? 0;
    const entry = counts.get(key) ?? { count: 0, value: 0 };
    entry.count += 1;
    entry.value += item.stock * item.cost_per_unit;
    counts.set(key, entry);
  }
  return counts;
}
