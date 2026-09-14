"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Plus, Printer } from "lucide-react";
import { useBackdropClose } from "@/src/hooks/useBackdropClose";
import { useRestaurantNav } from "@/src/hooks/useRestaurantNav";
import { useAuth } from "@/src/providers/AuthProvider";
import { useLanguage } from "@/src/providers/LanguageProvider";
import { can } from "@/src/lib/rbac";
import { loadSarabun } from "@/src/lib/sarabunFont";
import { apiErrorMessage } from "@/src/lib/apiErrors";
import { formatCurrency } from "@/src/lib/format";
import { toDashboardDate } from "@/src/lib/homeDashboard";
import { createRequestGeneration } from "@/src/lib/requestGeneration";
import {
  createExpense,
  deleteExpense,
  expenseCategories,
  listExpenses,
  updateExpense,
  type Expense,
  type ExpenseCategory,
  type ExpenseCategoryTotal,
} from "@/src/lib/expense";
import PermissionDenied from "@/src/components/shared/PermissionDenied";
import OperationalPageShell from "@/src/components/shared/OperationalPageShell";
import { Skeleton } from "@/src/components/shared/Skeleton";
import ThemedSelect from "@/src/components/shared/ThemedSelect";

type SortKey = "spent_at" | "category" | "note" | "amount" | "created_by";

type FormState = { restaurantId: number | null; id: number | null; category: ExpenseCategory; amount: string; spent_at: string; note: string };
type ExpensePageData = {
  restaurantId: number | null;
  expenses: Expense[];
  categories: ExpenseCategoryTotal[];
  total: number;
  entries: number;
  hasMore: boolean;
};

const EMPTY_EXPENSE_DATA: ExpensePageData = {
  restaurantId: null,
  expenses: [],
  categories: [],
  total: 0,
  entries: 0,
  hasMore: false,
};

// Category chips stay neutral so six of them don't compete for attention on one
// page; the category reads from a small colour dot instead. Dot hues sit within
// the app's palette — utilities/equipment were pulled back from the off-system
// violet/rose to indigo/red.
const categoryBadgeClass =
  "border-gray-200 bg-gray-50 text-gray-700 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-200";

const categoryDotClass: Record<ExpenseCategory, string> = {
  ingredient: "bg-emerald-500",
  labor: "bg-sky-500",
  rent: "bg-amber-500",
  utilities: "bg-indigo-500",
  equipment: "bg-red-500",
  other: "bg-gray-400",
};


// First entry doubles as the threshold for showing the pager at all.
const pageSizes = [10, 25, 50, 100];

function emptyForm(restaurantId: number | null): FormState {
  return { restaurantId, id: null, category: "ingredient", amount: "", spent_at: toDashboardDate(new Date()), note: "" };
}

export default function ExpensesPage() {
  const { activeMembership } = useAuth();
  const { language } = useLanguage();
  const { href: restaurantPageHref } = useRestaurantNav();
  const restaurantId = activeMembership?.restaurant_id ?? null;
  const canEdit = can(activeMembership, "manage_expenses");
  const canView = canEdit || can(activeMembership, "view_reports");

  const [data, setData] = useState<ExpensePageData>(EMPTY_EXPENSE_DATA);
  const [monthDate, setMonthDate] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [categoryFilter, setCategoryFilter] = useState<"all" | ExpenseCategory>("all");
  const [pageSize, setPageSize] = useState(pageSizes[0]);
  const [page, setPage] = useState(1);
  // Matches the server's "spent_at desc, id desc", so the first paint is
  // identical to the unsorted list.
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "spent_at", dir: "desc" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [storedForm, setForm] = useState<FormState>(() => emptyForm(restaurantId));
  const form = storedForm.restaurantId === restaurantId ? storedForm : emptyForm(restaurantId);
  const [savingRestaurantId, setSavingRestaurantId] = useState<number | null>(null);
  const saving = restaurantId !== null && savingRestaurantId === restaurantId;
  const [refreshTick, setRefreshTick] = useState(0);
  const [expenseRequests] = useState(createRequestGeneration);
  // The form lives in a dialog: one set of fields for both add and edit, opened
  // from the toolbar button or from the row being edited.
  const [formOpen, setFormOpen] = useState(false);
  const formBackdrop = useBackdropClose(() => setFormOpen(false));

  const openAdd = () => {
    setError("");
    setForm(emptyForm(restaurantId));
    setFormOpen(true);
  };

  const openEdit = (expense: Expense) => {
    setError("");
    setForm({
      restaurantId,
      id: expense.ID,
      category: expense.category,
      amount: String(expense.amount),
      spent_at: expense.spent_at.slice(0, 10),
      note: expense.note,
    });
    setFormOpen(true);
  };

  // Hand-off from the AI receipt scanner: if it stashed a draft expense and sent
  // the owner here, open the Add dialog pre-filled so they save it with the normal
  // form. One-shot (the stash is cleared) and inert when no draft is present.
  useEffect(() => {
    if (restaurantId == null || !canEdit) return;
    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem("ai_expense_prefill");
    } catch {
      return;
    }
    if (!raw) return;
    try {
      sessionStorage.removeItem("ai_expense_prefill");
    } catch {
      /* ignore */
    }
    try {
      const p = JSON.parse(raw) as { category?: string; amount?: number | string; spent_at?: string; note?: string };
      const category = (expenseCategories as readonly string[]).includes(p.category ?? "")
        ? (p.category as ExpenseCategory)
        : "other";
      const spent = p.spent_at && /^\d{4}-\d{2}-\d{2}$/.test(p.spent_at) ? p.spent_at : toDashboardDate(new Date());
      setError("");
      setForm({ restaurantId, id: null, category, amount: p.amount != null ? String(p.amount) : "", spent_at: spent, note: p.note ?? "" });
      setFormOpen(true);
    } catch {
      /* malformed stash — ignore */
    }
  }, [restaurantId, canEdit]);

  const copy = useMemo(
    () =>
      language === "th"
        ? {
            eyebrow: "Expenses",
            back: "กลับหน้าแดชบอร์ด",
            exportPdf: "บันทึกเป็น PDF",
            title: "บันทึกรายจ่าย",
            denied: "ไม่มีสิทธิ์ดูรายจ่าย",
            categories: { ingredient: "วัตถุดิบ", labor: "ค่าแรง", rent: "ค่าเช่า", utilities: "ค่าน้ำ/ไฟ", equipment: "อุปกรณ์", other: "อื่นๆ" } as Record<ExpenseCategory, string>,
            all: "ทั้งหมด",
            monthTotal: "รวมทั้งเดือน",
            exportError: "สร้างไฟล์ PDF ไม่สำเร็จ",
            perPage: "ต่อหน้า",
            month: "เดือน",
            previousPage: "หน้าก่อน",
            nextPage: "หน้าถัดไป",
            pageOf: (current: number, total: number) => `หน้า ${current} / ${total}`,
            entries: "รายการ",
            add: "เพิ่มรายจ่าย",
            edit: "แก้ไขรายจ่าย",
            category: "ประเภท",
            amount: "จำนวนเงิน",
            date: "วันที่จ่าย",
            note: "รายละเอียด",
            notePlaceholder: "เช่น ค่าหมู ร้านเจ๊แดง",
            save: "บันทึก",
            cancel: "ยกเลิก",
            deleteAction: "ลบ",
            confirmDelete: "ลบรายการนี้?",
            recordedBy: "บันทึกโดย",
            generatedStockIn: "สร้างอัตโนมัติจากการรับวัตถุดิบ",
            partialList: (shown: number, total: number) => `แสดงรายการล่าสุด ${shown} จากทั้งหมด ${total} รายการ`,
            empty: "ยังไม่มีรายจ่ายในเดือนนี้",
            loadError: "โหลดรายจ่ายไม่สำเร็จ",
            saveError: "บันทึกไม่สำเร็จ",
            amountRequired: "กรอกจำนวนเงินให้มากกว่า 0",
            readOnly: "คุณดูได้อย่างเดียว ไม่มีสิทธิ์แก้ไขรายจ่าย",
          }
        : {
            eyebrow: "Expenses",
            back: "Back to dashboard",
            exportPdf: "Export PDF",
            title: "Expense ledger",
            denied: "You do not have permission to view expenses.",
            categories: { ingredient: "Supplies", labor: "Wages", rent: "Rent", utilities: "Utilities", equipment: "Equipment", other: "Other" } as Record<ExpenseCategory, string>,
            all: "All",
            monthTotal: "Month total",
            exportError: "Could not create the PDF",
            perPage: "per page",
            month: "Month",
            previousPage: "Previous page",
            nextPage: "Next page",
            pageOf: (current: number, total: number) => `Page ${current} of ${total}`,
            entries: "entries",
            add: "Add expense",
            edit: "Edit expense",
            category: "Category",
            amount: "Amount",
            date: "Date paid",
            note: "Details",
            notePlaceholder: "e.g. pork from the market",
            save: "Save",
            cancel: "Cancel",
            deleteAction: "Delete",
            confirmDelete: "Delete this entry?",
            recordedBy: "Recorded by",
            generatedStockIn: "Generated from stock-in",
            partialList: (shown: number, total: number) => `Showing the latest ${shown} of ${total} entries.`,
            empty: "No expenses recorded this month.",
            loadError: "Could not load expenses.",
            saveError: "Could not save.",
            amountRequired: "Enter an amount greater than 0.",
            readOnly: "You have read-only access to expenses.",
          },
    [language],
  );
  const categoryOptions = useMemo(
    () => expenseCategories.map((value) => ({ value, label: copy.categories[value] })),
    [copy],
  );

  const locale = language === "th" ? "th-TH" : "en-US";
  const monthStart = toDashboardDate(monthDate);
  const monthEnd = toDashboardDate(new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0));
  const monthLabel = monthDate.toLocaleDateString(locale, { month: "short", year: "numeric" });
  const monthValue = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, "0")}`;
  // ponytail: a fixed two-year window back from today rather than the
  // restaurant's real first expense - the list endpoint never reports one.
  // Widen the count if anyone needs to look further back.
  const monthOptions = useMemo(
    () =>
      Array.from({ length: 24 }, (_, offset) => {
        const date = new Date(new Date().getFullYear(), new Date().getMonth() - offset, 1);
        return {
          value: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`,
          label: date.toLocaleDateString(locale, { month: "short", year: "numeric" }),
        };
      }),
    [locale],
  );
  const scopedData = canView && data.restaurantId === restaurantId ? data : EMPTY_EXPENSE_DATA;
  // Category totals come back month-wide even while a filter is on, so the "all"
  // chip sums them rather than reading scopedData.total, which tracks the
  // filtered rows and would collapse to one category's number.
  const monthTotal = scopedData.categories.reduce((sum, item) => sum + item.amount, 0);
  const sortedExpenses = useMemo(() => {
    const sortValue = (expense: Expense) => {
      switch (sort.key) {
        case "amount": return expense.amount;
        case "category": return copy.categories[expense.category];
        case "note": return expense.note || "";
        case "created_by": return expense.created_by ? `${expense.created_by.first_name} ${expense.created_by.last_name}`.trim() : "";
        default: return expense.spent_at;
      }
    };
    const direction = sort.dir === "asc" ? 1 : -1;
    return [...scopedData.expenses].sort((left, right) => {
      const leftValue = sortValue(left);
      const rightValue = sortValue(right);
      const compared = typeof leftValue === "number" && typeof rightValue === "number"
        ? leftValue - rightValue
        : String(leftValue).localeCompare(String(rightValue), locale);
      // Ties fall back to newest-first, the order the endpoint already returns.
      return compared !== 0 ? compared * direction : right.ID - left.ID;
    });
  }, [copy, locale, scopedData.expenses, sort]);

  // Clamped rather than reset, so a shrinking list cannot strand the view on a
  // page that no longer exists.
  const pageCount = Math.max(1, Math.ceil(scopedData.expenses.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visibleExpenses = sortedExpenses.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const load = useCallback(async () => {
    const requestedRestaurantId = restaurantId;
    if (!canView || requestedRestaurantId === null) {
      expenseRequests.invalidate();
      setData(EMPTY_EXPENSE_DATA);
      setLoading(false);
      return;
    }
    const requestGeneration = expenseRequests.begin();
    setLoading(true);
    setError("");
    try {
      const res = await listExpenses({
        from: monthStart,
        until: monthEnd,
        ...(categoryFilter === "all" ? {} : { category: categoryFilter }),
      });
      if (!expenseRequests.isCurrent(requestGeneration)) return;
      setData({
        restaurantId: requestedRestaurantId,
        expenses: res.data.expenses ?? [],
        categories: res.data.categories ?? [],
        total: res.data.total ?? 0,
        entries: res.data.entries ?? 0,
        hasMore: res.data.has_more ?? false,
      });
    } catch (err) {
      if (!expenseRequests.isCurrent(requestGeneration)) return;
      setError(apiErrorMessage(err) || copy.loadError);
    } finally {
      if (expenseRequests.isCurrent(requestGeneration)) setLoading(false);
    }
  }, [canView, categoryFilter, copy.loadError, expenseRequests, monthEnd, monthStart, restaurantId]);

  useEffect(() => {
    // Mutations advance this counter so the effect reloads with the filters from
    // the latest render instead of calling an async handler's stale load closure.
    void refreshTick;
    void load();
    return () => expenseRequests.invalidate();
  }, [expenseRequests, load, refreshTick]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const requestedRestaurantId = restaurantId;
    if (requestedRestaurantId === null) return;
    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError(copy.amountRequired);
      return;
    }
    setSavingRestaurantId(requestedRestaurantId);
    setError("");
    try {
      const payload = { category: form.category, amount, spent_at: form.spent_at, note: form.note.trim() };
      if (form.id === null) await createExpense(payload);
      else await updateExpense(form.id, payload);
      setForm((current) => current.restaurantId === requestedRestaurantId ? emptyForm(requestedRestaurantId) : current);
      setFormOpen(false);
      setRefreshTick((tick) => tick + 1);
    } catch (err) {
      setError(apiErrorMessage(err) || copy.saveError);
    } finally {
      setSavingRestaurantId((current) => current === requestedRestaurantId ? null : current);
    }
  };

  const remove = async (expense: Expense) => {
    if (!window.confirm(copy.confirmDelete)) return;
    setError("");
    try {
      await deleteExpense(expense.ID);
      setForm((current) => current.restaurantId === restaurantId && current.id === expense.ID ? emptyForm(restaurantId) : current);
      setRefreshTick((tick) => tick + 1);
    } catch (err) {
      setError(apiErrorMessage(err) || copy.saveError);
    }
  };

  const exportPdf = async () => {
    setError("");
    try {
      const [font, { jsPDF }, autoTable] = await Promise.all([
        loadSarabun(),
        import("jspdf"),
        import("jspdf-autotable").then((module) => module.default),
      ]);
      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      doc.addFileToVFS("Sarabun.ttf", font);
      doc.addFont("Sarabun.ttf", "Sarabun", "normal");
      doc.setFont("Sarabun");
      doc.setFontSize(14);
      doc.text(`${copy.title} ${monthLabel}`, 10, 14);

      // Only the regular weight is embedded, so every cell asks for "normal";
      // a bold request would silently fall back to Helvetica and drop the Thai.
      const cell = { font: "Sarabun", fontStyle: "normal" as const };
      autoTable(doc, {
        startY: 19,
        margin: { left: 10, right: 10 },
        head: [["#", copy.date, copy.category, copy.note, copy.amount, copy.recordedBy]],
        body: sortedExpenses.map((expense, index) => [
          String(index + 1),
          expense.spent_at.slice(0, 10),
          copy.categories[expense.category],
          expense.note || (expense.ingredient_transaction_id != null ? copy.generatedStockIn : "-"),
          formatCurrency(expense.amount, language),
          expense.created_by ? `${expense.created_by.first_name} ${expense.created_by.last_name}`.trim() : "-",
        ]),
        foot: [
          [
            { content: copy.monthTotal, colSpan: 4 },
            formatCurrency(scopedData.total, language),
            `${scopedData.entries} ${copy.entries}`,
          ],
          ...(scopedData.hasMore
            ? [[{ content: copy.partialList(scopedData.expenses.length, scopedData.entries), colSpan: 6 }]]
            : []),
        ],
        styles: { ...cell, fontSize: 9, cellPadding: 1.5, lineColor: 0, lineWidth: 0.1, textColor: 0 },
        headStyles: { ...cell, fillColor: [223, 227, 230] },
        footStyles: { ...cell, fillColor: [238, 241, 243] },
        columnStyles: {
          0: { cellWidth: 8, halign: "right" },
          1: { cellWidth: 22 },
          2: { cellWidth: 26 },
          4: { cellWidth: 26, halign: "right" },
          5: { cellWidth: 32 },
        },
      });
      doc.save(`expenses-${monthValue}.pdf`);
    } catch (err) {
      setError(apiErrorMessage(err) || copy.exportError);
    }
  };

  if (!canView) return <PermissionDenied title={copy.denied} />;

  const toggleSort = (key: SortKey) => {
    setSort((current) =>
      current.key === key
        ? { key, dir: current.dir === "asc" ? "desc" : "asc" }
        // Money and dates are most useful largest-first; text reads better a-z.
        : { key, dir: key === "amount" || key === "spent_at" ? "desc" : "asc" },
    );
    setPage(1);
  };

  const selectMonth = (value: string) => {
    const [year, month] = value.split("-").map(Number);
    setMonthDate(new Date(year, month - 1, 1));
    setPage(1);
  };
  const inputClass =
    "w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-[14px] outline-none focus:border-gray-900 dark:border-gray-800 dark:bg-gray-900 dark:focus:border-white";

  return (
    <OperationalPageShell
      eyebrow={copy.eyebrow}
      title={copy.title}
      hideHeaderText
    >
      {/* Print = the browser's own "Save as PDF". No PDF library. */}
      <style>{`@media print {
        @page { size: A4 portrait; margin: 10mm; }
        html, body { height: auto !important; min-height: 0 !important; overflow: visible !important; }
        /* display, not visibility: an invisible box still reserves its height and prints as a blank page. */
        body *:not(:has(#expense-print)):not(#expense-print):not(#expense-print *) { display: none !important; }
        body :has(#expense-print) {
          display: block !important; height: auto !important; min-height: 0 !important; max-height: none !important;
          margin: 0 !important; padding: 0 !important; overflow: visible !important; background: none !important;
        }
        #expense-print { color: #000 !important; }
        #expense-print > *:last-child { margin-bottom: 0 !important; }
        #expense-print table { width: 100%; border-collapse: collapse; font-size: 11px; }
        #expense-print th, #expense-print td { border: 1px solid #000; padding: 4px 6px; vertical-align: top; }
        #expense-print thead { display: table-header-group; }
        #expense-print thead th {
          background: #dfe3e6 !important; font-size: 10px; text-align: left;
          text-transform: uppercase; letter-spacing: .04em;
          -webkit-print-color-adjust: exact; print-color-adjust: exact;
        }
        #expense-print tfoot td { background: #eef1f3 !important; font-weight: 700; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        #expense-print tr { break-inside: avoid; }
        #expense-print .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
      }`}</style>

      <div id="expense-print">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <ThemedSelect aria-label={copy.month} value={monthValue} onChange={selectMonth} options={monthOptions} compact className="w-[140px] print:hidden" />
        {/* The picker itself is screen-only, so the PDF keeps a plain month heading. */}
        <span className="hidden text-[16px] font-semibold print:block">{monthLabel}</span>
        <span className="text-[11px] text-gray-500 dark:text-gray-400 print:hidden">{scopedData.entries} {copy.entries}</span>
        {/* Icon-only, so the label has to survive as an accessible name. */}
        <Link href={restaurantPageHref("/home")} aria-label={copy.back} title={copy.back} className="ui-press ml-auto inline-flex h-9 w-9 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 print:hidden">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        </Link>
        <button type="button" onClick={() => void exportPdf()} disabled={loading || !scopedData.expenses.length} className="ui-press inline-flex h-9 items-center gap-2 rounded-md border border-gray-200 bg-white px-3 text-[12px] font-semibold text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 print:hidden">
          <Printer className="h-4 w-4" aria-hidden="true" />
          {copy.exportPdf}
        </button>
        {/* Primary add sits at the far right of the header, matching /tables and /inventory. */}
        {canEdit ? (
          <button type="button" onClick={openAdd} className="ui-press inline-flex h-9 items-center gap-2 rounded-md bg-orange-700 px-3 text-[12px] font-semibold text-white hover:bg-orange-800 dark:bg-orange-700 dark:text-white dark:hover:bg-orange-800 print:hidden">
            <Plus className="h-4 w-4" aria-hidden="true" />
            {copy.add}
          </button>
        ) : (
          <p className="inline-flex h-9 items-center rounded-md border border-gray-200 bg-gray-50 px-3 text-[12px] text-gray-500 dark:border-gray-800 dark:bg-gray-800 dark:text-gray-400 print:hidden">{copy.readOnly}</p>
        )}
      </div>

      <div className="mb-4 print:hidden">
        <ThemedSelect
          aria-label={copy.category}
          value={categoryFilter}
          onChange={(value) => { setCategoryFilter(value as "all" | ExpenseCategory); setPage(1); }}
          options={(["all", ...expenseCategories] as const).map((value) => {
            const amount = value === "all" ? monthTotal : scopedData.categories.find((item) => item.category === value)?.amount ?? 0;
            const label = value === "all" ? copy.all : copy.categories[value];
            return { value, label: `${label} · ${formatCurrency(amount, language)}` };
          })}
          compact
          className="w-full sm:w-[240px]"
        />
      </div>

      {error && <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] font-medium text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300 print:hidden">{error}</div>}

      {/* Print-only ledger. A real <table> so the browser repeats <thead> on every page. */}
      <table className="hidden print:table">
        <thead>
          <tr>
            <th style={{ width: "3%" }}>#</th>
            <th style={{ width: "12%" }}>{copy.date}</th>
            <th style={{ width: "15%" }}>{copy.category}</th>
            <th>{copy.note}</th>
            <th style={{ width: "15%" }} className="num">{copy.amount}</th>
            <th style={{ width: "18%" }}>{copy.recordedBy}</th>
          </tr>
        </thead>
        <tbody>
          {sortedExpenses.map((expense, index) => (
            <tr key={expense.ID}>
              <td className="num">{index + 1}</td>
              <td>{expense.spent_at.slice(0, 10)}</td>
              <td>{copy.categories[expense.category]}</td>
              <td>{expense.note || (expense.ingredient_transaction_id != null ? copy.generatedStockIn : "-")}</td>
              <td className="num">{formatCurrency(expense.amount, language)}</td>
              <td>{expense.created_by ? `${expense.created_by.first_name} ${expense.created_by.last_name}`.trim() : "-"}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={4}>{copy.monthTotal}</td>
            <td className="num">{formatCurrency(scopedData.total, language)}</td>
            <td>{scopedData.entries} {copy.entries}</td>
          </tr>
          {scopedData.hasMore ? (
            <tr><td colSpan={6}>{copy.partialList(scopedData.expenses.length, scopedData.entries)}</td></tr>
          ) : null}
        </tfoot>
      </table>

      <div className="overflow-hidden rounded-md border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900 print:hidden">
        <div className="hidden grid-cols-[110px_130px_minmax(0,1fr)_140px_120px] gap-3 border-b border-gray-200 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:border-gray-800 lg:grid">
          {([
            { key: "spent_at", label: copy.date, end: false },
            { key: "category", label: copy.category, end: false },
            { key: "note", label: copy.note, end: false },
            { key: "amount", label: copy.amount, end: true },
            { key: "created_by", label: copy.recordedBy, end: true },
          ] as const).map((column) => (
            <button
              key={column.key}
              type="button"
              onClick={() => toggleSort(column.key)}
              className={`ui-press inline-flex items-center gap-1 uppercase tracking-wide transition-colors hover:text-gray-900 dark:hover:text-white ${column.end ? "justify-end" : ""}`}
            >
              {column.label}
              {sort.key === column.key ? (
                sort.dir === "asc"
                  ? <ChevronUp className="h-3 w-3 shrink-0" aria-hidden="true" />
                  : <ChevronDown className="h-3 w-3 shrink-0" aria-hidden="true" />
              ) : null}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-12" />)}
          </div>
        ) : scopedData.expenses.length ? (
          <div className="divide-y divide-gray-100 dark:divide-gray-900">
            {visibleExpenses.map((expense) => (
              <div
                key={expense.ID}
                // Auto-generated stock-in rows are not editable, so only the
                // hand-entered ones become a click target.
                {...(canEdit && expense.ingredient_transaction_id == null
                  ? {
                      role: "button",
                      tabIndex: 0,
                      "aria-haspopup": "dialog" as const,
                      "aria-label": `${copy.edit}: ${expense.note || copy.categories[expense.category]}`,
                      onClick: () => openEdit(expense),
                      onKeyDown: (event: React.KeyboardEvent) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openEdit(expense); } },
                    }
                  : {})}
                className={`grid grid-cols-2 gap-x-3 gap-y-1 bg-white px-4 py-3 text-[14px] transition-colors hover:bg-gray-50 dark:bg-gray-900 dark:hover:bg-gray-800 lg:grid-cols-[110px_130px_minmax(0,1fr)_140px_120px] lg:items-center ${canEdit && expense.ingredient_transaction_id == null ? "cursor-pointer" : ""}`}
              >
                <span className="font-mono text-[13px] tabular-nums text-gray-500 dark:text-gray-400">
                  {new Date(expense.spent_at).toLocaleDateString(locale, { day: "2-digit", month: "short" })}
                </span>
                <span>
                  <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[12px] font-semibold ${categoryBadgeClass}`}>
                    <span className={`h-2 w-2 shrink-0 rounded-full ${categoryDotClass[expense.category]}`} aria-hidden="true" />
                    {copy.categories[expense.category]}
                  </span>
                </span>
                <span className="min-w-0 text-gray-700 dark:text-gray-200">
                  <span className="block truncate">{expense.note || "-"}</span>
                  {expense.ingredient_transaction_id != null ? (
                    <span className="mt-0.5 block text-[11px] text-gray-500 dark:text-gray-500">{copy.generatedStockIn}</span>
                  ) : null}
                </span>
                <span className="font-mono font-semibold tabular-nums text-gray-950 dark:text-white lg:text-right">{formatCurrency(expense.amount, language)}</span>
                <span className="flex items-center justify-end gap-2 text-[12px] text-gray-500">
                  <span className="truncate">{expense.created_by ? `${expense.created_by.first_name} ${expense.created_by.last_name}`.trim() : "-"}</span>
                  {/* Edit moved onto the row itself; delete stays a button and
                      must not also trigger the row's edit dialog. */}
                  {canEdit && expense.ingredient_transaction_id == null && (
                    <button
                      type="button"
                      aria-label={`${copy.deleteAction}: ${expense.note || copy.categories[expense.category]}`}
                      title={`${copy.deleteAction}: ${expense.note || copy.categories[expense.category]}`}
                      onClick={(event) => { event.stopPropagation(); void remove(expense); }}
                      className="ui-press shrink-0 rounded border border-red-200 px-1.5 py-0.5 text-[11px] text-red-600 hover:bg-red-50 dark:border-red-900/50 dark:hover:bg-red-950/30"
                    >✕</button>
                  )}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="px-4 py-14 text-center text-[14px] text-gray-500 dark:text-gray-400">{copy.empty}</div>
        )}
        {!loading && scopedData.hasMore ? (
          <p className="border-t border-gray-100 px-4 py-2.5 text-[11px] text-gray-500 dark:border-gray-900 dark:text-gray-400">
            {copy.partialList(scopedData.expenses.length, scopedData.entries)}
          </p>
        ) : null}
        {!loading && scopedData.expenses.length > pageSizes[0] ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 px-4 py-2.5 dark:border-gray-900 print:hidden">
            <div className="flex items-center gap-2 text-[12px] text-gray-500 dark:text-gray-400">
              <ThemedSelect
                aria-label={copy.perPage}
                value={String(pageSize)}
                onChange={(value) => { setPageSize(Number(value)); setPage(1); }}
                options={pageSizes.map((size) => ({ value: String(size), label: String(size) }))}
                className="w-[80px]"
              />
              {copy.perPage}
            </div>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => setPage(currentPage - 1)} disabled={currentPage <= 1} aria-label={copy.previousPage} className="ui-press inline-flex h-8 w-8 items-center justify-center rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-35 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-800">
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              </button>
              <span className="px-2 text-[12px] tabular-nums text-gray-600 dark:text-gray-300">{copy.pageOf(currentPage, pageCount)}</span>
              <button type="button" onClick={() => setPage(currentPage + 1)} disabled={currentPage >= pageCount} aria-label={copy.nextPage} className="ui-press inline-flex h-8 w-8 items-center justify-center rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-35 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-800">
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        ) : null}
      </div>
      </div>

      {formOpen && canEdit ? (
        <div {...formBackdrop} className="motion-overlay fixed inset-0 z-50 flex items-center justify-center bg-gray-950/45 p-3 backdrop-blur-sm sm:p-4 print:hidden">
          <form
            onSubmit={submit}
            role="dialog"
            aria-modal="true"
            aria-labelledby="expense-form-title"
            className="motion-dialog flex max-h-[calc(100vh-2rem)] w-full max-w-md flex-col overflow-hidden rounded-md border border-gray-200 bg-white shadow-2xl shadow-black/20 dark:border-gray-800 dark:bg-gray-900"
          >
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-800">
              <h2 id="expense-form-title" className="text-[15px] font-semibold text-gray-950 dark:text-white">{form.id === null ? copy.add : copy.edit}</h2>
              <button type="button" onClick={() => setFormOpen(false)} className="ui-press h-9 shrink-0 rounded-md border border-gray-200 px-3 text-[12px] font-semibold text-gray-600 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-800">{copy.cancel}</button>
            </div>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
              {error && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] font-medium text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">{error}</p>}
              <label className="block">
                <span className="mb-1 block text-[12px] font-medium text-gray-500 dark:text-gray-400">{copy.category}</span>
                <ThemedSelect
                  value={form.category}
                  onChange={(value) => setForm({ ...form, category: value as ExpenseCategory })}
                  options={categoryOptions}
                  className="w-full"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[12px] font-medium text-gray-500 dark:text-gray-400">{copy.amount}</span>
                <input type="number" inputMode="decimal" step="0.01" min="0" required autoFocus value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} className={`${inputClass} font-mono tabular-nums`} />
              </label>
              <label className="block">
                <span className="mb-1 block text-[12px] font-medium text-gray-500 dark:text-gray-400">{copy.date}</span>
                <input type="date" required value={form.spent_at} onChange={(event) => setForm({ ...form, spent_at: event.target.value })} className={`${inputClass} font-mono dark:[color-scheme:dark]`} />
              </label>
              <label className="block">
                <span className="mb-1 block text-[12px] font-medium text-gray-500 dark:text-gray-400">{copy.note}</span>
                <input type="text" maxLength={500} placeholder={copy.notePlaceholder} value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} className={inputClass} />
              </label>
            </div>

            <div className="flex shrink-0 justify-end border-t border-gray-200 px-4 py-3 dark:border-gray-800">
              <button type="submit" disabled={saving} className="ui-press h-10 rounded-md bg-orange-700 px-4 text-[13px] font-semibold text-white disabled:opacity-50 dark:bg-orange-700 dark:text-white">{copy.save}</button>
            </div>
          </form>
        </div>
      ) : null}
    </OperationalPageShell>
  );
}
