"use client";

import { useRef, useState } from "react";
import { CalendarDays } from "lucide-react";
import {
  daysUntil,
  expiryCopy,
  expiryDateFromDays,
  formatExpiryDate,
  formatShelfLife,
} from "./inventoryExpiryUtils";

const chipBase = "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12px] font-semibold transition";
const chipOn = "border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900";
const chipOff =
  "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700 dark:border-gray-700 dark:bg-gray-800 dark:text-slate-300 dark:hover:text-white";

/**
 * The restock form's expiry row: "ไม่ระบุ", three presets that fit how the
 * thing is kept, and "เลือกวันที่" for the date printed on the package. One
 * row, where the old picker had seven chips over two lines, and "กำหนดเอง"
 * (type a number of days) is gone — the date on the label is what people
 * actually have in hand. The value is still days from today.
 */
export default function RestockExpiryChips({
  value,
  onChange,
  presets,
  lang,
}: {
  value: number | null;
  onChange: (days: number | null) => void;
  presets: number[];
  lang: "th" | "en";
}) {
  const copy = expiryCopy(lang);
  const [byDate, setByDate] = useState(value !== null && !presets.includes(value));
  const dateRef = useRef<HTMLInputElement>(null);
  // A transparent date field only opens its calendar from its own icon in
  // Chrome, so the whole chip asks for the picker explicitly.
  const openPicker = () => {
    try {
      dateRef.current?.showPicker?.();
    } catch {
      dateRef.current?.focus();
    }
  };
  const today = expiryDateFromDays(0);
  const picked = value === null ? "" : expiryDateFromDays(value);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={() => {
          setByDate(false);
          onChange(null);
        }}
        className={`${chipBase} ${value === null ? chipOn : chipOff}`}
      >
        {copy.none}
      </button>
      {presets.map((days) => (
        <button
          key={days}
          type="button"
          onClick={() => {
            setByDate(false);
            onChange(days);
          }}
          className={`${chipBase} ${!byDate && value === days ? chipOn : chipOff}`}
        >
          {formatShelfLife(days, lang)}
        </button>
      ))}
      {byDate ? (
        // The chip turns into the date field itself, so the chosen date sits
        // where the choice was made instead of on a line of its own.
        <label className={`${chipBase} ${chipOn} relative cursor-pointer`}>
          <CalendarDays className="h-3.5 w-3.5" />
          {picked ? formatExpiryDate(picked, lang) : copy.byDate}
          <input
            ref={dateRef}
            type="date"
            min={today}
            onClick={openPicker}
            value={picked}
            onChange={(event) => {
              if (event.target.value) onChange(Math.max(0, daysUntil(event.target.value)));
            }}
            aria-label={copy.byDate}
            className="absolute inset-0 cursor-pointer opacity-0"
          />
        </label>
      ) : (
        <button
          type="button"
          onClick={() => {
            setByDate(true);
            if (value === null) onChange(presets[0]);
            // Straight to the calendar: the click that chose "เลือกวันที่" still
            // counts as the user gesture showPicker needs.
            requestAnimationFrame(openPicker);
          }}
          className={`${chipBase} ${chipOff}`}
        >
          <CalendarDays className="h-3.5 w-3.5" />
          {lang === "th" ? "เลือกวันที่" : "Pick a date"}
        </button>
      )}
    </div>
  );
}
