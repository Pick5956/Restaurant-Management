"use client";

import type { KeyboardEvent } from "react";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedControlProps<T extends string> {
  label: string;
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
}

/**
 * One choice out of a few, as a row. The chosen segment is filled with ink
 * (white in dark mode), the same treatment as the inventory tab switcher: the
 * white pill on a near-white track this replaced could not be told apart from
 * the options around it.
 */
export default function SegmentedControl<T extends string>({ label, value, options, onChange, disabled }: SegmentedControlProps<T>) {
  // Arrow keys move the choice, as they do in any radio group.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step || disabled) return;
    event.preventDefault();
    const index = options.findIndex((option) => option.value === value);
    const next = options[(index + step + options.length) % options.length];
    onChange(next.value);
    const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>("[role='radio']");
    buttons[options.indexOf(next)]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      className="grid gap-1 rounded-md border border-gray-200 bg-gray-100 p-1 dark:border-gray-800 dark:bg-gray-950"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={`ui-press h-10 min-w-0 truncate rounded-[4px] px-2 text-[13px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-orange-500/60 disabled:cursor-wait disabled:opacity-60 sm:h-9 ${
              selected
                ? "bg-gray-900 text-white shadow-sm dark:bg-white dark:text-gray-900"
                : "text-gray-600 hover:bg-white hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
