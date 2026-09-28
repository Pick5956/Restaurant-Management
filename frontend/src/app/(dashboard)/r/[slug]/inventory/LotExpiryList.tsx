"use client";

import { useState } from "react";
import type { Ingredient, IngredientLot } from "@/src/types/ingredient";
import ExpiryChips from "./ExpiryChips";
import { daysUntil, expiryCopy, expiryState, formatExpiryDate } from "./inventoryExpiryUtils";
import { formatInPacks } from "./inventoryUnitUtils";

type LotItem = Pick<Ingredient, "unit" | "storage_type" | "pack_unit" | "pack_size" | "case_unit" | "case_size">;

/**
 * The open lots of one ingredient, each with its own expiry date and an
 * editor. An ingredient has no single expiry — every receipt has its own.
 * The history drawer shows the full card (received date, discard); the edit
 * drawer passes `compact` for one line per lot: the date and a change button,
 * plus the amount only when there is more than one lot to tell apart.
 * `onSave` resolves true when the date was saved, which closes the editor.
 */
export default function LotExpiryList({
  lots,
  item,
  lang,
  canManage,
  saving,
  cancelLabel,
  compact = false,
  onSave,
  onDiscard,
}: {
  lots: IngredientLot[];
  item: LotItem;
  lang: "th" | "en";
  canManage: boolean;
  saving: boolean;
  cancelLabel: string;
  compact?: boolean;
  onSave: (lot: IngredientLot, days: number | null) => Promise<boolean>;
  onDiscard?: (lot: IngredientLot) => void;
}) {
  const xcopy = expiryCopy(lang);
  const short =
    lang === "th"
      ? { change: "เปลี่ยน", save: "บันทึก", expired: "หมดแล้ว", none: "ไม่ระบุ" }
      : { change: "Change", save: "Save", expired: "Expired", none: "Not set" };
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draftDays, setDraftDays] = useState<number | null>(null);

  function startEditing(lot: IngredientLot) {
    setEditingId(lot.ID);
    setDraftDays(lot.expires_at ? daysUntil(lot.expires_at) : null);
  }

  function editor(lot: IngredientLot) {
    return (
      <div className="mt-3">
        <ExpiryChips key={lot.ID} value={draftDays} onChange={setDraftDays} storageType={item.storage_type} lang={lang} />
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
            {compact ? short.save : xcopy.saveExpiry}
          </button>
        </div>
      </div>
    );
  }

  if (compact) {
    return (
      <div className="divide-y divide-slate-200 rounded-md border border-slate-200 dark:divide-gray-800 dark:border-gray-800">
        {lots.map((lot) => {
          const state = expiryState(lot.expires_at);
          const editing = editingId === lot.ID;
          const tone =
            state === "expired"
              ? "text-red-500 dark:text-red-400"
              : state === "soon"
                ? "text-amber-600 dark:text-amber-400"
                : "text-slate-900 dark:text-white";
          return (
            <div key={lot.ID} className="px-3 py-2.5">
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-semibold ${tone}`}>
                    {!lot.expires_at
                      ? short.none
                      : state === "expired"
                        ? `${short.expired} ${formatExpiryDate(lot.expires_at, lang)}`
                        : formatExpiryDate(lot.expires_at, lang)}
                    {lot.expires_at && state !== "expired" ? (
                      <span className="ml-1.5 text-xs font-normal text-slate-400">
                        ({xcopy.inDays(daysUntil(lot.expires_at))})
                      </span>
                    ) : null}
                  </p>
                  {lots.length > 1 ? (
                    <p className="text-xs text-slate-400">{formatInPacks(item, lot.remaining, lang)}</p>
                  ) : null}
                </div>
                {canManage && !editing ? (
                  <button
                    type="button"
                    onClick={() => startEditing(lot)}
                    className="shrink-0 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 dark:border-gray-700 dark:text-slate-300 dark:hover:bg-gray-800"
                  >
                    {short.change}
                  </button>
                ) : null}
              </div>
              {canManage && editing ? editor(lot) : null}
            </div>
          );
        })}
      </div>
    );
  }

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
                {formatInPacks(item, lot.remaining, lang)}
              </p>
            </div>
            {canManage && (
              <div className="mt-2">
                {editing ? (
                  editor(lot)
                ) : (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => startEditing(lot)}
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
