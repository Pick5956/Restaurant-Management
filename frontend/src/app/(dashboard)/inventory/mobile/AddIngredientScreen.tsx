"use client";

import { useMemo, useState } from "react";
import { Check, ChevronRight } from "lucide-react";
import { formatCurrency, formatAdaptiveNumber as formatNumber } from "@/src/lib/format";
import type { Ingredient, IngredientCategory } from "@/src/types/ingredient";
import { UNITS, reorderQuantityFor } from "../inventoryPageUtils";
import type { useInventoryData } from "./useInventoryData";
import {
  BottomSheet,
  FormGroup,
  FormRow,
  PrimaryButton,
  ScreenNav,
  SecondaryButton,
  TAP,
} from "./primitives";

type Actions = ReturnType<typeof useInventoryData>["actions"];

export default function AddIngredientScreen({
  lang,
  categories,
  editing,
  onCancel,
  onSaved,
  actions,
}: {
  lang: "th" | "en";
  categories: IngredientCategory[];
  editing: Ingredient | null;
  onCancel: () => void;
  onSaved: (name: string) => void;
  actions: Actions;
}) {
  const copy = useMemo(
    () =>
      lang === "th"
        ? {
            title: editing ? "แก้ไขวัตถุดิบ" : "เพิ่มวัตถุดิบ",
            cancel: "ยกเลิก",
            save: editing ? "บันทึกการแก้ไข" : "บันทึกวัตถุดิบ",
            groupInfo: "ข้อมูลวัตถุดิบ",
            groupStock: "ยอดเริ่มต้นและราคา",
            groupSummary: "สรุป",
            name: "ชื่อ",
            namePlaceholder: "เช่น หมูสับ",
            category: "หมวดหมู่",
            unit: "หน่วยนับ",
            openingStock: "จำนวนเริ่มต้น",
            price: "ราคาต่อหน่วย",
            minStock: "แจ้งเตือนเมื่อต่ำกว่า",
            minAsPercent: "ตั้งเป็น %",
            minAsAmount: "ตั้งเป็นจำนวน",
            warnsAt: (amount: string, unit: string, max: string) =>
              `จะเตือนเมื่อเหลือ ${amount} ${unit} · เต็ม ${max} ${unit}`,
            minNote: "ค่านี้เป็นเส้นแจ้งเตือน ใช้ตัดสินว่าวัตถุดิบอยู่ในสถานะใกล้หมดหรือยัง",
            openingValue: "มูลค่าเริ่มต้น",
            pickCategory: "เลือกหมวดหมู่",
            pickUnit: "เลือกหน่วยนับ",
            noCategory: "ไม่มีหมวด",
            nameRequired: "กรอกชื่อวัตถุดิบก่อน",
            stockLocked: "แก้จำนวนที่นี่ไม่ได้ ใช้ปุ่มเติมสต็อกหรือปรับยอดแทน",
          }
        : {
            title: editing ? "Edit ingredient" : "Add ingredient",
            cancel: "Cancel",
            save: editing ? "Save changes" : "Save ingredient",
            groupInfo: "Ingredient",
            groupStock: "Opening stock and price",
            groupSummary: "Summary",
            name: "Name",
            namePlaceholder: "e.g. Minced pork",
            category: "Category",
            unit: "Unit",
            openingStock: "Opening quantity",
            price: "Unit price",
            minStock: "Warn below",
            minAsPercent: "As %",
            minAsAmount: "As a quantity",
            warnsAt: (amount: string, unit: string, max: string) =>
              `warns at ${amount} ${unit} · full at ${max} ${unit}`,
            minNote: "This is the reorder line — it decides when an ingredient counts as low.",
            openingValue: "Opening value",
            pickCategory: "Pick a category",
            pickUnit: "Pick a unit",
            noCategory: "Uncategorised",
            nameRequired: "Enter a name first",
            stockLocked: "Quantity is not editable here — use restock or set-quantity instead",
          },
    [lang, editing],
  );

  const [name, setName] = useState(editing?.name ?? "");
  const [categoryId, setCategoryId] = useState(editing?.category_id ?? 0);
  const [unit, setUnit] = useState(editing?.unit ?? UNITS[1]);
  const [stock, setStock] = useState(editing ? String(editing.stock) : "");
  const [price, setPrice] = useState(editing ? String(editing.cost_per_unit) : "");
  const [minStock, setMinStock] = useState(editing ? String(editing.min_stock) : "");
  // A percentage is only on offer once this shelf has a maximum to be a
  // percentage of; a brand new ingredient has none, so it types a quantity.
  const shelfMax = editing?.max_stock ?? 0;
  const [minPercent, setMinPercent] = useState(editing?.min_percent ?? 0);
  const [picker, setPicker] = useState<"none" | "category" | "unit">("none");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const openingValue = (Number(stock) || 0) * (Number(price) || 0);
  const categoryName = categories.find((c) => c.ID === categoryId)?.name ?? copy.noCategory;

  async function save() {
    if (!name.trim()) {
      setError(copy.nameRequired);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const payload = {
        name: name.trim(),
        category_id: categoryId || undefined,
        unit,
        // The API validates stock on PUT but the repository never writes the
        // column, so an edit would silently discard it. Send the existing value
        // on edit and the typed one only on create.
        stock: editing ? editing.stock : Number(stock) || 0,
        min_stock: Number(minStock) || 0,
        min_percent: minPercent,
        cost_per_unit: Number(price) || 0,
      };
      if (editing) await actions.update(editing.ID, payload);
      else await actions.create(payload);
      onSaved(payload.name);
    } catch (err) {
      setError(
        String(
          (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
            (lang === "th" ? "บันทึกไม่สำเร็จ" : "Could not save"),
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-inventory-mobile className="min-h-dvh bg-(--inv-canvas) text-(--inv-body) pb-28">
      {/* Chevron, not a "ยกเลิก" word: the bottom bar already carries a
          cancel button, and two of them on one screen read as two different
          outcomes. */}
      <ScreenNav title={copy.title} onBack={onCancel} />

      <div className="px-4 pt-4">
        <FormGroup label={copy.groupInfo}>
          <FormRow label={copy.name}>
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={copy.namePlaceholder}
              className="w-full bg-transparent text-right text-[16px] text-(--inv-heading) outline-none placeholder:text-(--inv-faint)"
            />
          </FormRow>
          <FormRow label={copy.category} onPress={() => setPicker("category")}>
            <span className="truncate text-[15px] text-(--inv-muted)">{categoryName}</span>
            <ChevronRight className="h-4 w-4 shrink-0 text-(--inv-faint)" strokeWidth={2} />
          </FormRow>
          <FormRow label={copy.unit} onPress={() => setPicker("unit")} divider={false}>
            <span className="truncate text-[15px] text-(--inv-muted)">{unit}</span>
            <ChevronRight className="h-4 w-4 shrink-0 text-(--inv-faint)" strokeWidth={2} />
          </FormRow>
        </FormGroup>

        <FormGroup label={copy.groupStock}>
          <FormRow label={copy.openingStock} suffix={unit}>
            {editing ? (
              <span className="text-[15px] tabular-nums text-(--inv-faint)">{editing.stock}</span>
            ) : (
              <input
                type="number"
                inputMode="decimal"
                value={stock}
                onChange={(event) => setStock(event.target.value)}
                placeholder="0"
                className="w-full bg-transparent text-right text-[16px] tabular-nums text-(--inv-heading) outline-none placeholder:text-(--inv-faint)"
              />
            )}
          </FormRow>
          <FormRow label={copy.price} suffix={`฿/${unit}`}>
            <input
              type="number"
              inputMode="decimal"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              placeholder="0"
              className="w-full bg-transparent text-right text-[16px] tabular-nums text-(--inv-heading) outline-none placeholder:text-(--inv-faint)"
            />
          </FormRow>
          {minPercent > 0 && shelfMax > 0 ? (
            <FormRow label={copy.minStock} suffix="%" divider={false}>
              <div className="flex w-full items-center gap-3">
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={minPercent}
                  onChange={(event) => {
                    const percent = Number(event.target.value);
                    setMinPercent(percent);
                    setMinStock(String(reorderQuantityFor(shelfMax, percent)));
                  }}
                  className="h-9 flex-1 accent-(--inv-action)"
                />
                <span className="w-9 shrink-0 text-right text-[16px] tabular-nums text-(--inv-heading)">
                  {minPercent}
                </span>
              </div>
            </FormRow>
          ) : (
            <FormRow label={copy.minStock} suffix={unit} divider={false}>
              <input
                type="number"
                inputMode="decimal"
                value={minStock}
                onChange={(event) => {
                  setMinStock(event.target.value);
                  setMinPercent(0);
                }}
                placeholder="0"
                className="w-full bg-transparent text-right text-[16px] tabular-nums text-(--inv-heading) outline-none placeholder:text-(--inv-faint)"
              />
            </FormRow>
          )}
        </FormGroup>
        {shelfMax > 0 ? (
          <div className="-mt-4 mb-[22px] flex items-baseline justify-between gap-3 px-1">
            <span className="text-[11px] leading-snug text-(--inv-faint)">
              {minPercent > 0
                ? copy.warnsAt(formatNumber(Number(minStock) || 0, lang), unit, formatNumber(shelfMax, lang))
                : ""}
            </span>
            <button
              type="button"
              onClick={() => {
                const next = minPercent > 0 ? 0 : 20;
                setMinPercent(next);
                if (next > 0) setMinStock(String(reorderQuantityFor(shelfMax, next)));
              }}
              className="shrink-0 text-[11px] font-semibold text-(--inv-action)"
            >
              {minPercent > 0 ? copy.minAsAmount : copy.minAsPercent}
            </button>
          </div>
        ) : null}
        <p className="-mt-4 mb-[22px] px-1 text-[11px] leading-snug text-(--inv-faint)">
          {copy.minNote}
        </p>

        {editing && (
          <p className="-mt-3 mb-[22px] px-1 text-[11px] leading-snug text-(--inv-faint)">
            {copy.stockLocked}
          </p>
        )}

        {!editing && (
          <FormGroup label={copy.groupSummary}>
            <FormRow label={copy.openingValue} divider={false}>
              <span className="text-[15px] font-semibold tabular-nums text-(--inv-heading)">
                {formatCurrency(openingValue, lang)}
              </span>
            </FormRow>
          </FormGroup>
        )}

        {error && <p className="mb-4 px-1 text-[13px] text-(--inv-out)">{error}</p>}
      </div>

      <div
        className="fixed inset-x-0 bottom-0 z-30 flex gap-2 bg-(--inv-canvas) px-4 pt-3"
        style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
      >
        <SecondaryButton onClick={onCancel}>{copy.cancel}</SecondaryButton>
        <PrimaryButton onClick={save} disabled={busy || !name.trim()}>
          {copy.save}
        </PrimaryButton>
      </div>

      <BottomSheet
        open={picker === "category"}
        title={copy.pickCategory}
        onClose={() => setPicker("none")}
      >
        <PickerList
          options={[
            { value: 0, label: copy.noCategory },
            ...categories.map((c) => ({ value: c.ID, label: c.name })),
          ]}
          value={categoryId}
          onPick={(value) => {
            setCategoryId(value);
            setPicker("none");
          }}
        />
      </BottomSheet>

      <BottomSheet open={picker === "unit"} title={copy.pickUnit} onClose={() => setPicker("none")}>
        <PickerList
          options={UNITS.map((u) => ({ value: u, label: u }))}
          value={unit}
          onPick={(value) => {
            setUnit(value);
            setPicker("none");
          }}
        />
      </BottomSheet>
    </div>
  );
}

export function PickerList<T extends string | number>({
  options,
  value,
  onPick,
}: {
  options: { value: T; label: string }[];
  value: T;
  onPick: (value: T) => void;
}) {
  return (
    <div className="-mx-1">
      {options.map((option, index) => (
        <button
          key={String(option.value)}
          type="button"
          onClick={() => onPick(option.value)}
          className={`ui-press flex w-full items-center justify-between gap-3 px-1 text-left text-[15px] ${TAP} ${
            index > 0 ? "border-t border-(--inv-hairline)" : ""
          } ${option.value === value ? "font-semibold text-(--inv-heading)" : "text-(--inv-body)"}`}
        >
          <span className="truncate">{option.label}</span>
          {option.value === value && (
            <Check className="h-5 w-5 shrink-0 text-(--inv-action)" strokeWidth={2} />
          )}
        </button>
      ))}
    </div>
  );
}
