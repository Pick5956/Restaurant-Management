"use client";

import { useState } from "react";
import type { IngredientLot } from "@/src/types/ingredient";
import ExpiryChips from "./ExpiryChips";
import { daysUntil, expiryCopy, expiryState, formatExpiryDate } from "./inventoryExpiryUtils";
import { formatAdaptiveNumber as formatNumber } from "@/src/lib/format";

/**
 * The open lots of one ingredient, each with its own expiry date and a
 * "ตั้งวันหมดอายุ" editor. Shown in both the history drawer and the edit
 * drawer — an ingredient has no single expiry, every receipt has its own.
 * `onSave` resolves true when the date was saved, which closes the editor.
 */
export default function LotExpiryList({
  lots,
  unit,
  storageType,
  lang,
  canManage,
  saving,
  cancelLabel,
  onSave,
  onDiscard,
}: {
  lots: IngredientLot[];
  unit: string;
  storageType?: string | null;
  lang: "th" | "en";
  canManage: boolean;
  saving: boolean;
  cancelLabel: string;
  onSave: (lot: IngredientLot, days: number | null) => Promise<boolean>;
  onDiscard?: (lot: IngredientLot) => void;
}) {
  const xcopy = expiryCopy(lang);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draftDays, setDraftDays] = useState<number | null>(null);

  return (
    <div className="space-y-2">
      {lots.map((lot) => {
        const state = expiryState(lot.expires_at);
        const editing = editingId === lot.ID;
        return (
          <div
            key={lot.ID}
            className="rounded-md border border-slate-200 bg-white px-3 py-3 dark:border-gray-800 dark:bg-gray-900"
          >
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p
                  className={`text-sm font-semibold ${
                    state === "expired"
                      ? "text-red-500 dark:text-red-400"
                      : state === "soon"
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-slate-900 dark:text-white"
                  }`}
                >
                  {lot.expires_at
                    ? state === "expired"
                      ? xcopy.expiredOn(formatExpiryDate(lot.expires_at, lang))
                      : xcopy.expiresOn(formatExpiryDate(lot.expires_at, lang))
                    : xcopy.noExpiry}
                  {lot.expires_at && state !== "expired" ? (
                    <span className="ml-1.5 text-xs font-normal text-slate-400">
                      {xcopy.inDays(daysUntil(lot.expires_at))}
                    </span>
                  ) : null}
                </p>
                <p className="text-xs text-slate-400">{xcopy.lotReceived(formatExpiryDate(lot.received_at, lang))}</p>
              </div>
              <p className="shrink-0 text-sm font-semibold tabular-nums text-slate-700 dark:text-slate-200">
                {formatNumber(lot.remaining, lang)} <span className="text-[10px] font-normal text-slate-400">{unit}</span>
              </p>
            </div>
            {canManage && (
              <div className="mt-2">
                {editing ? (
                  <>
                    <ExpiryChips
                      key={lot.ID}
                      value={draftDays}
                      onChange={setDraftDays}
                      storageType={storageType}
                      lang={lang}
                    />
                    <div className="mt-2 flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="rounded-md px-3 py-1.5 text-xs font-semibold text-slate-500 transition hover:bg-slate-100 dark:hover:bg-gray-800"
                      >
                        {cancelLabel}
                      </button>
                      <button
                        type="button"
                        disabled={saving}
                        onClick={async () => {
                          if (await onSave(lot, draftDays)) setEditingId(null);
                        }}
                        className="rounded-md bg-orange-700 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-orange-800 disabled:opacity-50"
                      >
                        {xcopy.saveExpiry}
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(lot.ID);
                        setDraftDays(lot.expires_at ? daysUntil(lot.expires_at) : null);
                      }}
                      className="rounded-md border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 dark:border-gray-700 dark:text-slate-300 dark:hover:bg-gray-800"
                    >
                      {xcopy.setExpiry}
                    </button>
                    {onDiscard ? (
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => onDiscard(lot)}
                        className="rounded-md border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/30"
                      >
                        {xcopy.discard}
                      </button>
                    ) : null}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
