"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowRight, ArrowUp, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Download, RotateCcw, Search } from "lucide-react";
import { formatAdaptiveNumber as formatNumber, formatCurrency } from "@/src/lib/format";
import { exportTransactionsCSV, listAllTransactions } from "@/src/lib/ingredient";
import type { IngredientCategory, IngredientTransaction, TransactionQuery, TransactionType } from "@/src/types/ingredient";
import ThemedSelect from "@/src/components/shared/ThemedSelect";
import { useToast } from "@/src/components/shared/FeedbackProvider";
import { inputCls } from "./inventoryPageUtils";
import {
  HISTORY_PAGE_SIZE,
  HISTORY_RANGE_PRESETS,
  HISTORY_TYPES,
  defaultHistoryRange,
  formatHistoryRange,
  historyMovement,
  historyPageCount,
  historyRangeFor,
  historyRangeKeyOf,
  historyRangeLabel,
  historyTypeLabel,
} from "./inventoryHistoryUtils";

function buildCopy(lang: "th" | "en") {
  return lang === "th"
    ? {
        searchPlaceholder: "ค้นหาวัตถุดิบ",
        from: "ตั้งแต่",
        to: "ถึง",
        range: "ช่วงวันที่",
        allCategories: "ทุกหมวด",
        clear: "ล้างตัวกรอง",
        export: "ส่งออก CSV",
        exportFiltered: "เฉพาะที่กรองอยู่",
        exportAll: "ทั้งหมด",
        exporting: "กำลังสร้างไฟล์…",
        date: "วันที่",
        item: "วัตถุดิบ",
        type: "ประเภท",
        change: "จำนวน",
        amount: "ยอดเงิน",
        by: "ผู้ทำรายการ",
        note: "หมายเหตุ",
        setTo: "ตั้งเป็น",
        empty: "ไม่มีรายการในช่วงนี้",
        loading: "กำลังโหลด…",
        page: (current: number, last: number) => `หน้า ${current} / ${last}`,
        exported: "ดาวน์โหลดแล้ว",
        exportedRows: (n: number) => `${n} รายการ`,
        truncated: "ไฟล์ถูกตัด",
        truncatedDetail: (rows: number, total: number) =>
          `ได้ ${rows} จาก ${total} รายการ — แคบช่วงวันที่แล้วลองใหม่เพื่อให้ได้ครบ`,
        failed: "ส่งออกไม่สำเร็จ",
        loadFailed: "โหลดประวัติไม่สำเร็จ",
      }
    : {
        searchPlaceholder: "Search ingredient",
        from: "From",
        to: "To",
        range: "Date range",
        allCategories: "All categories",
        clear: "Clear filters",
        export: "Export CSV",
        exportFiltered: "Current filters only",
        exportAll: "Everything",
        exporting: "Preparing file…",
        date: "Date",
        item: "Ingredient",
        type: "Type",
        change: "Change",
        amount: "Amount",
        by: "By",
        note: "Note",
        setTo: "Set to",
        empty: "No movements in this period",
        loading: "Loading…",
        page: (current: number, last: number) => `Page ${current} / ${last}`,
        exported: "Downloaded",
        exportedRows: (n: number) => `${n} rows`,
        truncated: "File was capped",
        truncatedDetail: (rows: number, total: number) =>
          `Got ${rows} of ${total} rows — narrow the date range to export the rest`,
        failed: "Export failed",
        loadFailed: "Could not load the history",
      };
}

const typeChip: Record<TransactionType, { wrap: string; value: string; Icon: typeof ArrowUp }> = {
  in: {
    wrap: "bg-emerald-100 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-300",
    value: "text-emerald-600 dark:text-emerald-400",
    Icon: ArrowUp,
  },
  out: {
    wrap: "bg-red-100 text-red-600 dark:bg-red-950/40 dark:text-red-300",
    value: "text-red-500 dark:text-red-400",
    Icon: ArrowDown,
  },
  adjust: {
    wrap: "bg-slate-100 text-slate-500 dark:bg-gray-800 dark:text-slate-300",
    value: "text-slate-700 dark:text-slate-200",
    Icon: ArrowRight,
  },
};

export default function InventoryHistoryTab({
  categories,
  lang,
}: {
  categories: IngredientCategory[];
  lang: "th" | "en";
}) {
  const copy = useMemo(() => buildCopy(lang), [lang]);
  const { showToast } = useToast();
  const initialRange = useMemo(() => defaultHistoryRange(), []);

  const [from, setFrom] = useState(initialRange.from);
  const [to, setTo] = useState(initialRange.to);
  const [type, setType] = useState<TransactionType | "">("");
  const [categoryId, setCategoryId] = useState(0);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);

  const [rows, setRows] = useState<IngredientTransaction[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [rangeOpen, setRangeOpen] = useState(false);

  // Typing must not fire a request per keystroke; the rest of the filters apply
  // immediately because each one is a deliberate single click.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const query: TransactionQuery = useMemo(
    () => ({
      from,
      to,
      type,
      category_id: categoryId || undefined,
      search: debouncedSearch,
    }),
    [from, to, type, categoryId, debouncedSearch],
  );

  // A filter change must reset to page 1, or a narrowed result set can leave the
  // view parked on a page that no longer exists and looks empty.
  const filterKey = JSON.stringify(query);
  const lastFilterKey = useRef(filterKey);
  useEffect(() => {
    if (lastFilterKey.current !== filterKey) {
      lastFilterKey.current = filterKey;
      setPage(1);
    }
  }, [filterKey]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listAllTransactions({ ...query, page, limit: HISTORY_PAGE_SIZE })
      .then((response) => {
        if (cancelled) return;
        setRows(response.data.transactions ?? []);
        setTotal(response.data.total ?? 0);
      })
      .catch(() => {
        if (cancelled) return;
        setRows([]);
        setTotal(0);
        showToast({ title: copy.loadFailed, tone: "error" });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [query, page, copy.loadFailed, showToast]);

  const runExport = useCallback(
    async (scope: "filtered" | "all") => {
      setExportOpen(false);
      setExporting(true);
      try {
        const result = await exportTransactionsCSV(scope === "all" ? {} : query, lang);
        if (result.truncated) {
          showToast({
            title: copy.truncated,
            message: copy.truncatedDetail(result.rows, result.total),
            tone: "warning",
          });
        } else {
          showToast({ title: copy.exported, message: copy.exportedRows(result.rows) });
        }
      } catch {
        showToast({ title: copy.failed, tone: "error" });
      } finally {
        setExporting(false);
      }
    },
    [query, lang, copy, showToast],
  );

  const lastPage = historyPageCount(total, HISTORY_PAGE_SIZE);
  // Which preset the current range is, so the button and the chips agree about
  // what is selected without either of them owning the state.
  const rangeKey = historyRangeKeyOf(from, to);
  const filtersTouched =
    type !== "" || categoryId !== 0 || search !== "" || from !== initialRange.from || to !== initialRange.to;

  function resetFilters() {
    setFrom(initialRange.from);
    setTo(initialRange.to);
    setType("");
    setCategoryId(0);
    setSearch("");
  }

  return (
    <div className="space-y-4">
      {/* Two groups, not one long row with a spacer wedged in the middle. A
          `flex-1` spacer inside a wrapping row stays on the first line, which is
          what stranded the export button at the left of the second one. */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Narrower between the phone layout and lg, which is where an iPad in
            portrait sits: at the old widths the five controls came to more than
            the row and the export button was pushed onto a line of its own. */}
        <div className="relative w-full sm:w-48 lg:w-56">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder={copy.searchPlaceholder}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className={`${inputCls} !h-9 pl-7 pr-3`}
          />
        </div>

        <div className="relative shrink-0">
          <button
            type="button"
            aria-haspopup="dialog"
            aria-expanded={rangeOpen}
            aria-label={copy.range}
            onClick={() => setRangeOpen((open) => !open)}
            className={`inline-flex h-9 items-center justify-center gap-1.5 rounded-md border px-3 text-[12px] font-semibold transition ${
              rangeOpen || rangeKey !== "30d"
                ? "border-orange-300 bg-orange-50 text-orange-700 dark:border-orange-900/50 dark:bg-orange-950/30 dark:text-orange-300"
                : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-gray-800 dark:bg-gray-900 dark:text-slate-300 dark:hover:bg-gray-800"
            }`}
          >
            <CalendarDays className="h-4 w-4" />
            {formatHistoryRange(from, to, lang)}
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${rangeOpen ? "rotate-180" : ""}`} />
          </button>
          {rangeOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setRangeOpen(false)} />
              <div className="smooth-pop absolute left-0 top-full z-50 mt-2 w-80 origin-top-left rounded-md border border-slate-200 bg-white p-3 shadow-xl dark:border-gray-800 dark:bg-gray-900">
                {/* A four-column grid, not a wrapping row: the labels differ in
                    width per language and one of them kept falling to its own line. */}
                <div className="mb-3 grid grid-cols-4 gap-1.5">
                  {HISTORY_RANGE_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => {
                        const next = historyRangeFor(preset);
                        setFrom(next.from);
                        setTo(next.to);
                        setRangeOpen(false);
                      }}
                      className={`rounded-full border px-1 py-1 text-center text-[11.5px] font-semibold transition ${
                        rangeKey === preset
                          ? "border-orange-300 bg-orange-50 text-orange-700 dark:border-orange-900/50 dark:bg-orange-950/30 dark:text-orange-300"
                          : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700 dark:border-gray-700 dark:bg-gray-800 dark:text-slate-300 dark:hover:text-white"
                      }`}
                    >
                      {historyRangeLabel(preset, lang)}
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
                    <span className="w-10 shrink-0 text-[11px] text-slate-500 dark:text-slate-400">{copy.from}</span>
                    <input
                      type="date"
                      value={from}
                      max={to || undefined}
                      onChange={(event) => setFrom(event.target.value)}
                      className={`${inputCls} !h-8 min-w-0 flex-1 !px-2 text-[12px]`}
                    />
                  </label>
                  <label className="flex items-center gap-2">
                    <span className="w-10 shrink-0 text-[11px] text-slate-500 dark:text-slate-400">{copy.to}</span>
                    <input
                      type="date"
                      value={to}
                      min={from || undefined}
                      onChange={(event) => setTo(event.target.value)}
                      className={`${inputCls} !h-8 min-w-0 flex-1 !px-2 text-[12px]`}
                    />
                  </label>
                </div>
              </div>
            </>
          )}
        </div>

        <ThemedSelect
          aria-label={copy.type}
          compact
          className="w-28 lg:w-32"
          value={type}
          onChange={(value) => setType(value as TransactionType | "")}
          options={HISTORY_TYPES.map((option) => ({ value: option, label: historyTypeLabel(option, lang) }))}
        />

        <ThemedSelect
          aria-label={copy.allCategories}
          compact
          className="w-36 lg:w-40"
          value={String(categoryId)}
          onChange={(value) => setCategoryId(Number(value))}
          options={[
            { value: "0", label: copy.allCategories },
            ...categories.map((category) => ({ value: String(category.ID), label: category.name })),
          ]}
        />

        {filtersTouched && (
          <button
            type="button"
            onClick={resetFilters}
            className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-[12px] font-semibold text-slate-600 transition hover:bg-slate-50 dark:border-gray-800 dark:bg-gray-900 dark:text-slate-300 dark:hover:bg-gray-800"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {copy.clear}
          </button>
        )}

        <div className="relative ml-auto shrink-0">
          <button
            type="button"
            disabled={exporting}
            onClick={() => setExportOpen((open) => !open)}
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 text-[12px] font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-60 dark:border-gray-800 dark:bg-gray-900 dark:text-slate-300 dark:hover:bg-gray-800"
          >
            <Download className="h-4 w-4" />
            {exporting ? copy.exporting : copy.export}
          </button>
          {exportOpen && !exporting && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setExportOpen(false)} />
              <div className="smooth-pop absolute right-0 top-full z-50 mt-2 w-56 origin-top-right rounded-md border border-slate-200 bg-white p-1.5 shadow-xl dark:border-gray-800 dark:bg-gray-900">
                <button
                  type="button"
                  onClick={() => runExport("filtered")}
                  className="block w-full rounded px-3 py-2 text-left text-[13px] font-semibold text-slate-700 transition hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-gray-800"
                >
                  {copy.exportFiltered}
                </button>
                <button
                  type="button"
                  onClick={() => runExport("all")}
                  className="block w-full rounded px-3 py-2 text-left text-[13px] font-semibold text-slate-700 transition hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-gray-800"
                >
                  {copy.exportAll}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-gray-800 dark:bg-gray-900">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-400 dark:bg-gray-950/40 dark:text-slate-500">
              <tr>
                {/* The count belongs beside what it counts, the way the stock
                    tab reads "ชื่อวัตถุดิบ (28)". On the toolbar it was a result
                    sitting among the controls that produced it. */}
                <th className="whitespace-nowrap px-4 py-2.5 font-semibold">
                  {copy.date}{" "}
                  <span className="text-slate-500 dark:text-slate-300">({formatNumber(total, lang)})</span>
                </th>
                <th className="px-4 py-2.5 font-semibold">{copy.item}</th>
                <th className="px-4 py-2.5 font-semibold">{copy.type}</th>
                <th className="px-4 py-2.5 text-right font-semibold">{copy.change}</th>
                <th className="px-4 py-2.5 text-right font-semibold">{copy.amount}</th>
                <th className="px-4 py-2.5 font-semibold">{copy.by}</th>
                <th className="px-4 py-2.5 font-semibold">{copy.note}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-gray-800">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-400">
                    {copy.loading}
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-400">
                    {copy.empty}
                  </td>
                </tr>
              ) : (
                rows.map((tx) => {
                  const chip = typeChip[tx.type];
                  const movement = historyMovement(tx);
                  const at = tx.CreatedAt ? new Date(tx.CreatedAt) : null;
                  return (
                    <tr key={tx.ID}>
                      <td className="whitespace-nowrap px-4 py-3 text-[13px] text-slate-500 dark:text-slate-400">
                        {at ? (
                          <>
                            <span className="tabular-nums">{at.toLocaleDateString(lang === "th" ? "th-TH" : "en-US")}</span>
                            <span className="ml-2 text-[11px] tabular-nums text-slate-400">
                              {at.toLocaleTimeString(lang === "th" ? "th-TH" : "en-US", {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-semibold text-slate-900 dark:text-white">{tx.ingredient_name || "—"}</span>
                        {tx.category_name && (
                          <span className="ml-2 text-[11px] text-slate-400">{tx.category_name}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex h-6 items-center gap-1 rounded-full px-2 text-[11px] font-semibold ${chip.wrap}`}
                        >
                          <chip.Icon className="h-3 w-3" />
                          {historyTypeLabel(tx.type, lang)}
                        </span>
                      </td>
                      <td className={`whitespace-nowrap px-4 py-3 text-right text-[13px] font-semibold tabular-nums ${chip.value}`}>
                        {movement.setTo !== null ? (
                          <span className="text-slate-500 dark:text-slate-400">
                            <span className="mr-1 text-[10px] font-medium uppercase tracking-wide">{copy.setTo}</span>
                            {formatNumber(movement.setTo, lang)}
                          </span>
                        ) : (
                          <>
                            {movement.change !== null && movement.change > 0 ? "+" : ""}
                            {formatNumber(movement.change ?? 0, lang)}
                          </>
                        )}
                        <span className="ml-1 text-[10px] font-medium text-slate-400">{tx.ingredient_unit}</span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right text-[13px] tabular-nums text-slate-700 dark:text-slate-200">
                        {tx.amount > 0 ? formatCurrency(tx.amount, lang, 2) : "—"}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-[13px] text-slate-500 dark:text-slate-400">
                        {tx.created_by_name || "—"}
                      </td>
                      <td className="max-w-[280px] truncate px-4 py-3 text-[13px] text-slate-400" title={tx.note}>
                        {tx.note || "—"}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {lastPage > 1 && (
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            disabled={page <= 1 || loading}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-500 transition hover:bg-slate-50 disabled:opacity-40 dark:border-gray-800 dark:text-slate-300 dark:hover:bg-gray-800"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-[12px] tabular-nums text-slate-500 dark:text-slate-400">{copy.page(page, lastPage)}</span>
          <button
            type="button"
            disabled={page >= lastPage || loading}
            onClick={() => setPage((current) => Math.min(lastPage, current + 1))}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-500 transition hover:bg-slate-50 disabled:opacity-40 dark:border-gray-800 dark:text-slate-300 dark:hover:bg-gray-800"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
