"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowRight, ArrowUp, MoreHorizontal } from "lucide-react";
import { formatAdaptiveNumber as formatNumber, formatCurrency } from "@/src/lib/format";
import { listTransactions } from "@/src/lib/ingredient";
import type { Ingredient, IngredientTransaction } from "@/src/types/ingredient";
import { formatDaysLeft, getStatus, getStockPercent } from "../inventoryPageUtils";
import { historyMovement } from "../inventoryHistoryUtils";
import { PrimaryButton, ScreenNav, SecondaryButton, TAP } from "./primitives";
import { statusTone, thaiShortDate } from "./inventoryMobileUtils";

export default function IngredientDetailScreen({
  item,
  lang,
  canManage,
  onBack,
  onRestock,
  onCount,
  onEdit,
  onDelete,
  sheet,
}: {
  item: Ingredient;
  lang: "th" | "en";
  canManage: boolean;
  onBack: () => void;
  onRestock: () => void;
  onCount: () => void;
  onEdit: () => void;
  onDelete: () => void;
  sheet?: ReactNode;
}) {
  const copy = useMemo(
    () =>
      lang === "th"
        ? {
            minimum: "ขั้นต่ำ",
            full: "เต็มหลอด",
            value: "มูลค่าคงเหลือ",
            price: "ราคา/หน่วย",
            category: "หมวดหมู่",
            counted: "นับล่าสุด",
            never: "ยังไม่เคยนับ",
            restock: "เติมสต็อก",
            count: "ปรับยอด",
            movements: "ประวัติการเคลื่อนไหว",
            empty: "ยังไม่มีการเคลื่อนไหว",
            noCategory: "ไม่มีหมวด",
            noUsage: "ยังไม่มีข้อมูลการใช้",
            edit: "แก้ไข",
          }
        : {
            minimum: "Min",
            full: "Full",
            value: "Stock value",
            price: "Unit price",
            category: "Category",
            counted: "Last counted",
            never: "Never counted",
            restock: "Restock",
            count: "Set quantity",
            movements: "Movement history",
            empty: "No movements yet",
            noCategory: "Uncategorised",
            noUsage: "No usage data",
            edit: "Edit",
          },
    [lang],
  );

  const [rows, setRows] = useState<IngredientTransaction[]>([]);

  useEffect(() => {
    let active = true;
    listTransactions(item.ID, { limit: 20 })
      .then((response) => {
        if (active) setRows(response.data.transactions ?? []);
      })
      .catch(() => {
        if (active) setRows([]);
      });
    return () => {
      active = false;
    };
  }, [item.ID]);

  const tone = statusTone(getStatus(item), lang);
  const percent = getStockPercent(item);
  const cover = formatDaysLeft(item, lang);

  // "Last counted" is not a stored column — it is the newest absolute set, which
  // is exactly what a physical recount writes.
  const lastCounted = rows.find((row) => row.type === "adjust");

  return (
    <div data-inventory-mobile className="min-h-dvh bg-(--inv-canvas) text-(--inv-body) pb-8">
      <ScreenNav
        title={item.name}
        onBack={onBack}
        trailing={
          canManage ? (
            <button
              type="button"
              aria-label={copy.edit}
              onClick={onEdit}
              className={`ui-press flex h-11 w-11 items-center justify-center rounded-full text-(--inv-muted) ${TAP}`}
            >
              <MoreHorizontal className="h-5 w-5" strokeWidth={2} />
            </button>
          ) : null
        }
      />

      <div className="space-y-3 px-4 pt-3">
        <div className="rounded-(--inv-radius-lg) border border-(--inv-hairline) bg-(--inv-surface) p-4 shadow-(--inv-shadow)">
          <div className="flex items-baseline gap-2">
            <span className={`text-[40px] font-semibold leading-none tabular-nums ${tone.text}`}>
              {formatNumber(item.stock, lang)}
            </span>
            <span className="text-[15px] text-(--inv-muted)">{item.unit}</span>
            <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone.badge}`}>
              {tone.label}
            </span>
          </div>

          {percent === null ? (
            <p className="mt-3 text-[12px] text-(--inv-faint)">{copy.noUsage}</p>
          ) : (
            <>
              <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-(--inv-action-soft)">
                <div className={`h-full rounded-full ${tone.bar}`} style={{ width: `${percent}%` }} />
              </div>
              <div className="mt-1.5 flex items-center justify-between text-[11px] text-(--inv-faint)">
                <span>
                  {copy.minimum} {formatNumber(item.min_stock, lang)} {item.unit}
                </span>
                <span>{cover}</span>
              </div>
            </>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Stat label={copy.value} value={formatCurrency(item.stock * item.cost_per_unit, lang)} />
          <Stat label={copy.price} value={`${formatCurrency(item.cost_per_unit, lang, 2)} / ${item.unit}`} />
          <Stat label={copy.category} value={item.category?.name ?? copy.noCategory} />
          <Stat
            label={copy.counted}
            value={
              lastCounted?.CreatedAt
                ? thaiShortDate(new Date(lastCounted.CreatedAt), lang)
                : copy.never
            }
          />
        </div>

        {canManage && (
          <div className="flex gap-2">
            <PrimaryButton onClick={onRestock}>{copy.restock}</PrimaryButton>
            <SecondaryButton onClick={onCount}>{copy.count}</SecondaryButton>
          </div>
        )}

        <p className="pt-2 text-[11px] font-semibold uppercase tracking-wide text-(--inv-muted)">
          {copy.movements}
        </p>

        {rows.length === 0 ? (
          <p className="py-8 text-center text-[13px] text-(--inv-faint)">{copy.empty}</p>
        ) : (
          <div className="overflow-hidden rounded-(--inv-radius-lg) border border-(--inv-hairline) bg-(--inv-surface)">
            {rows.map((row, index) => {
              const movement = historyMovement(row);
              const at = row.CreatedAt ? new Date(row.CreatedAt) : null;
              const Icon = row.type === "in" ? ArrowUp : row.type === "out" ? ArrowDown : ArrowRight;
              const iconTone =
                row.type === "in"
                  ? "bg-(--inv-ok-soft) text-(--inv-ok)"
                  : row.type === "out"
                    ? "bg-(--inv-out-soft) text-(--inv-out)"
                    : "bg-(--inv-surface-strong) text-(--inv-muted)";
              return (
                <div
                  key={row.ID}
                  className={`flex items-center gap-3 px-3 py-3 ${
                    index > 0 ? "border-t border-(--inv-hairline)" : ""
                  }`}
                >
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${iconTone}`}>
                    <Icon className="h-4 w-4" strokeWidth={2} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] text-(--inv-heading)">
                      {at ? thaiShortDate(at, lang) : "—"}
                      {at && (
                        <span className="ml-2 text-[11px] tabular-nums text-(--inv-faint)">
                          {at.toLocaleTimeString(lang === "th" ? "th-TH" : "en-US", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      )}
                    </p>
                    {/* Same reason as the whole-inventory history: the note is
                        why the stock moved, and on this screen it is the only
                        place a sale names the order it came from. */}
                    <p className="truncate text-[11px] text-(--inv-faint)" title={row.note}>
                      {row.note || row.created_by_name || "—"}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-[13px] font-semibold tabular-nums text-(--inv-heading)">
                      {movement.setTo !== null
                        ? `= ${formatNumber(movement.setTo, lang)}`
                        : `${(movement.change ?? 0) > 0 ? "+" : ""}${formatNumber(movement.change ?? 0, lang)}`}
                      <span className="ml-1 text-[11px] font-normal text-(--inv-faint)">{item.unit}</span>
                    </p>
                    <p className="text-[11px] tabular-nums text-(--inv-faint)">
                      {row.amount > 0 ? formatCurrency(row.amount, lang, 2) : "—"}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {canManage && (
        <button
          type="button"
          onClick={onDelete}
          className={`ui-press mt-6 w-full px-4 text-center text-[13px] font-semibold text-(--inv-out) ${TAP}`}
        >
          {lang === "th" ? "ลบวัตถุดิบ" : "Delete ingredient"}
        </button>
      )}

      {sheet}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-(--inv-radius) border border-(--inv-hairline) bg-(--inv-surface) px-3 py-2.5">
      <p className="text-[11px] text-(--inv-muted)">{label}</p>
      <p className="mt-0.5 truncate text-[15px] font-semibold tabular-nums text-(--inv-heading)">
        {value}
      </p>
    </div>
  );
}
