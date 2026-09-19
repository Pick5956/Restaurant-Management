"use client";

import { useState, type InputHTMLAttributes } from "react";

/**
 * A number box that can be emptied.
 *
 * The fields it replaces bound `value` straight to a number, so the text in
 * the box was always re-derived from that number. Deleting the last digit
 * turned the box into `0` on the spot — the person then typed 500 and got
 * "0500" — and a half-typed decimal like "0." parsed to 0 and vanished, so
 * 0.5 could not be entered at all.
 *
 * Here the text belongs to the box while someone is typing in it. The number
 * is reported whenever the text is a complete number; on blur an empty or
 * unfinished box settles to `emptyAs` and the text is rebuilt from the value.
 */
export default function NumberInput({
  value,
  onValue,
  min,
  max,
  emptyAs,
  blankWhenZero = false,
  onBlur,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type" | "min" | "max"> & {
  value: number;
  onValue: (value: number) => void;
  min?: number;
  max?: number;
  /** What an empty box means once it loses focus. Defaults to `min`, else 0. */
  emptyAs?: number;
  /** Show an empty box instead of "0" — for fields whose placeholder says 0. */
  blankWhenZero?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const clamp = (n: number) => {
    let next = n;
    if (min !== undefined) next = Math.max(min, next);
    if (max !== undefined) next = Math.min(max, next);
    return next;
  };
  const shown = draft ?? (blankWhenZero && !value ? "" : Number.isFinite(value) ? String(value) : "");

  return (
    <input
      {...rest}
      type="number"
      inputMode={rest.inputMode ?? "decimal"}
      min={min}
      max={max}
      value={shown}
      onChange={(event) => {
        const raw = event.target.value;
        setDraft(raw);
        const parsed = Number(raw);
        if (raw.trim() !== "" && Number.isFinite(parsed)) onValue(clamp(parsed));
      }}
      onBlur={(event) => {
        const raw = event.target.value.trim();
        const parsed = Number(raw);
        if (raw === "" || !Number.isFinite(parsed)) onValue(emptyAs ?? min ?? 0);
        setDraft(null);
        onBlur?.(event);
      }}
    />
  );
}
