"use client";

import { useId } from "react";

// The promotions dialog's schedule chips (PromotionDialog `Segmented`
// appearance="chips"), shared so the reservation sheet can wear the same look.
const choiceBase =
  "inline-flex h-9 items-center justify-center rounded-md border px-3 text-[13px] font-semibold transition-colors";
const choiceOn =
  "border-orange-500 bg-orange-50 text-gray-950 ring-1 ring-orange-500 dark:border-orange-500 dark:bg-orange-500/10 dark:text-white";
const choiceOff =
  "border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800";

/** A one-of-many choice drawn as chips; real radios keep arrow keys and focus native. */
export default function ChoiceChips<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  const name = useId();
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="grid gap-1.5"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((option) => (
        <label
          key={option.value}
          className={`${choiceBase} cursor-pointer has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-orange-700 dark:has-[:focus-visible]:outline-orange-400 ${
            value === option.value ? choiceOn : choiceOff
          }`}
        >
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            disabled={disabled}
            onChange={() => onChange(option.value)}
            className="sr-only"
          />
          {option.label}
        </label>
      ))}
    </div>
  );
}
