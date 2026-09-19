"use client";

import { useLayoutEffect, useRef } from "react";

export type InventoryView = "stock" | "history";

// The stock / history switch (19 ก.ย. 2569: the owner asked for movement when
// changing between the two). A dark thumb slides from the view you left to the
// one you chose. The switch lives in a different toolbar for each view, so it
// is mounted anew on every change: it places the thumb over `previous`, forces
// a layout, then moves it to `tab` with the transition on.
//
// Placed by hand rather than through state and a later animation frame: a
// frame never comes while the tab is in the background, and the thumb was
// left sitting on the view you had just left.
export default function InventoryViewTabs({
  tab,
  previous,
  onChange,
  lang,
}: {
  tab: InventoryView;
  previous: InventoryView;
  onChange: (next: InventoryView) => void;
  lang: "th" | "en";
}) {
  const buttons = useRef<Record<InventoryView, HTMLButtonElement | null>>({ stock: null, history: null });
  const thumbRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const thumb = thumbRef.current;
    const to = buttons.current[tab];
    if (!thumb || !to) return;
    const from = previous !== tab ? buttons.current[previous] : null;
    thumb.classList.remove("is-moving");
    if (from) {
      thumb.style.left = `${from.offsetLeft}px`;
      thumb.style.width = `${from.offsetWidth}px`;
      // Commit the starting place before the transition is switched on.
      void thumb.offsetWidth;
      thumb.classList.add("is-moving");
    }
    thumb.style.left = `${to.offsetLeft}px`;
    thumb.style.width = `${to.offsetWidth}px`;
    thumb.style.opacity = "1";
  }, [previous, tab, lang]);

  const label = (view: InventoryView) =>
    view === "stock" ? (lang === "th" ? "สต๊อกปัจจุบัน" : "Stock") : lang === "th" ? "ประวัติทั้งคลัง" : "History";

  return (
    <div
      role="tablist"
      className="relative flex h-9 w-fit shrink-0 items-center gap-0.5 rounded-xl border border-slate-200 bg-white p-[3px] shadow-(--dashboard-control-shadow) dark:border-gray-800 dark:bg-gray-900"
    >
      <span
        ref={thumbRef}
        aria-hidden="true"
        className="inv-tab-thumb absolute top-[3px] bottom-[3px] rounded-lg bg-slate-900 opacity-0 dark:bg-white"
      />
      {(["stock", "history"] as const).map((view) => {
        const on = view === tab;
        return (
          <button
            key={view}
            ref={(node) => {
              buttons.current[view] = node;
            }}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(view)}
            className={`relative z-[1] inline-flex h-7 items-center rounded-lg px-3 text-[12px] font-semibold transition-colors duration-200 ${
              on
                ? "text-white dark:text-slate-900"
                : "text-slate-500 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-gray-800"
            }`}
          >
            {label(view)}
          </button>
        );
      })}
    </div>
  );
}
