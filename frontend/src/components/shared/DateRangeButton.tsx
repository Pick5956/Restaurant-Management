"use client";

import { useState } from "react";
import { CalendarDays } from "lucide-react";
import DropdownChevron from "@/src/components/shared/DropdownChevron";

const fieldCls =
  "h-8 w-full min-w-0 flex-1 rounded-md border border-gray-200 bg-white px-2 text-[12px] text-gray-900 outline-none transition focus:border-orange-400 dark:border-gray-700 dark:bg-gray-900 dark:text-white";

/**
 * The date-range button from the inventory history: the range on the button,
 * preset chips and two date fields in the panel under it. The revenue page
 * uses the same one (26 ก.ย. 2569) instead of its row of dropdown, fields and
 * a "ดู" button.
 *
 * A preset applies and closes the panel; the fields apply as they change and
 * leave it open, so the second date can follow. `note` sits under the fields —
 * the revenue page puts why a typed range cannot be shown there.
 */
export default function DateRangeButton<K extends string>({
  label,
  ariaLabel,
  presets,
  activeKey,
  onPreset,
  from,
  to,
  onFrom,
  onTo,
  fromLabel,
  toLabel,
  maxDate,
  highlighted,
  note,
}: {
  /** What the button says: the range as it is now. */
  label: string;
  ariaLabel: string;
  presets: { key: K; label: string }[];
  /** The preset the range matches, or null for a hand-picked one. */
  activeKey: K | null;
  onPreset: (key: K) => void;
  from: string;
  to: string;
  onFrom: (value: string) => void;
  onTo: (value: string) => void;
  fromLabel: string;
  toLabel: string;
  /** The last day the fields allow, e.g. today. */
  maxDate?: string;
  /** Tinted when the range is not the page's default, so a changed range is noticed. */
  highlighted: boolean;
  note?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const fromMax = to && maxDate ? (to < maxDate ? to : maxDate) : to || maxDate || undefined;

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((current) => !current)}
        className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border px-3 text-[12px] font-semibold shadow-(--dashboard-control-shadow) transition ${
          open || highlighted
            ? "border-orange-300 bg-orange-50 text-orange-700 dark:border-orange-900/50 dark:bg-orange-950/30 dark:text-orange-300"
            : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-gray-800 dark:bg-gray-900 dark:text-slate-300 dark:hover:bg-gray-800"
        }`}
      >
        <CalendarDays className="h-4 w-4" />
        {label}
        <DropdownChevron open={open} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="smooth-pop absolute left-0 top-full z-50 mt-2 w-80 origin-top-left rounded-xl border border-slate-200 bg-white p-3 shadow-(--dashboard-control-shadow) dark:border-gray-800 dark:bg-gray-900">
            {/* A four-column grid, not a wrapping row: the labels differ in
                width per language and one of them kept falling to its own line. */}
            <div className="mb-3 grid grid-cols-4 gap-1.5">
              {presets.map((preset) => (
                <button
                  key={preset.key}
                  type="button"
                  onClick={() => {
                    onPreset(preset.key);
                    setOpen(false);
                  }}
                  className={`rounded-full border px-1 py-1 text-center text-[11.5px] font-semibold transition ${
                    activeKey === preset.key
                      ? "border-orange-300 bg-orange-50 text-orange-700 dark:border-orange-900/50 dark:bg-orange-950/30 dark:text-orange-300"
                      : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700 dark:border-gray-700 dark:bg-gray-800 dark:text-slate-300 dark:hover:text-white"
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            {/* The fields stay for the odd window a preset cannot express.
                Stacked, not side by side: a native date field is as wide as
                the locale makes it, and Safari in Thai renders "13 Aug BE
                2569" — half again what Chrome shows — which spilled the
                second field straight out of the panel. */}
            <div className="space-y-1.5">
              <label className="flex items-center gap-2">
                <span className="w-10 shrink-0 text-[11px] text-slate-500 dark:text-slate-400">{fromLabel}</span>
                <input type="date" value={from} max={fromMax} onChange={(event) => onFrom(event.target.value)} className={fieldCls} />
              </label>
              <label className="flex items-center gap-2">
                <span className="w-10 shrink-0 text-[11px] text-slate-500 dark:text-slate-400">{toLabel}</span>
                <input type="date" value={to} min={from || undefined} max={maxDate} onChange={(event) => onTo(event.target.value)} className={fieldCls} />
              </label>
            </div>
            {note && <div className="mt-2 text-[11.5px]">{note}</div>}
          </div>
        </>
      )}
    </div>
  );
}
