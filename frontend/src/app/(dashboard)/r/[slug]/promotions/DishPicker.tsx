"use client";

import { useId, useMemo, useRef, useState } from "react";
import { Check, Search, X } from "lucide-react";
import { formatCurrency, type AppLanguage } from "@/src/lib/format";
import type { Category, MenuItem } from "@/src/types/menu";
import type { PromotionCopy } from "./promotionCopy";
import { targetLabel, type PromotionNames, type TargetRef } from "./promotionRules";

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

const sameRef = (a: TargetRef, b: TargetRef) => a.kind === b.kind && a.id === b.id;

/**
 * The dishes a promotion counts: chips for what is chosen, and a search list
 * of categories and dishes that opens in place. It expands inside the dialog
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

  const isChosen = (ref: TargetRef) => selected.some((item) => sameRef(item, ref));
  const toggle = (ref: TargetRef) =>
    onChange(isChosen(ref) ? selected.filter((item) => !sameRef(item, ref)) : [...selected, ref]);

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
      <div className="flex flex-wrap items-center gap-1.5">
        {selected.length === 0 ? (
          <span className={`text-[13px] ${invalid ? "text-red-600 dark:text-red-400" : "text-gray-500 dark:text-gray-400"}`}>{copy.nothingChosen}</span>
        ) : (
          selected.map((ref) => {
            const text = targetLabel(ref, names, language);
            return (
              <span
                key={`${ref.kind}-${ref.id}`}
                className="inline-flex max-w-full items-center gap-1 rounded-md border border-gray-200 bg-gray-50 py-1 pl-2 pr-1 text-[13px] font-medium text-gray-800 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
              >
                <span className="truncate">{text}</span>
                <button
                  type="button"
                  onClick={() => toggle(ref)}
                  aria-label={copy.removeTarget(text)}
                  className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-gray-500 transition-colors hover:bg-gray-200 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-white"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </span>
            );
          })
        )}
        <button
          ref={toggleRef}
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          aria-controls={listId}
          className="ui-press inline-flex h-8 items-center rounded-md border border-gray-200 bg-white px-2.5 text-[12px] font-semibold text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
        >
          {open ? copy.done : copy.choose}
        </button>
      </div>

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
