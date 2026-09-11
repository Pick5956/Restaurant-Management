"use client";

import { useMemo, useState } from "react";
import {
  ArrowDownUp,
  Check,
  ChevronRight,
  ClipboardList,
  Download,
  Filter,
  History,
  Layers,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Tags,
  Trash2,
  X,
} from "lucide-react";
import { useLanguage } from "@/src/providers/LanguageProvider";
import { formatAdaptiveNumber as formatNumber, formatCurrency } from "@/src/lib/format";
import { exportStockCSV } from "@/src/lib/ingredient";
import type { Ingredient } from "@/src/types/ingredient";
import { getStatus, type ItemStatus } from "../inventoryPageUtils";
import { getReorderPercent, getStockPercent } from "../inventoryPageUtils";
import { useInventoryData } from "./useInventoryData";
import {
  BottomSheet,
  ChipRow,
  PrimaryButton,
  SecondaryButton,
  Segmented,
  SheetAction,
  Stepper,
  TAP,
  inputBase,
  useIOSActiveStates,
  useToastStack,
} from "./primitives";
import {
  inventoryTotals,
  restockStep,
  sortIngredients,
  statusTone,
  type SortKey,
} from "./inventoryMobileUtils";
import IngredientDetailScreen from "./IngredientDetailScreen";
import AddIngredientScreen from "./AddIngredientScreen";
import BulkAddScreen from "./BulkAddScreen";
import CategoriesScreen from "./CategoriesScreen";
import HistoryScreen from "./HistoryScreen";

type Screen = "list" | "detail" | "add" | "edit" | "bulk" | "categories" | "history";
type SheetKind = "none" | "row" | "restock" | "count" | "filter" | "manage" | "sort" | "batch";

function buildCopy(lang: "th" | "en") {
  return lang === "th"
    ? {
        search: "ค้นหาวัตถุดิบ",
        all: "ทั้งหมด",
        low: "ใกล้หมด",
        out: "หมด",
        totalValue: "มูลค่าคลังรวม",
        needsOrder: "ต้องสั่งของ",
        items: "รายการ",
        minimum: "ขั้นต่ำ",
        addIngredient: "เพิ่มวัตถุดิบ",
        empty: "ไม่พบวัตถุดิบ",
        emptyHint: "ลองแก้คำค้นหาหรือล้างตัวกรอง",
        restock: "เติมสต็อก",
        count: "ปรับยอด (นับจริง)",
        movements: "ประวัติการเคลื่อนไหว",
        edit: "แก้ไขวัตถุดิบ",
        remove: "ลบวัตถุดิบ",
        manage: "จัดการคลัง",
        bulk: "เพิ่มหลายรายการ",
        selectMany: "เลือกหลายรายการ",
        categories: "จัดการหมวดหมู่",
        exportCsv: "ส่งออกเป็น CSV",
        wholeHistory: "ประวัติทั้งคลัง",
        filter: "ตัวกรอง",
        category: "หมวดหมู่",
        sortBy: "เรียงตาม",
        clearFilter: "ล้างตัวกรอง",
        showResults: "ดูผลลัพธ์",
        allCategories: "ทุกหมวด",
        sortRecent: "ล่าสุด",
        sortUrgent: "ด่วนก่อน",
        sortName: "ชื่อ ก-ฮ",
        sortValue: "มูลค่าสูงสุด",
        afterRestock: "คงเหลือหลังเติม",
        save: (n: string) => `บันทึก +${n} หน่วย`,
        counted: "จำนวนที่นับได้",
        difference: "ส่วนต่าง",
        saveCount: "บันทึกยอดที่นับได้",
        selected: (n: number) => `เลือก ${n} รายการ`,
        selectAll: "เลือกทั้งหมด",
        adjustMany: "ปรับยอด",
        restockMany: (n: number) => `เติมสต็อก ${n} รายการ`,
        batchInTitle: "เติมสต็อกหลายรายการ",
        batchSetTitle: "ปรับยอดหลายรายการ",
        batchInHint: "ตัวเลขที่ใส่ให้คือจำนวนที่แนะนำ แก้ได้ทุกแถว ใส่ 0 เพื่อข้ามแถวนั้น",
        batchSetHint: "กรอกจำนวนที่นับได้จริงของแต่ละตัว แถวที่ไม่เปลี่ยนจะถูกข้าม",
        batchInSave: (n: number) => `เติม ${n} รายการ`,
        batchSetSave: (n: number) => `บันทึกยอด ${n} รายการ`,
        batchDone: (n: number) => `ทำรายการ ${n} รายการแล้ว`,
        batchPartial: (ok: number, fail: number) => `สำเร็จ ${ok} · ไม่สำเร็จ ${fail} (ยังเลือกไว้ให้ลองใหม่)`,
        batchExpenseNote: "การเติมสต็อกที่มีต้นทุนต่อหน่วย จะบันทึกเป็นรายจ่ายให้อัตโนมัติ",
        now: "ตอนนี้",
        noUsage: "ยังไม่รู้ว่าเต็มเท่าไหร่",
        loading: "กำลังโหลด",
        restocked: (name: string, n: string, unit: string) => `เติม ${name} แล้ว ${n} ${unit}`,
        countSaved: (name: string) => `บันทึกยอด ${name} แล้ว`,
        deleted: (name: string) => `ลบ ${name} แล้ว`,
        exported: (n: number) => `ดาวน์โหลดแล้ว ${n} รายการ`,
        failed: "ทำรายการไม่สำเร็จ",
        countZeroNote: "นับได้ 0 จะบันทึกเป็นการตัดออกทั้งหมด",
      }
    : {
        search: "Search ingredient",
        all: "All",
        low: "Low",
        out: "Out",
        totalValue: "Inventory value",
        needsOrder: "To reorder",
        items: "items",
        minimum: "Min",
        addIngredient: "Add ingredient",
        empty: "No ingredients found",
        emptyHint: "Try a different search or clear the filters",
        restock: "Restock",
        count: "Set counted quantity",
        movements: "Movement history",
        edit: "Edit ingredient",
        remove: "Delete ingredient",
        manage: "Manage inventory",
        bulk: "Add several",
        selectMany: "Select several",
        categories: "Manage categories",
        exportCsv: "Export CSV",
        wholeHistory: "Whole-inventory history",
        filter: "Filters",
        category: "Category",
        sortBy: "Sort by",
        clearFilter: "Clear filters",
        showResults: "Show results",
        allCategories: "All categories",
        sortRecent: "Latest",
        sortUrgent: "Most urgent",
        sortName: "Name A-Z",
        sortValue: "Highest value",
        afterRestock: "Stock after",
        save: (n: string) => `Save +${n}`,
        counted: "Counted quantity",
        difference: "Difference",
        saveCount: "Save counted quantity",
        selected: (n: number) => `${n} selected`,
        selectAll: "Select all",
        adjustMany: "Set quantity",
        restockMany: (n: number) => `Restock ${n} items`,
        batchInTitle: "Restock several",
        batchSetTitle: "Set quantities",
        batchInHint: "The numbers are a suggestion — edit any row, or set 0 to skip it",
        batchSetHint: "Enter what you counted for each; unchanged rows are skipped",
        batchInSave: (n: number) => `Restock ${n}`,
        batchSetSave: (n: number) => `Save ${n}`,
        batchDone: (n: number) => `${n} items updated`,
        batchPartial: (ok: number, fail: number) => `${ok} done · ${fail} failed (left selected to retry)`,
        batchExpenseNote: "A restock on an ingredient with a unit cost also writes an expense",
        now: "Now",
        noUsage: "No maximum yet",
        loading: "Loading",
        restocked: (name: string, n: string, unit: string) => `Added ${n} ${unit} to ${name}`,
        countSaved: (name: string) => `Saved the count for ${name}`,
        deleted: (name: string) => `Deleted ${name}`,
        exported: (n: number) => `Downloaded ${n} rows`,
        failed: "That did not go through",
        countZeroNote: "A count of 0 is saved as removing everything",
      };
}

export default function InventoryMobile({
  canView,
  canManage,
}: {
  canView: boolean;
  canManage: boolean;
}) {
  const { language } = useLanguage();
  const lang = language === "en" ? "en" : "th";
  const copy = useMemo(() => buildCopy(lang), [lang]);
  const { ingredients, categories, loading, actions } = useInventoryData(canView);
  const { toast, show } = useToastStack();
  useIOSActiveStates();

  const [screen, setScreen] = useState<Screen>("list");
  const [sheet, setSheet] = useState<SheetKind>("none");
  const [active, setActive] = useState<Ingredient | null>(null);

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | ItemStatus>("all");
  const [categoryId, setCategoryId] = useState(0);
  const [sort, setSort] = useState<SortKey>("recent");

  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const [amount, setAmount] = useState(0);
  const [batchMode, setBatchMode] = useState<"in" | "adjust">("in");
  const [batchDraft, setBatchDraft] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);

  const totals = useMemo(() => inventoryTotals(ingredients), [ingredients]);

  const selectedItems = useMemo(
    () => ingredients.filter((item) => selected.has(item.ID)),
    [ingredients, selected],
  );


  // How many rows the batch will actually touch: a 0 (or an unchanged count)
  // means skip, so the button never promises more than it will do.
  const batchCount = useMemo(
    () =>
      selectedItems.filter((item) => {
        const quantity = Number(batchDraft[item.ID]) || 0;
        if (quantity <= 0) return false;
        return batchMode === "in" || quantity !== item.stock;
      }).length,
    [selectedItems, batchDraft, batchMode],
  );

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    const filtered = ingredients.filter((item) => {
      if (status !== "all" && getStatus(item) !== status) return false;
      if (categoryId !== 0 && (item.category_id ?? 0) !== categoryId) return false;
      if (term && !item.name.toLowerCase().includes(term)) return false;
      return true;
    });
    return sortIngredients(filtered, sort);
  }, [ingredients, search, status, categoryId, sort]);

  function openSheet(item: Ingredient, kind: SheetKind) {
    setActive(item);
    if (kind === "restock") setAmount(restockStep(item));
    if (kind === "count") setAmount(item.stock);
    setSheet(kind);
  }

  async function guard(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } catch {
      show(copy.failed);
    } finally {
      setBusy(false);
    }
  }

  async function submitRestock() {
    if (!active || amount <= 0) return;
    const item = active;
    await guard(async () => {
      await actions.restock(item.ID, { type: "in", quantity: amount });
      show(copy.restocked(item.name, formatNumber(amount, lang), item.unit));
      setSheet("none");
    });
  }

  async function submitCount() {
    if (!active) return;
    const item = active;
    await guard(async () => {
      // The API rejects an absolute set of 0 three layers deep, so an empty
      // shelf is recorded as removing exactly what is left — the same end state.
      const payload =
        amount === 0
          ? { type: "out" as const, quantity: item.stock }
          : { type: "adjust" as const, quantity: amount };
      if (payload.quantity <= 0) {
        setSheet("none");
        return;
      }
      await actions.restock(item.ID, payload);
      show(copy.countSaved(item.name));
      setSheet("none");
    });
  }

  async function removeActive() {
    if (!active) return;
    const item = active;
    await guard(async () => {
      await actions.remove(item.ID);
      show(copy.deleted(item.name));
      setSheet("none");
      setScreen("list");
    });
  }

  async function runExport() {
    await guard(async () => {
      const result = await exportStockCSV(
        { search, status, category_id: categoryId || undefined },
        lang,
      );
      show(copy.exported(result.rows));
      setSheet("none");
    });
  }

  /**
   * Opens the batch sheet with a number already filled in per row. The suggestion
   * tops each ingredient up to twice its reorder level, but it is only a
   * suggestion — every row stays editable and a row set to 0 is skipped.
   *
   * This used to fire the writes straight from the dock with that suggested
   * number and no screen at all. A stock-in also writes an expense row when the
   * ingredient has a unit cost, so one tap was silently spending money nobody
   * had typed.
   */
  function openBatch(mode: "in" | "adjust") {
    const draft: Record<number, string> = {};
    for (const item of selectedItems) {
      draft[item.ID] =
        mode === "in" ? String(Math.max(0, item.min_stock * 2 - item.stock)) : String(item.stock);
    }
    setBatchMode(mode);
    setBatchDraft(draft);
    setSheet("batch");
  }

  async function submitBatch() {
    await guard(async () => {
      // No bulk endpoint exists, so these are separate requests with no
      // transaction spanning them: report what actually landed, and keep the
      // rows that failed selected so they can be retried.
      const failed = new Set<number>();
      let done = 0;
      for (const item of selectedItems) {
        const quantity = Number(batchDraft[item.ID]) || 0;
        if (quantity <= 0) continue;
        if (batchMode === "adjust" && quantity === item.stock) continue;
        try {
          await actions.restock(item.ID, { type: batchMode, quantity });
          done += 1;
        } catch {
          failed.add(item.ID);
        }
      }
      setSheet("none");
      if (failed.size > 0) {
        setSelected(failed);
        show(copy.batchPartial(done, failed.size));
        return;
      }
      show(copy.batchDone(done));
      setSelecting(false);
      setSelected(new Set());
    });
  }

  if (screen === "detail" && active) {
    const fresh = ingredients.find((item) => item.ID === active.ID) ?? active;
    return (
      <IngredientDetailScreen
        item={fresh}
        lang={lang}
        canManage={canManage}
        onBack={() => setScreen("list")}
        onRestock={() => openSheet(fresh, "restock")}
        onCount={() => openSheet(fresh, "count")}
        onEdit={() => setScreen("edit")}
        onDelete={() => openSheet(fresh, "row")}
        sheet={
          <RestockAndCountSheets
            active={active}
            sheet={sheet}
            copy={copy}
            lang={lang}
            amount={amount}
            busy={busy}
            setAmount={setAmount}
            close={() => setSheet("none")}
            submitRestock={submitRestock}
            submitCount={submitCount}
          />
        }
      />
    );
  }

  if (screen === "add" || screen === "edit") {
    return (
      <AddIngredientScreen
        lang={lang}
        categories={categories}
        editing={screen === "edit" ? active : null}
        onCancel={() => setScreen(screen === "edit" ? "detail" : "list")}
        onSaved={(name) => {
          show(lang === "th" ? `บันทึก ${name} แล้ว` : `Saved ${name}`);
          setScreen("list");
        }}
        actions={actions}
      />
    );
  }

  if (screen === "bulk") {
    return (
      <BulkAddScreen
        lang={lang}
        categories={categories}
        onCancel={() => setScreen("list")}
        onSaved={(count) => {
          show(lang === "th" ? `บันทึก ${count} รายการแล้ว` : `Saved ${count} items`);
          setScreen("list");
        }}
        actions={actions}
      />
    );
  }

  if (screen === "categories") {
    return (
      <CategoriesScreen
        lang={lang}
        categories={categories}
        ingredients={ingredients}
        onBack={() => setScreen("list")}
        actions={actions}
      />
    );
  }

  if (screen === "history") {
    return <HistoryScreen lang={lang} categories={categories} onBack={() => setScreen("list")} />;
  }

  return (
    <div data-inventory-mobile className="min-h-dvh bg-(--inv-canvas) text-(--inv-body) pb-28">
      <div className="space-y-3 px-4 pt-3">
        {selecting ? (
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => {
                setSelecting(false);
                setSelected(new Set());
              }}
              aria-label="ปิด"
              className={`ui-press -ml-2 flex h-11 w-11 items-center justify-center rounded-full text-(--inv-muted) ${TAP}`}
            >
              <X className="h-5 w-5" strokeWidth={2} />
            </button>
            <span className="text-[15px] font-semibold text-(--inv-heading)">
              {copy.selected(selected.size)}
            </span>
            <button
              type="button"
              onClick={() => setSelected(new Set(visible.map((item) => item.ID)))}
              className={`ui-press rounded-(--inv-radius) px-3 text-[13px] font-semibold text-(--inv-action) ${TAP}`}
            >
              {copy.selectAll}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-[minmax(0,1fr)_52px_52px] gap-2">
            <div className="relative min-w-0">
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
            <button
              type="button"
              aria-label={copy.filter}
              onClick={() => setSheet("filter")}
              className={`ui-press flex h-[52px] items-center justify-center rounded-(--inv-radius) border bg-(--inv-surface) ${
                categoryId !== 0 || sort !== "recent"
                  ? "border-(--inv-action) text-(--inv-action)"
                  : "border-(--inv-hairline) text-(--inv-muted)"
              }`}
            >
              <Filter className="h-5 w-5" strokeWidth={2} />
            </button>
            <button
              type="button"
              aria-label={copy.manage}
              onClick={() => setSheet("manage")}
              className="ui-press flex h-[52px] items-center justify-center rounded-(--inv-radius) border border-(--inv-hairline) bg-(--inv-surface) text-(--inv-muted)"
            >
              <MoreHorizontal className="h-5 w-5" strokeWidth={2} />
            </button>
          </div>
        )}

        <Segmented
          value={status}
          onChange={setStatus}
          options={[
            { value: "all", label: copy.all, count: totals.all },
            { value: "low", label: copy.low, count: totals.low },
            { value: "out", label: copy.out, count: totals.out },
          ]}
        />

        <div className="flex items-end justify-between gap-3 rounded-(--inv-radius) border border-(--inv-hairline) bg-(--inv-surface) px-4 py-3 shadow-(--inv-shadow)">
          <div className="min-w-0">
            <p className="text-[11px] text-(--inv-muted)">{copy.totalValue}</p>
            <p className="truncate text-[20px] font-semibold tabular-nums text-(--inv-heading)">
              {formatCurrency(totals.value, lang)}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-[11px] text-(--inv-muted)">{copy.needsOrder}</p>
            <p className="text-[20px] font-semibold tabular-nums text-(--inv-action)">
              {totals.needsOrder}
              <span className="ml-1 text-[11px] font-medium text-(--inv-muted)">{copy.items}</span>
            </p>
          </div>
        </div>

        {loading ? (
          <p className="py-10 text-center text-[13px] text-(--inv-faint)">{copy.loading}</p>
        ) : visible.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-[15px] font-semibold text-(--inv-heading)">{copy.empty}</p>
            <p className="mt-1 text-[13px] text-(--inv-muted)">{copy.emptyHint}</p>
          </div>
        ) : (
          <div className="space-y-2">
            {visible.map((item) => {
              const tone = statusTone(getStatus(item), lang);
              const percent = getStockPercent(item);
              const reorderAt = getReorderPercent(item);
              const checked = selected.has(item.ID);
              return (
                <div
                  key={item.ID}
                  className="flex items-stretch gap-2 rounded-(--inv-radius) border border-(--inv-hairline) bg-(--inv-surface) p-3 shadow-(--inv-shadow)"
                >
                  {selecting && (
                    <button
                      type="button"
                      aria-label={item.name}
                      onClick={() => {
                        const next = new Set(selected);
                        if (checked) next.delete(item.ID);
                        else next.add(item.ID);
                        setSelected(next);
                      }}
                      className={`ui-press flex w-11 shrink-0 items-center justify-center ${TAP}`}
                    >
                      <span
                        className={`flex h-6 w-6 items-center justify-center rounded-[4px] border ${
                          checked
                            ? "border-(--inv-action) bg-(--inv-action) text-white"
                            : "border-(--inv-hairline)"
                        }`}
                      >
                        {checked && <Check className="h-4 w-4" strokeWidth={3} />}
                      </span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      setActive(item);
                      setScreen("detail");
                    }}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-(--inv-heading)">
                        {item.name}
                      </span>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${tone.badge}`}
                      >
                        {tone.label}
                      </span>
                    </div>

                    <div className="mt-1 flex items-baseline gap-2">
                      <span className={`text-[20px] font-semibold tabular-nums ${tone.text}`}>
                        {formatNumber(item.stock, lang)}
                      </span>
                      <span className="text-[12px] text-(--inv-muted)">{item.unit}</span>
                      <span className="ml-auto shrink-0 text-[12px] tabular-nums text-(--inv-muted)">
                        {formatCurrency(item.cost_per_unit, lang, 2)} / {item.unit}
                      </span>
                    </div>

                    {percent === null ? (
                      <p className="mt-2 text-[11px] text-(--inv-faint)">{copy.noUsage}</p>
                    ) : (
                      <div className="relative mt-2 h-1.5 w-full rounded-full bg-(--inv-action-soft)">
                        <div
                          className={`h-full rounded-full ${tone.bar}`}
                          style={{ width: `${percent}%` }}
                        />
                        {reorderAt === null ? null : (
                          <span
                            aria-hidden
                            className="absolute -top-0.5 h-2.5 w-0.5 rounded-full bg-(--inv-muted) opacity-60"
                            style={{ left: `${reorderAt}%` }}
                          />
                        )}
                      </div>
                    )}

                    <div className="mt-2 flex items-center gap-2">
                      <span className="max-w-[45%] shrink-0 truncate rounded-full bg-(--inv-surface-strong) px-2 py-0.5 text-[11px] text-(--inv-muted)">
                        {item.category?.name ?? (lang === "th" ? "ไม่มีหมวด" : "Uncategorised")}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-[11px] text-(--inv-faint)">
                        {copy.minimum} {formatNumber(item.min_stock, lang)} {item.unit}
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-(--inv-faint)" strokeWidth={2} />
                    </div>
                  </button>

                  {!selecting && canManage && (
                    <div className="flex shrink-0 flex-col justify-center gap-1">
                      <button
                        type="button"
                        aria-label={copy.restock}
                        onClick={() => openSheet(item, "restock")}
                        className={`ui-press flex h-11 w-11 items-center justify-center rounded-(--inv-radius) bg-(--inv-action) text-white ${TAP}`}
                      >
                        <Plus className="h-5 w-5" strokeWidth={2} />
                      </button>
                      <button
                        type="button"
                        aria-label={copy.manage}
                        onClick={() => openSheet(item, "row")}
                        className={`ui-press flex h-11 w-11 items-center justify-center rounded-(--inv-radius) border border-(--inv-hairline) text-(--inv-muted) ${TAP}`}
                      >
                        <MoreHorizontal className="h-5 w-5" strokeWidth={2} />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {toast && (
        <div className="pointer-events-none fixed inset-x-4 bottom-24 z-[60] rounded-(--inv-radius) bg-(--inv-heading) px-4 py-3 text-center text-[13px] font-medium text-(--inv-surface) shadow-lg">
          {toast}
        </div>
      )}

      {canManage && (
        <div
          className="fixed inset-x-0 bottom-0 z-30 bg-gradient-to-t from-(--inv-canvas) via-(--inv-canvas) to-transparent px-4 pb-3 pt-6"
          style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
        >
          {selecting ? (
            <div className="flex gap-2">
              <SecondaryButton onClick={() => openBatch("adjust")} disabled={selected.size === 0 || busy}>
                {copy.adjustMany}
              </SecondaryButton>
              <PrimaryButton onClick={() => openBatch("in")} disabled={selected.size === 0 || busy}>
                {copy.restockMany(selected.size)}
              </PrimaryButton>
            </div>
          ) : (
            <PrimaryButton onClick={() => setScreen("add")}>
              <Plus className="h-5 w-5" strokeWidth={2} />
              {copy.addIngredient}
            </PrimaryButton>
          )}
        </div>
      )}

      <BottomSheet open={sheet === "row"} title={active?.name ?? ""} onClose={() => setSheet("none")}>
        <div className="space-y-1">
          <SheetAction
            label={copy.restock}
            icon={<Plus className="h-5 w-5" strokeWidth={2} />}
            onClick={() => active && openSheet(active, "restock")}
          />
          <SheetAction
            label={copy.count}
            icon={<ClipboardList className="h-5 w-5" strokeWidth={2} />}
            onClick={() => active && openSheet(active, "count")}
          />
          <SheetAction
            label={copy.movements}
            icon={<History className="h-5 w-5" strokeWidth={2} />}
            onClick={() => {
              setSheet("none");
              setScreen("detail");
            }}
          />
          <SheetAction
            label={copy.edit}
            icon={<Pencil className="h-5 w-5" strokeWidth={2} />}
            onClick={() => {
              setSheet("none");
              setScreen("edit");
            }}
          />
          <SheetAction
            danger
            divided
            label={copy.remove}
            icon={<Trash2 className="h-5 w-5" strokeWidth={2} />}
            onClick={removeActive}
          />
        </div>
      </BottomSheet>

      <RestockAndCountSheets
        active={active}
        sheet={sheet}
        copy={copy}
        lang={lang}
        amount={amount}
        busy={busy}
        setAmount={setAmount}
        close={() => setSheet("none")}
        submitRestock={submitRestock}
        submitCount={submitCount}
      />

      <BottomSheet
        open={sheet === "filter"}
        title={copy.filter}
        onClose={() => setSheet("none")}
        footer={
          <div className="flex gap-2">
            <SecondaryButton
              onClick={() => {
                setCategoryId(0);
                setSort("recent");
              }}
            >
              {copy.clearFilter}
            </SecondaryButton>
            <PrimaryButton onClick={() => setSheet("none")}>{copy.showResults}</PrimaryButton>
          </div>
        }
      >
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-(--inv-muted)">
          {copy.category}
        </p>
        <ChipRow
          value={categoryId}
          onChange={setCategoryId}
          options={[
            { value: 0, label: copy.allCategories },
            ...categories.map((category) => ({ value: category.ID, label: category.name })),
          ]}
        />
        <p className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-wide text-(--inv-muted)">
          {copy.sortBy}
        </p>
        <ChipRow
          value={sort}
          onChange={setSort}
          options={[
            { value: "recent", label: copy.sortRecent },
            { value: "urgent", label: copy.sortUrgent },
            { value: "name", label: copy.sortName },
            { value: "value", label: copy.sortValue },
          ]}
        />
      </BottomSheet>

      <BottomSheet
        open={sheet === "batch"}
        title={batchMode === "in" ? copy.batchInTitle : copy.batchSetTitle}
        onClose={() => setSheet("none")}
        footer={
          <PrimaryButton onClick={submitBatch} disabled={busy || batchCount === 0}>
            {batchMode === "in" ? copy.batchInSave(batchCount) : copy.batchSetSave(batchCount)}
          </PrimaryButton>
        }
      >
        <p className="mb-3 text-[12px] leading-snug text-(--inv-muted)">
          {batchMode === "in" ? copy.batchInHint : copy.batchSetHint}
        </p>
        <div className="space-y-2">
          {selectedItems.map((item) => (
            <div key={item.ID} className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-medium text-(--inv-heading)">{item.name}</p>
                <p className="truncate text-[11px] text-(--inv-faint)">
                  {copy.now} {formatNumber(item.stock, lang)} {item.unit}
                </p>
              </div>
              <div className="relative w-[132px] shrink-0">
                <input
                  type="number"
                  inputMode="decimal"
                  value={batchDraft[item.ID] ?? ""}
                  onChange={(event) =>
                    setBatchDraft((current) => ({ ...current, [item.ID]: event.target.value }))
                  }
                  className={`${inputBase} h-[52px] border-(--inv-hairline) pr-12 text-right tabular-nums`}
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-(--inv-muted)">
                  {item.unit}
                </span>
              </div>
            </div>
          ))}
        </div>
        {batchMode === "in" && (
          <p className="mt-3 text-[11px] leading-snug text-(--inv-faint)">{copy.batchExpenseNote}</p>
        )}
      </BottomSheet>

      <BottomSheet open={sheet === "manage"} title={copy.manage} onClose={() => setSheet("none")}>
        <div className="space-y-1">
          {canManage && (
            <SheetAction
              label={copy.bulk}
              icon={<Layers className="h-5 w-5" strokeWidth={2} />}
              onClick={() => {
                setSheet("none");
                setScreen("bulk");
              }}
            />
          )}
          {canManage && (
            <SheetAction
              label={copy.selectMany}
              icon={<Check className="h-5 w-5" strokeWidth={2} />}
              onClick={() => {
                setSheet("none");
                setSelecting(true);
              }}
            />
          )}
          {canManage && (
            <SheetAction
              label={copy.categories}
              icon={<Tags className="h-5 w-5" strokeWidth={2} />}
              onClick={() => {
                setSheet("none");
                setScreen("categories");
              }}
            />
          )}
          <SheetAction
            label={copy.exportCsv}
            icon={<Download className="h-5 w-5" strokeWidth={2} />}
            onClick={runExport}
          />
          <SheetAction
            label={copy.wholeHistory}
            icon={<ArrowDownUp className="h-5 w-5" strokeWidth={2} />}
            onClick={() => {
              setSheet("none");
              setScreen("history");
            }}
          />
        </div>
      </BottomSheet>
    </div>
  );
}

function RestockAndCountSheets({
  active,
  sheet,
  copy,
  lang,
  amount,
  busy,
  setAmount,
  close,
  submitRestock,
  submitCount,
}: {
  active: Ingredient | null;
  sheet: SheetKind;
  copy: ReturnType<typeof buildCopy>;
  lang: "th" | "en";
  amount: number;
  busy: boolean;
  setAmount: (value: number) => void;
  close: () => void;
  submitRestock: () => void;
  submitCount: () => void;
}) {
  if (!active) return null;
  const difference = amount - active.stock;

  return (
    <>
      <BottomSheet
        open={sheet === "restock"}
        title={`${copy.restock} · ${active.name}`}
        onClose={close}
        footer={
          <PrimaryButton onClick={submitRestock} disabled={amount <= 0 || busy}>
            {copy.save(formatNumber(amount, lang))}
          </PrimaryButton>
        }
      >
        <Stepper value={amount} step={restockStep(active)} unit={active.unit} onChange={setAmount} />
        <div className="mt-3 flex items-center justify-between rounded-(--inv-radius) bg-(--inv-surface-strong) px-3 py-2">
          <span className="text-[13px] text-(--inv-muted)">{copy.afterRestock}</span>
          <span className="text-[15px] font-semibold tabular-nums text-(--inv-heading)">
            {formatNumber(active.stock + amount, lang)} {active.unit}
          </span>
        </div>
      </BottomSheet>

      <BottomSheet
        open={sheet === "count"}
        title={`${copy.count} · ${active.name}`}
        onClose={close}
        footer={
          <PrimaryButton onClick={submitCount} disabled={busy}>
            {copy.saveCount}
          </PrimaryButton>
        }
      >
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-(--inv-muted)">
          {copy.counted}
        </p>
        <Stepper value={amount} step={restockStep(active)} unit={active.unit} onChange={setAmount} />
        <div className="mt-3 flex items-center justify-between rounded-(--inv-radius) bg-(--inv-surface-strong) px-3 py-2">
          <span className="text-[13px] text-(--inv-muted)">{copy.difference}</span>
          <span
            className={`text-[15px] font-semibold tabular-nums ${
              difference > 0
                ? "text-(--inv-ok)"
                : difference < 0
                  ? "text-(--inv-out)"
                  : "text-(--inv-muted)"
            }`}
          >
            {difference > 0 ? "+" : ""}
            {formatNumber(difference, lang)} {active.unit}
          </span>
        </div>
        {amount === 0 && (
          <p className="mt-2 text-[11px] text-(--inv-faint)">{copy.countZeroNote}</p>
        )}
      </BottomSheet>
    </>
  );
}
