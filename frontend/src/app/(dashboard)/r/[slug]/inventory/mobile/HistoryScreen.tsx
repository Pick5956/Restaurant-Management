"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ClipboardList, Download, Search } from "lucide-react";
import { formatAdaptiveNumber as formatNumber, formatCurrency } from "@/src/lib/format";
import { exportTransactionsCSV, listAllTransactions } from "@/src/lib/ingredient";
import type {
  IngredientCategory,
  IngredientTransaction,
  TransactionType,
} from "@/src/types/ingredient";
import { historyMovement, toDateInput } from "../inventoryHistoryUtils";
import { BottomSheet, ChipRow, ScreenNav, Segmented, TAP, inputBase } from "./primitives";
import { dayHeading } from "./inventoryMobileUtils";
import { PickerList } from "./AddIngredientScreen";

type Range = "7" | "30" | "all";

/**
 * The whole-inventory log as a grouped list. A table cannot survive a 390px
 * screen: the desktop version needs 860px and side-scrolls, which hides the
 * columns that carry the meaning.
 */
export default function HistoryScreen({
  lang,
  categories,
  onBack,
}: {
  lang: "th" | "en";
  categories: IngredientCategory[];
  onBack: () => void;
}) {
  const copy = useMemo(
    () =>
      lang === "th"
        ? {
            title: "ประวัติทั้งคลัง",
            search: "ค้นหาวัตถุดิบ",
            all: "ทั้งหมด",
            in: "เข้า",
            out: "ออก",
            adjust: "ปรับยอด",
            days7: "7 วัน",
            days30: "30 วัน",
            allTime: "ทั้งหมด",
            category: "หมวดหมู่",
            allCategories: "ทุกหมวด",
            items: "รายการ",
            received: "มูลค่ารับเข้า",
            empty: "ไม่พบการเคลื่อนไหว",
            emptyHint: "ลองขยายช่วงเวลาหรือล้างคำค้นหา",
            loading: "กำลังโหลด",
            pickCategory: "เลือกหมวดหมู่",
            exported: (n: number) => `ดาวน์โหลดแล้ว ${n} รายการ`,
            truncated: (rows: number, total: number) => `ได้ ${rows} จาก ${total} รายการ`,
            failed: "ส่งออกไม่สำเร็จ",
          }
        : {
            title: "Whole-inventory history",
            search: "Search ingredient",
            all: "All",
            in: "In",
            out: "Out",
            adjust: "Set",
            days7: "7 days",
            days30: "30 days",
            allTime: "All time",
            category: "Category",
            allCategories: "All categories",
            items: "movements",
            received: "Received value",
            empty: "No movements found",
            emptyHint: "Widen the period or clear the search",
            loading: "Loading",
            pickCategory: "Pick a category",
            exported: (n: number) => `Downloaded ${n} rows`,
            truncated: (rows: number, total: number) => `Got ${rows} of ${total} rows`,
            failed: "Export failed",
          },
    [lang],
  );

  const [type, setType] = useState<"all" | TransactionType>("all");
  const [range, setRange] = useState<Range>("30");
  const [categoryId, setCategoryId] = useState(0);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [rows, setRows] = useState<IngredientTransaction[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [picker, setPicker] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const from = useMemo(() => {
    if (range === "all") return undefined;
    const start = new Date();
    start.setDate(start.getDate() - (Number(range) - 1));
    return toDateInput(start);
  }, [range]);

  const query = useMemo(
    () => ({
      type: type === "all" ? ("" as const) : type,
      category_id: categoryId || undefined,
      search: debounced,
      from,
      to: range === "all" ? undefined : toDateInput(new Date()),
    }),
    [type, categoryId, debounced, from, range],
  );

  useEffect(() => {
    let alive = true;
    // 200 is the API's ceiling for one page. The summary counts below describe
    // exactly the rows on screen, never a wider set — a count that silently
    // covered more than the list would be unverifiable.
    const load = async () => {
      setLoading(true);
      try {
        const response = await listAllTransactions({ ...query, limit: 200 });
        if (!alive) return;
        setRows(response.data.transactions ?? []);
        setTotal(response.data.total ?? 0);
      } catch {
        if (!alive) return;
        setRows([]);
        setTotal(0);
      } finally {
        if (alive) setLoading(false);
      }
    };
    void load();
    return () => {
      alive = false;
    };
  }, [query]);

  const summary = useMemo(() => {
    let inCount = 0;
    let outCount = 0;
    let adjustCount = 0;
    let received = 0;
    for (const row of rows) {
      if (row.type === "in") inCount += 1;
      else if (row.type === "out") outCount += 1;
      else adjustCount += 1;
      if (row.amount > 0) received += row.amount;
    }
    return { inCount, outCount, adjustCount, received };
  }, [rows]);

  const grouped = useMemo(() => {
    const map = new Map<string, IngredientTransaction[]>();
    for (const row of rows) {
      const at = row.CreatedAt ? new Date(row.CreatedAt) : new Date();
      const key = toDateInput(at);
      const bucket = map.get(key) ?? [];
      bucket.push(row);
      map.set(key, bucket);
    }
    return Array.from(map.entries()).map(([key, items]) => ({
      key,
      date: new Date(`${key}T00:00:00`),
      items,
    }));
  }, [rows]);

  async function runExport() {
    try {
      const result = await exportTransactionsCSV(query, lang);
      setNote(result.truncated ? copy.truncated(result.rows, result.total) : copy.exported(result.rows));
    } catch {
      setNote(copy.failed);
    }
  }

  return (
    <div data-inventory-mobile className="min-h-dvh bg-(--inv-canvas) text-(--inv-body) pb-10">
      <ScreenNav
        title={copy.title}
        onBack={onBack}
        trailing={
          <button
            type="button"
            aria-label={copy.title}
            onClick={runExport}
            className={`ui-press flex h-11 w-11 items-center justify-center rounded-full text-(--inv-muted) ${TAP}`}
          >
            <Download className="h-5 w-5" strokeWidth={2} />
          </button>
        }
      />

      <div className="space-y-3 px-4 pt-3">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-(--inv-faint)"
            strokeWidth={2}
          />
          <input
            type="text"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={copy.search}
            className={`${inputBase} h-[52px] border-(--inv-hairline) pl-10`}
          />
        </div>

        <Segmented
          value={type}
          onChange={setType}
          options={[
            { value: "all", label: copy.all },
            { value: "in", label: copy.in },
            { value: "out", label: copy.out },
            { value: "adjust", label: copy.adjust },
          ]}
        />

        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            {/* Chips, not <input type="date">: the native Thai picker renders
                "4 Aug BE 2569", which nobody reads as a date. */}
            <ChipRow
              value={range}
              onChange={setRange}
              options={[
                { value: "7", label: copy.days7 },
                { value: "30", label: copy.days30 },
                { value: "all", label: copy.allTime },
              ]}
            />
          </div>
          <button
            type="button"
            onClick={() => setPicker(true)}
            className={`ui-press shrink-0 whitespace-nowrap rounded-full border px-3 py-2 text-[13px] font-semibold ${
              categoryId
                ? "border-(--inv-action) bg-(--inv-action-soft) text-(--inv-action)"
                : "border-(--inv-hairline) bg-(--inv-surface) text-(--inv-muted)"
            }`}
          >
            {categories.find((c) => c.ID === categoryId)?.name ?? copy.category}
          </button>
        </div>

        <div className="flex items-center justify-between gap-2 rounded-(--inv-radius) border border-(--inv-hairline) bg-(--inv-surface) px-3 py-2 text-[12px]">
          <span className="min-w-0 truncate text-(--inv-muted)">
            <span className="font-semibold tabular-nums text-(--inv-heading)">{rows.length}</span>{" "}
            {copy.items}
            {/* Counts only — quantities cannot be summed across กรัม, มล. and ฟอง. */}
            {type === "all" && summary.inCount > 0 && ` · ${copy.in} ${summary.inCount}`}
            {type === "all" && summary.outCount > 0 && ` · ${copy.out} ${summary.outCount}`}
            {type === "all" && summary.adjustCount > 0 && ` · ${copy.adjust} ${summary.adjustCount}`}
          </span>
          {summary.received > 0 && (
            <span className="shrink-0 font-semibold tabular-nums text-(--inv-heading)">
              {copy.received} {formatCurrency(summary.received, lang)}
            </span>
          )}
        </div>

        {note && <p className="text-[12px] text-(--inv-muted)">{note}</p>}
        {total > rows.length && (
          <p className="text-[11px] text-(--inv-faint)">
            {copy.truncated(rows.length, total)}
          </p>
        )}

        {loading ? (
          <p className="py-10 text-center text-[13px] text-(--inv-faint)">{copy.loading}</p>
        ) : rows.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-[15px] font-semibold text-(--inv-heading)">{copy.empty}</p>
            <p className="mt-1 text-[13px] text-(--inv-muted)">{copy.emptyHint}</p>
          </div>
        ) : (
          grouped.map((group) => (
            <div key={group.key}>
              <div className="mb-1.5 flex items-baseline justify-between px-1">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-(--inv-muted)">
                  {dayHeading(group.date, lang)}
                </p>
                <span className="text-[11px] tabular-nums text-(--inv-faint)">
                  {group.items.length}
                </span>
              </div>
              <div className="overflow-hidden rounded-(--inv-radius-lg) border border-(--inv-hairline) bg-(--inv-surface)">
                {group.items.map((row, index) => {
                  const movement = historyMovement(row);
                  const at = row.CreatedAt ? new Date(row.CreatedAt) : null;
                  const Icon =
                    row.type === "in" ? ArrowUp : row.type === "out" ? ArrowDown : ClipboardList;
                  const iconTone =
                    row.type === "in"
                      ? "bg-(--inv-ok-soft) text-(--inv-ok)"
                      : row.type === "out"
                        ? "bg-(--inv-out-soft) text-(--inv-out)"
                        : "bg-(--inv-surface-strong) text-(--inv-muted)";
                  const typeLabel =
                    row.type === "in" ? copy.in : row.type === "out" ? copy.out : copy.adjust;
                  return (
                    <div
                      key={row.ID}
                      className={`flex items-center gap-3 px-3 py-2.5 ${
                        index > 0 ? "border-t border-(--inv-hairline)" : ""
                      }`}
                    >
                      <span
                        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${iconTone}`}
                      >
                        <Icon className="h-4 w-4" strokeWidth={2} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[14px] font-medium text-(--inv-heading)">
                          {row.ingredient_name || "—"}
                          {at && (
                            <span className="ml-2 text-[11px] font-normal tabular-nums text-(--inv-faint)">
                              {at.toLocaleTimeString(lang === "th" ? "th-TH" : "en-US", {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                          )}
                        </p>
                        <p className="truncate text-[11px] text-(--inv-faint)">
                          {typeLabel}
                          {row.created_by_name ? ` · ${row.created_by_name}` : ""}
                        </p>
                        {/* The note answers "why did this stock move" — for a
                            sale it names the order and the dish — which is a
                            different question from "who did it", so it gets its
                            own line rather than replacing the person. Only rows
                            that have something to say grow taller. */}
                        {row.note && (
                          <p className="truncate text-[11px] text-(--inv-faint)" title={row.note}>
                            {row.note}
                          </p>
                        )}
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="whitespace-nowrap text-[13px] font-semibold tabular-nums text-(--inv-heading)">
                          {movement.setTo !== null
                            ? `= ${formatNumber(movement.setTo, lang)}`
                            : `${(movement.change ?? 0) > 0 ? "+" : ""}${formatNumber(movement.change ?? 0, lang)}`}
                          <span className="ml-1 text-[11px] font-normal text-(--inv-faint)">
                            {row.ingredient_unit}
                          </span>
                        </p>
                        <p className="whitespace-nowrap text-[11px] tabular-nums text-(--inv-faint)">
                          {row.amount > 0 ? formatCurrency(row.amount, lang, 2) : "—"}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>

      <BottomSheet open={picker} title={copy.pickCategory} onClose={() => setPicker(false)}>
        <PickerList
          options={[
            { value: 0, label: copy.allCategories },
            ...categories.map((c) => ({ value: c.ID, label: c.name })),
          ]}
          value={categoryId}
          onPick={(value) => {
            setCategoryId(value);
            setPicker(false);
          }}
        />
      </BottomSheet>
    </div>
  );
}
