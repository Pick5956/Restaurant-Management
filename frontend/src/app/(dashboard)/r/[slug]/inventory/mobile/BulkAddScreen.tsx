"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { formatCurrency } from "@/src/lib/format";
import type { IngredientCategory } from "@/src/types/ingredient";
import { UNITS } from "../inventoryPageUtils";
import type { useInventoryData } from "./useInventoryData";
import { BottomSheet, ChipRow, PrimaryButton, ScreenNav, TAP, inputBase } from "./primitives";
import { PickerList } from "./AddIngredientScreen";

type Actions = ReturnType<typeof useInventoryData>["actions"];

type Row = {
  key: number;
  name: string;
  quantity: string;
  unit: string;
  price: string;
  categoryId: number;
};

const emptyRow = (key: number, categoryId: number, unit: string): Row => ({
  key,
  name: "",
  quantity: "",
  unit,
  price: "",
  categoryId,
});

export default function BulkAddScreen({
  lang,
  categories,
  onCancel,
  onSaved,
  actions,
}: {
  lang: "th" | "en";
  categories: IngredientCategory[];
  onCancel: () => void;
  onSaved: (count: number) => void;
  actions: Actions;
}) {
  const copy = useMemo(
    () =>
      lang === "th"
        ? {
            title: "เพิ่มหลายรายการ",
            cancel: "ยกเลิก",
            clear: "ล้าง",
            defaultCategory: "หมวดของวัตถุดิบที่เพิ่มใหม่",
            applyAll: "ใช้หมวดหมู่กับทุกวัตถุดิบ",
            noCategory: "ไม่มีหมวด",
            name: "ชื่อวัตถุดิบ",
            quantity: "จำนวน",
            price: "ราคา",
            ready: (n: number) => `พร้อมบันทึก ${n} รายการ`,
            total: "มูลค่ารวม",
            save: "บันทึกเข้าคลัง",
            pickCategory: "เลือกหมวดหมู่",
            pickUnit: "เลือกหน่วยนับ",
            partial: (ok: number, fail: number) => `บันทึกได้ ${ok} · ไม่สำเร็จ ${fail}`,
            addRow: "เพิ่มวัตถุดิบ",
          }
        : {
            title: "Add several",
            cancel: "Cancel",
            clear: "Clear",
            defaultCategory: "Category for new ingredients",
            applyAll: "Apply this category to every ingredient",
            noCategory: "Uncategorised",
            name: "Ingredient name",
            quantity: "Qty",
            price: "Price",
            ready: (n: number) => `${n} ready to save`,
            total: "Total value",
            save: "Save to inventory",
            pickCategory: "Pick a category",
            pickUnit: "Pick a unit",
            partial: (ok: number, fail: number) => `Saved ${ok} · failed ${fail}`,
            addRow: "Add ingredient",
          },
    [lang],
  );

  const [defaultCategory, setDefaultCategory] = useState(0);
  // The key counter lives in a ref and is advanced OUTSIDE the state updater.
  // It used to be a module-level nextKey++ inside the updater, which React is
  // free to call more than once per update — a side effect there is a bug
  // waiting for the first double invocation.
  const nextKey = useRef(2);
  const takeKey = useCallback(() => {
    nextKey.current += 1;
    return nextKey.current;
  }, []);
  // Lazy initialiser: without it emptyRow ran on every render, burning a key
  // each time for a value React throws away after mount.
  const [rows, setRows] = useState<Row[]>(() => [emptyRow(1, 0, UNITS[1])]);
  const [picker, setPicker] = useState<{ kind: "category" | "unit"; key: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const filled = rows.filter((row) => row.name.trim() !== "");
  const total = filled.reduce(
    (sum, row) => sum + (Number(row.quantity) || 0) * (Number(row.price) || 0),
    0,
  );

  function patch(key: number, changes: Partial<Row>) {
    const spare = takeKey();
    setRows((current) => {
      const next = current.map((row) => (row.key === key ? { ...row, ...changes } : row));
      // Typing a name into the last row still opens a fresh one, so a fast typist
      // never has to reach for the button.
      const last = next[next.length - 1];
      if (last.name.trim() !== "") next.push(emptyRow(spare, defaultCategory, UNITS[1]));
      return next;
    });
  }

  function addRow() {
    const key = takeKey();
    setRows((current) => [...current, emptyRow(key, defaultCategory, UNITS[1])]);
  }

  async function save() {
    setBusy(true);
    setError("");
    try {
      const results = await actions.createMany(
        filled.map((row) => ({
          name: row.name.trim(),
          category_id: row.categoryId || undefined,
          unit: row.unit,
          stock: Number(row.quantity) || 0,
          min_stock: 0,
          cost_per_unit: Number(row.price) || 0,
        })),
      );
      const failed = results.filter((result) => !result.ok);
      if (failed.length > 0) {
        // Name the rows that failed instead of a bare count — the reason is per
        // row, and a generic message sends people looking for the wrong cause.
        setError(
          `${copy.partial(results.length - failed.length, failed.length)}: ${failed
            .map((f) => `${f.name}${f.error ? ` (${f.error})` : ""}`)
            .join(", ")}`,
        );
        setBusy(false);
        return;
      }
      onSaved(results.length);
    } catch {
      setError(lang === "th" ? "บันทึกไม่สำเร็จ" : "Could not save");
      setBusy(false);
    }
  }

  return (
    <div data-inventory-mobile className="min-h-dvh bg-(--inv-canvas) text-(--inv-body) pb-32">
      <ScreenNav
        title={copy.title}
        onBack={onCancel}
        trailing={
          <button
            type="button"
            onClick={() => setRows([emptyRow(takeKey(), defaultCategory, UNITS[1])])}
            className={`ui-press px-2 text-[15px] font-medium text-(--inv-action) ${TAP}`}
          >
            {copy.clear}
          </button>
        }
      />

      <div className="space-y-3 px-4 pt-3">
        <div>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-(--inv-muted)">
            {copy.defaultCategory}
          </p>
          <ChipRow
            value={defaultCategory}
            onChange={setDefaultCategory}
            options={[
              { value: 0, label: copy.noCategory },
              ...categories.map((c) => ({ value: c.ID, label: c.name })),
            ]}
          />
          <button
            type="button"
            onClick={() =>
              setRows((current) => current.map((row) => ({ ...row, categoryId: defaultCategory })))
            }
            className={`ui-press mt-1 text-[13px] font-semibold text-(--inv-action) ${TAP}`}
          >
            {copy.applyAll}
          </button>
        </div>

        {rows.map((row) => {
          const subtotal = (Number(row.quantity) || 0) * (Number(row.price) || 0);
          const categoryName =
            categories.find((c) => c.ID === row.categoryId)?.name ?? copy.noCategory;
          return (
            <div
              key={row.key}
              className="rounded-(--inv-radius-lg) border border-(--inv-hairline) bg-(--inv-surface) p-3 shadow-(--inv-shadow)"
            >
              <input
                type="text"
                value={row.name}
                onChange={(event) => patch(row.key, { name: event.target.value })}
                placeholder={copy.name}
                className={`${inputBase} h-[52px] border-(--inv-hairline)`}
              />

              <div className="mt-2 grid grid-cols-3 overflow-hidden rounded-(--inv-radius) border border-(--inv-hairline)">
                <input
                  type="number"
                  inputMode="decimal"
                  value={row.quantity}
                  onChange={(event) => patch(row.key, { quantity: event.target.value })}
                  placeholder={copy.quantity}
                  className="min-h-[52px] w-full bg-transparent px-2 text-center text-[16px] tabular-nums text-(--inv-heading) outline-none placeholder:text-(--inv-faint)"
                />
                <button
                  type="button"
                  onClick={() => setPicker({ kind: "unit", key: row.key })}
                  className={`ui-press border-x border-(--inv-hairline) px-2 text-[15px] text-(--inv-body) ${TAP}`}
                >
                  {row.unit}
                </button>
                <input
                  type="number"
                  inputMode="decimal"
                  value={row.price}
                  onChange={(event) => patch(row.key, { price: event.target.value })}
                  placeholder={copy.price}
                  className="min-h-[52px] w-full bg-transparent px-2 text-center text-[16px] tabular-nums text-(--inv-heading) outline-none placeholder:text-(--inv-faint)"
                />
              </div>

              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPicker({ kind: "category", key: row.key })}
                  className={`ui-press max-w-[55%] shrink-0 truncate rounded-full bg-(--inv-surface-strong) px-3 py-1 text-[12px] text-(--inv-muted) ${TAP}`}
                >
                  {categoryName}
                </button>
                <span className="ml-auto text-[13px] font-semibold tabular-nums text-(--inv-heading)">
                  {formatCurrency(subtotal, lang)}
                </span>
                {row.name.trim() !== "" && (
                  <button
                    type="button"
                    aria-label={lang === "th" ? "ลบวัตถุดิบนี้" : "Remove this ingredient"}
                    onClick={() => setRows((current) => current.filter((r) => r.key !== row.key))}
                    className={`ui-press flex h-11 w-11 shrink-0 items-center justify-center rounded-(--inv-radius) text-(--inv-out) ${TAP}`}
                  >
                    <Trash2 className="h-5 w-5" strokeWidth={2} />
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {/* Auto-append on typing is invisible until you already typed, so a row
            that is still blank looks like the end of the form. An explicit
            button is the affordance people reach for. */}
        <button
          type="button"
          onClick={addRow}
          className={`ui-press flex w-full items-center justify-center gap-2 rounded-(--inv-radius-lg) border border-dashed border-(--inv-hairline) bg-(--inv-surface) text-[15px] font-semibold text-(--inv-action) ${TAP}`}
          style={{ minHeight: 52 }}
        >
          <Plus className="h-5 w-5" strokeWidth={2} />
          {copy.addRow}
        </button>

        {error && <p className="px-1 text-[13px] leading-snug text-(--inv-out)">{error}</p>}
      </div>

      <div
        className="fixed inset-x-0 bottom-0 z-30 space-y-2 bg-(--inv-canvas) px-4 pt-3"
        style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
      >
        <div className="flex items-center justify-between text-[13px]">
          <span className="text-(--inv-muted)">{copy.ready(filled.length)}</span>
          <span className="font-semibold tabular-nums text-(--inv-heading)">
            {copy.total} {formatCurrency(total, lang)}
          </span>
        </div>
        <PrimaryButton onClick={save} disabled={filled.length === 0 || busy}>
          {copy.save}
        </PrimaryButton>
      </div>

      <BottomSheet
        open={picker?.kind === "category"}
        title={copy.pickCategory}
        onClose={() => setPicker(null)}
      >
        <PickerList
          options={[
            { value: 0, label: copy.noCategory },
            ...categories.map((c) => ({ value: c.ID, label: c.name })),
          ]}
          value={rows.find((row) => row.key === picker?.key)?.categoryId ?? 0}
          onPick={(value) => {
            if (picker) patch(picker.key, { categoryId: value });
            setPicker(null);
          }}
        />
      </BottomSheet>

      <BottomSheet open={picker?.kind === "unit"} title={copy.pickUnit} onClose={() => setPicker(null)}>
        <PickerList
          options={UNITS.map((u) => ({ value: u, label: u }))}
          value={rows.find((row) => row.key === picker?.key)?.unit ?? UNITS[1]}
          onPick={(value) => {
            if (picker) patch(picker.key, { unit: value });
            setPicker(null);
          }}
        />
      </BottomSheet>
    </div>
  );
}
