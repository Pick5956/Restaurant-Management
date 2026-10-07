"use client";

import { useId, useMemo, useState } from "react";

type Option = { value: string; label: string };

/**
 * "+ เพิ่มวัตถุดิบ" for a recipe: a box to type in, with the matches listed
 * under it (owner, 29 ก.ย. 2569: a long ingredient list could only be scrolled).
 * Typing filters; a click, or Enter on the highlighted row, adds it and clears
 * the box for the next one. The list opens in the flow of the recipe box rather
 * than floating, so the box's own edge never cuts it off.
 */
export default function RecipeIngredientPicker({
  options,
  placeholder,
  ariaLabel,
  emptyText,
  onPick,
}: {
  options: Option[];
  placeholder: string;
  ariaLabel: string;
  emptyText: string;
  onPick: (value: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? options.filter((option) => option.label.toLowerCase().includes(needle)) : options;
  }, [options, query]);

  const pick = (option: Option | undefined) => {
    if (!option) return;
    onPick(option.value);
    setQuery("");
    setActive(0);
  };

  return (
    <div>
      <input
        type="text"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && matches[active] ? `${listId}-${active}` : undefined}
        value={query}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        // Held open through a click on a row: the row's mousedown keeps focus.
        onBlur={() => setOpen(false)}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
            setActive((index) => Math.min(index + 1, Math.max(matches.length - 1, 0)));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((index) => Math.max(index - 1, 0));
          } else if (event.key === "Enter") {
            if (open && matches[active]) {
              event.preventDefault();
              pick(matches[active]);
            }
          } else if (event.key === "Escape") {
            setOpen(false);
          }
        }}
        className="h-10 w-full rounded-md border border-gray-200 bg-white px-3 text-[14px] leading-[1.6] text-gray-900 outline-none transition-colors placeholder:text-gray-500 focus:border-orange-500 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:placeholder:text-gray-400"
      />
      {open ? (
        <ul
          id={listId}
          role="listbox"
          aria-label={ariaLabel}
          className="dropdown-scroll mt-1 max-h-60 overflow-auto rounded-md border border-gray-200 bg-white py-1 dark:border-gray-700 dark:bg-gray-900"
        >
          {matches.length ? (
            matches.map((option, index) => (
              <li
                key={option.value}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === active}
                onMouseDown={(event) => {
                  event.preventDefault();
                  pick(option);
                }}
                onMouseEnter={() => setActive(index)}
                className={`cursor-pointer truncate px-3 py-2 text-[14px] leading-[1.6] text-gray-900 dark:text-white ${
                  index === active ? "bg-black/[0.05] dark:bg-white/[0.08]" : ""
                }`}
              >
                {option.label}
              </li>
            ))
          ) : (
            <li className="px-3 py-2 text-[14px] text-gray-500 dark:text-gray-400">{emptyText}</li>
          )}
        </ul>
      ) : null}
    </div>
  );
}
