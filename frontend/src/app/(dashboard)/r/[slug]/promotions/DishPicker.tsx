"use client";

import { useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search, Tags } from "lucide-react";
import { formatCurrency, type AppLanguage } from "@/src/lib/format";
import type { Category, MenuItem } from "@/src/types/menu";
import type { PromotionCopy } from "./promotionCopy";
import { menuCategoryIds } from "@/src/lib/menuUtils";
import { isTargetTicked, targetLabel, toggleTarget, type PromotionNames, type TargetRef } from "./promotionRules";

type DishPickerProps = {
  label: string;
  selected: TargetRef[];
  onChange: (next: TargetRef[]) => void;
  menus: MenuItem[];
  categories: Category[];
  names: PromotionNames;
  copy: PromotionCopy;
  language: AppLanguage;
  invalid?: boolean;
};

/**
 * The dishes a promotion counts: one line with how many categories and dishes
 * are chosen, and a search list of categories and dishes that opens in place. It expands inside the dialog
 * body instead of floating, so it never fights the dialog's own transform or
 * scroll (see the ThemedSelect-inside-a-transformed-modal gotcha).
 */
export default function DishPicker({ label, selected, onChange, menus, categories, names, copy, language, invalid }: DishPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const listId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const needle = query.trim().toLowerCase();

  const matchingCategories = useMemo(
    () => categories.filter((category) => !needle || category.name.toLowerCase().includes(needle)),
    [categories, needle],
  );
  const matchingMenus = useMemo(
    () => menus.filter((menu) => !needle || menu.name.toLowerCase().includes(needle)),
    [menus, needle],
  );

  const summary = copy.chosenSummary(
    selected.filter((ref) => ref.kind === "category").length,
    selected.filter((ref) => ref.kind === "menu").length,
  );

  const pickerMenus = useMemo(
    () => menus.map((menu) => ({ id: menu.ID, categoryIds: menuCategoryIds(menu) })),
    [menus],
  );
  const isChosen = (ref: TargetRef) => isTargetTicked(selected, ref, pickerMenus);
  const toggle = (ref: TargetRef) => onChange(toggleTarget(selected, ref, pickerMenus));

  const row = (ref: TargetRef, name: string, detail?: string) => {
    const chosen = isChosen(ref);
    return (
      <button
        key={`${ref.kind}-${ref.id}`}
        type="button"
        role="checkbox"
        aria-checked={chosen}
        onClick={() => toggle(ref)}
        className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[14px] text-gray-800 transition-colors hover:bg-gray-50 focus-visible:bg-gray-50 focus-visible:outline-none dark:text-gray-100 dark:hover:bg-gray-800 dark:focus-visible:bg-gray-800"
      >
        <span
          aria-hidden="true"
          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors ${
            chosen
              ? "border-orange-600 bg-orange-600 text-white dark:border-orange-500 dark:bg-orange-500"
              : "border-gray-300 bg-white dark:border-gray-600 dark:bg-gray-900"
          }`}
        >
          {chosen ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
        </span>
        <span className="min-w-0 flex-1 truncate">{name}</span>
        {detail ? <span className="shrink-0 font-mono text-[12px] tabular-nums text-gray-500 dark:text-gray-400">{detail}</span> : null}
      </button>
    );
  };

  return (
    <div>
      {/* One line that says how much is chosen; the list itself is where
          things are added and taken away. Chips for every pick used to fill
          five rows once a few categories and dishes were in. */}
      <button
        ref={toggleRef}
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-controls={listId}
        aria-label={`${label}, ${summary || copy.nothingChosen}`}
        className={`ui-press flex h-10 w-full items-center gap-2 rounded-md border bg-white px-3 text-left text-[14px] transition-colors hover:border-gray-300 dark:bg-gray-900 dark:hover:border-gray-600 ${
          invalid && !summary
            ? "border-red-400 dark:border-red-500/70"
            : open
              ? "border-orange-500 dark:border-orange-500"
              : "border-gray-200 dark:border-gray-700"
        }`}
      >
        <Tags className="h-4 w-4 shrink-0 text-gray-500 dark:text-gray-400" aria-hidden="true" />
        <span
          className={`min-w-0 flex-1 truncate ${
            summary ? "text-gray-900 dark:text-white" : invalid ? "text-red-600 dark:text-red-400" : "text-gray-500 dark:text-gray-400"
          }`}
        >
          {summary || copy.nothingChosen}
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-gray-500 transition-transform duration-200 dark:text-gray-400 ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>

      {open ? (
        <div id={listId} className="mt-2 rounded-md border border-gray-200 dark:border-gray-800">
          <label className="flex items-center gap-2 border-b border-gray-200 px-3 dark:border-gray-800">
            <Search className="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                // The list filters as you type, so Enter has nothing to do here -
                // and inside the dialog's <form> it would save the promotion
                // before the dish being searched for was picked.
                if (event.key === "Enter") {
                  event.preventDefault();
                  return;
                }
                if (event.key === "Escape") {
                  event.stopPropagation();
                  setOpen(false);
                  // The input unmounts with the panel; hand focus back to the
                  // button that opened it instead of dropping it on the page.
                  toggleRef.current?.focus();
                }
              }}
              placeholder={copy.search}
              aria-label={`${label}, ${copy.search}`}
              autoFocus
              className="h-10 w-full bg-transparent text-[16px] text-gray-900 outline-none placeholder:text-gray-400 dark:text-white sm:text-[14px]"
            />
          </label>
          <div className="max-h-64 overflow-y-auto overscroll-contain p-1.5">
            {matchingCategories.length === 0 && matchingMenus.length === 0 ? (
              <p className="px-2.5 py-6 text-center text-[13px] text-gray-500 dark:text-gray-400">{copy.noMatches}</p>
            ) : null}
            {matchingCategories.length > 0 ? (
              <div role="group" aria-label={copy.categories}>
                <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{copy.categories}</p>
                {matchingCategories.map((category) =>
                  row({ kind: "category", id: category.ID }, targetLabel({ kind: "category", id: category.ID }, names, language)),
                )}
              </div>
            ) : null}
            {matchingMenus.length > 0 ? (
              <div role="group" aria-label={copy.menus}>
                <p className="px-2.5 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">{copy.menus}</p>
                {matchingMenus.map((menu) =>
                  row({ kind: "menu", id: menu.ID }, menu.name, formatCurrency(menu.price, language, Number.isInteger(menu.price) ? 0 : 2)),
                )}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
