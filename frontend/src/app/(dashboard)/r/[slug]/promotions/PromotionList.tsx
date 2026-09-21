"use client";

import { Gift, Package, Percent, ReceiptText, type LucideIcon } from "lucide-react";
import type { AppLanguage } from "@/src/lib/format";
import type { Promotion, PromotionType } from "@/src/lib/promotion";
import type { PromotionCopy } from "./promotionCopy";
import {
  formatPromotionDate,
  promotionRuleSummary,
  promotionScheduleSummary,
  promotionStateAt,
  promotionTargetsSummary,
  type PromotionNames,
  type PromotionState,
} from "./promotionRules";

const TYPE_ICONS: Record<PromotionType, LucideIcon> = {
  buy_x_get_y: Gift,
  item_discount: Percent,
  bundle_price: Package,
  bill_discount: ReceiptText,
};

// A switched-off promotion shows no chip: its switch already says so.
const STATE_CHIP: Record<Exclude<PromotionState, "off">, string> = {
  running: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300",
  upcoming: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-300",
  waiting: "border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300",
  ended: "border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300",
};

type PromotionListProps = {
  promotions: Promotion[];
  names: PromotionNames;
  copy: PromotionCopy;
  language: AppLanguage;
  now: Date;
  switching: number | null;
  onEdit: (promotion: Promotion) => void;
  onToggle: (promotion: Promotion) => void;
};

/** One row per promotion: what it does, when, whether it is running now, and its switch. */
export default function PromotionList({ promotions, names, copy, language, now, switching, onEdit, onToggle }: PromotionListProps) {
  return (
    <ul className="divide-y divide-gray-100 dark:divide-gray-800">
      {promotions.map((promotion) => {
        const Icon = TYPE_ICONS[promotion.type];
        const state = promotionStateAt(promotion, now);
        const rule = promotionRuleSummary(promotion, language);
        const dishes = promotionTargetsSummary(promotion, names, language);
        return (
          <li key={promotion.ID} className="flex items-start gap-3 px-4 py-3.5 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/60">
            <span
              aria-hidden="true"
              className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-gray-200 bg-gray-50 text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 ${promotion.is_active ? "" : "opacity-50"}`}
            >
              <Icon className="h-4 w-4" />
            </span>
            <button
              type="button"
              onClick={() => onEdit(promotion)}
              aria-haspopup="dialog"
              aria-label={`${copy.edit}: ${promotion.name}`}
              className="min-w-0 flex-1 rounded-md text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-500"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className={`truncate text-[14px] font-semibold ${promotion.is_active ? "text-gray-950 dark:text-white" : "text-gray-500 dark:text-gray-400"}`}>
                  {promotion.name}
                </span>
                {state !== "off" ? (
                  <span className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold ${STATE_CHIP[state]}`}>
                    {state === "upcoming" ? copy.states.upcoming(formatPromotionDate(promotion.start_date, language, now)) : copy.states[state]}
                  </span>
                ) : null}
              </span>
              <span className={`mt-0.5 block truncate text-[13px] ${promotion.is_active ? "text-gray-700 dark:text-gray-200" : "text-gray-500 dark:text-gray-400"}`}>
                {dishes ? `${rule}, ${dishes}` : rule}
              </span>
              <span className="mt-0.5 block truncate text-[12px] text-gray-500 dark:text-gray-400">
                {promotionScheduleSummary(promotion, language, now)}
              </span>
            </button>
            <button
              type="button"
              role="switch"
              aria-checked={promotion.is_active}
              aria-label={copy.switchFor(promotion.name)}
              disabled={switching !== null}
              onClick={() => onToggle(promotion)}
              // Centred on the row: the text beside it runs to two or three
              // lines, and a switch pinned near the top looked misplaced.
              className={`relative inline-flex h-6 w-11 shrink-0 self-center rounded-full border-2 border-transparent transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500 disabled:cursor-wait ${
                promotion.is_active ? "bg-orange-500" : "bg-gray-200 dark:bg-gray-700"
              }`}
            >
              <span
                aria-hidden="true"
                className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ease-out ${
                  promotion.is_active ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
