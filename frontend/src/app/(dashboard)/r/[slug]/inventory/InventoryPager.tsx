"use client";

import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { formatAdaptiveNumber as formatNumber } from "@/src/lib/format";

const arrowCls =
  "inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-500 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-800 dark:text-slate-300 dark:hover:bg-gray-800";

/** ‹ [ 3 / 12 ] › — one pager for the stock and history tabs. The page number
 *  and its total share one box as tall as the arrows, so the box sits evenly
 *  between them; the number is typed straight into it and Enter jumps there. */
export default function InventoryPager({
  page,
  totalPages,
  onChange,
  lang,
  disabled = false,
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
  lang: "th" | "en";
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-1">
      <button type="button" onClick={() => onChange(page - 1)} disabled={disabled || page <= 1} aria-label="previous page" className={arrowCls}>
        <ChevronLeft className="h-4 w-4" />
      </button>
      {/* A label, so a click anywhere in the box lands in the number. */}
      <label className="inline-flex h-8 cursor-text items-center gap-0.5 whitespace-nowrap rounded-md border border-slate-200 bg-white pl-2 pr-[11px] text-xs font-semibold tabular-nums transition focus-within:border-orange-400 focus-within:ring-2 focus-within:ring-orange-200 dark:border-gray-800 dark:bg-gray-900 dark:focus-within:ring-orange-900">
        <PageNumberInput page={page} totalPages={totalPages} onChange={onChange} disabled={disabled} />
        <span className="text-slate-400 dark:text-slate-500">/ {formatNumber(totalPages, lang)}</span>
      </label>
      <button type="button" onClick={() => onChange(page + 1)} disabled={disabled || page >= totalPages} aria-label="next page" className={arrowCls}>
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}

function PageNumberInput({
  page,
  totalPages,
  onChange,
  disabled,
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
  disabled: boolean;
}) {
  // What is being typed, or null when the box just shows the current page —
  // so an arrow press or a filter change is shown without syncing state.
  const [draft, setDraft] = useState<string | null>(null);
  // Esc blurs the box, and the blur would commit what was typed before the
  // cleared draft reaches it — this says the blur is a cancel.
  const cancelled = useRef(false);
  const shown = draft ?? String(page);

  function commit() {
    if (cancelled.current) {
      cancelled.current = false;
      setDraft(null);
      return;
    }
    const n = Number.parseInt(draft ?? "", 10);
    setDraft(null);
    if (Number.isNaN(n)) return;
    const next = Math.min(totalPages, Math.max(1, n));
    if (next !== page) onChange(next);
  }

  // The box is exactly as wide as what it shows, so the padding either side
  // of "3 / 12" stays even. A hidden copy of the text in the same grid cell
  // sets the width: "ch" is the width of this font's 0 and cut a Thai-font
  // digit in half, and an input on its own asks for ~20 characters. w-0 keeps
  // the input out of the sizing; min-w-full then stretches it over the copy.
  // The copy carries 3px either side because Chrome keeps that much room
  // around the caret, and scrolls the digit sideways without it — which is
  // also why the box has pl-2 against pr-[11px].
  return (
    <span className="inline-grid">
      <span aria-hidden="true" className="invisible col-start-1 row-start-1 whitespace-pre px-[3px]">
        {shown || " "}
      </span>
      <input
        type="text"
        inputMode="numeric"
        aria-label="page number"
        value={shown}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value.replace(/\D/g, ""))}
        onFocus={(e) => {
          setDraft(String(page));
          e.target.select();
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            cancelled.current = true;
            e.currentTarget.blur();
          }
        }}
        className="col-start-1 row-start-1 w-0 min-w-full bg-transparent p-0 text-center text-slate-700 outline-none disabled:opacity-60 dark:text-slate-200"
      />
    </span>
  );
}
