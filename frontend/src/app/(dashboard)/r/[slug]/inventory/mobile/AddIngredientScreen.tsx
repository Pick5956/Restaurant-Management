"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Check, ChevronRight } from "lucide-react";
import { formatCurrency, formatAdaptiveNumber as formatNumber } from "@/src/lib/format";
import type { Ingredient, IngredientCategory } from "@/src/types/ingredient";
import { STORAGE_TYPES, UNITS, reorderQuantityFor } from "../inventoryPageUtils";
import { defaultShelfLifeDays, expiryDateFromDays, storageLabel } from "../inventoryExpiryUtils";
import ExpiryPicker from "./ExpiryPicker";
import {
  PACK_UNITS,
  TOTAL_PRICE,
  emptyTypedAmounts,
  packExample,
  priceBreakdown,
  purchaseFactor,
  purchaseUnitChoices,
  resolveTypedAmounts,
  retargetTypedUnits,
  stockUnitHint,
  typedText,
  unitCopy,
  type TypedAmounts,
} from "../inventoryUnitUtils";
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
            storage: "ประเภทการเก็บ",
            pickStorage: "เลือกประเภทการเก็บ",
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
            storage: "Storage",
            pickStorage: "Pick a storage type",
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
  // The web form has always sent this; the phone did not, so the server filled
  // in room_temp behind its back. Now it is on the form because the expiry
  // default hangs off it.
  const [storageType, setStorageType] = useState(editing?.storage_type ?? "room_temp");
  const [expiryDays, setExpiryDays] = useState<number | null>(
    defaultShelfLifeDays(editing?.storage_type ?? "room_temp"),
  );
  // A percentage is only on offer once this shelf has a maximum to be a
  // percentage of; a brand new ingredient has none, so it types a quantity.
  const shelfMax = editing?.max_stock ?? 0;
  const [minPercent, setMinPercent] = useState(editing?.min_percent ?? 0);
  const [picker, setPicker] = useState<
    "none" | "category" | "unit" | "storage" | "pack" | "case" | "stockIn" | "minIn" | "costIn"
  >("none");
  const ucopy = unitCopy(lang);
  const [packUnit, setPackUnit] = useState(editing?.pack_unit ?? "");
  const [packSize, setPackSize] = useState(editing?.pack_size ? String(editing.pack_size) : "");
  const [caseUnit, setCaseUnit] = useState(editing?.case_unit ?? "");
  const [caseSize, setCaseSize] = useState(editing?.case_size ? String(editing.case_size) : "");
  const shape = {
    unit,
    pack_unit: packUnit,
    pack_size: Number(packSize) || 0,
    case_unit: caseUnit,
    case_size: Number(caseSize) || 0,
  };
  // Opening stock, price and reorder level exactly as typed, each with the unit
  // it was typed in — the same model as the web form, so both sides turn "2 ลัง"
  // and "จ่าย 5,000" into the same stock-unit numbers. An ingredient with a pack
  // opens with its reorder level and price in that pack.
  const [typed, setTyped] = useState<TypedAmounts>(() => {
    if (!editing) return emptyTypedAmounts;
    const pack = editing.pack_unit && (editing.pack_size ?? 0) > 0 ? editing.pack_unit : "";
    const size = pack ? (editing.pack_size as number) : 1;
    return {
      stock: "",
      stockIn: "",
      min: typedText(editing.min_stock / size),
      minIn: pack,
      cost: typedText(editing.cost_per_unit * size, pack ? 2 : 4),
      costIn: pack,
    };
  });
  const resolved = resolveTypedAmounts(shape, typed);
  const packShape = { ...shape, cost_per_unit: resolved.cost_per_unit };
  const unitChoices = purchaseUnitChoices(shape);
  const pricingTotal = typed.costIn === TOTAL_PRICE;
  const stockUnit = typed.stockIn || unit;
  const minUnit = typed.minIn || unit;
  const costUnit = pricingTotal ? unit : typed.costIn || unit;
  const minFactor = purchaseFactor(shape, typed.minIn) ?? 1;

  // Anything that changes what a unit means — the stock unit, a pack or case,
  // their sizes — goes through here, so each field's unit stays valid and an
  // empty field moves to a newly set pack.
  function reshape(
    next: Partial<{ unit: string; packUnit: string; packSize: string; caseUnit: string; caseSize: string }>,
  ) {
    const v = { unit, packUnit, packSize, caseUnit, caseSize, ...next };
    const after = {
      unit: v.unit,
      pack_unit: v.packUnit,
      pack_size: Number(v.packSize) || 0,
      case_unit: v.caseUnit,
      case_size: Number(v.caseSize) || 0,
    };
    setUnit(v.unit);
    setPackUnit(v.packUnit);
    setPackSize(v.packSize);
    setCaseUnit(v.caseUnit);
    setCaseSize(v.caseSize);
    setTyped(retargetTypedUnits(shape, after, typed));
  }

  // With opening stock, the only price anyone knows is what that stock cost:
  // the price row becomes "จ่ายไปทั้งหมด" and the price per unit is worked out.
  function changeOpeningStock(raw: string) {
    const next = { ...typed, stock: raw };
    if (!editing) {
      if ((parseFloat(raw) || 0) > 0) next.costIn = TOTAL_PRICE;
      else if (next.costIn === TOTAL_PRICE) next.costIn = packUnit && (Number(packSize) || 0) > 0 ? packUnit : "";
    }
    setTyped(next);
  }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const openingValue = resolved.stock * resolved.cost_per_unit;
  // One quiet line under a row whenever the number was typed in a unit other
  // than the stock unit, saying what it comes to — the phone has no room for
  // the conversion inside the 50px row itself.
  const stockNote =
    !editing && typed.stockIn && resolved.stock > 0
      ? ucopy.inStockUnit(formatNumber(resolved.stock, lang), unit)
      : null;
  const priceNote =
    resolved.cost_per_unit > 0 && (pricingTotal || typed.costIn)
      ? pricingTotal
        ? `${ucopy.totalFor(formatNumber(parseFloat(typed.stock) || 0, lang), stockUnit)} · ${priceBreakdown(shape, resolved.cost_per_unit, "", lang)}`
        : `= ${priceBreakdown(shape, resolved.cost_per_unit, costUnit, lang)}`
      : null;
  const minNote =
    typed.minIn && resolved.min_stock > 0 ? ucopy.inStockUnit(formatNumber(resolved.min_stock, lang), unit) : null;
  const categoryName = categories.find((c) => c.ID === categoryId)?.name ?? copy.noCategory;

  async function save() {
    if (!name.trim()) {
      setError(copy.nameRequired);
      return;
    }
    if (packUnit && !(Number(packSize) > 0)) {
      setError(ucopy.packSizeRequired(packUnit));
      return;
    }
    if (packUnit && caseUnit && !(Number(caseSize) > 0)) {
      setError(ucopy.caseSizeRequired(caseUnit));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const stockTypedIn = typed.stockIn && typed.stockIn !== unit ? typed.stockIn : "";
      const payload = {
        name: name.trim(),
        category_id: categoryId || undefined,
        unit,
        // The API validates stock on PUT but the repository never writes the
        // column, so an edit would silently discard it. Send the existing value
        // on edit and the typed one only on create.
        // Opening stock typed in a pack goes up as typed so the history row reads
        // "ยอดเริ่มต้น · กรอก 2 ลัง"; the server converts it.
        stock: editing
          ? editing.stock
          : stockTypedIn && resolved.stock > 0
            ? parseFloat(typed.stock) || 0
            : resolved.stock,
        ...(!editing && stockTypedIn && resolved.stock > 0 ? { stock_unit: stockTypedIn } : {}),
        min_stock: resolved.min_stock,
        min_percent: minPercent,
        cost_per_unit: resolved.cost_per_unit,
        storage_type: storageType,
        pack_unit: packUnit,
        pack_size: packUnit ? Number(packSize) || 0 : 0,
        case_unit: packUnit ? caseUnit : "",
        case_size: packUnit && caseUnit ? Number(caseSize) || 0 : 0,
        // Only a create with stock opens a lot, so only that case carries a date.
        ...(!editing && resolved.stock > 0 && expiryDays !== null
          ? { expires_at: expiryDateFromDays(expiryDays) }
          : {}),
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
          <FormRow label={ucopy.stockUnitLabel} onPress={() => setPicker("unit")}>
            <span className="truncate text-[15px] text-(--inv-muted)">{unit}</span>
            <ChevronRight className="h-4 w-4 shrink-0 text-(--inv-faint)" strokeWidth={2} />
          </FormRow>
          <FormRow label={copy.storage} onPress={() => setPicker("storage")} divider={false}>
            <span className="truncate text-[15px] text-(--inv-muted)">{storageLabel(storageType, lang)}</span>
            <ChevronRight className="h-4 w-4 shrink-0 text-(--inv-faint)" strokeWidth={2} />
          </FormRow>
        </FormGroup>
        {stockUnitHint(unit, lang) ? (
          <p className="-mt-4 mb-[22px] px-1 text-[11px] leading-snug text-(--inv-faint)">
            {stockUnitHint(unit, lang)}
          </p>
        ) : null}

        <FormGroup label={ucopy.groupBuy}>
          <FormRow label={ucopy.buyAs} onPress={() => setPicker("pack")} divider={packUnit !== ""}>
            <span className="truncate text-[15px] text-(--inv-muted)">{packUnit || ucopy.none}</span>
            <ChevronRight className="h-4 w-4 shrink-0 text-(--inv-faint)" strokeWidth={2} />
          </FormRow>
          {packUnit ? (
            <>
              <FormRow label={ucopy.perPack(packUnit)} suffix={unit}>
                <input
                type="number"
                inputMode="decimal"
                value={packSize}
                onChange={(event) => reshape({ packSize: event.target.value })}
                placeholder="0"
                className="w-full bg-transparent text-right text-[16px] tabular-nums text-(--inv-heading) outline-none placeholder:text-(--inv-faint)"
              />
              </FormRow>
              <FormRow label={ucopy.caseAs} onPress={() => setPicker("case")} divider={caseUnit !== ""}>
                <span className="truncate text-[15px] text-(--inv-muted)">{caseUnit || ucopy.none}</span>
                <ChevronRight className="h-4 w-4 shrink-0 text-(--inv-faint)" strokeWidth={2} />
              </FormRow>
              {caseUnit ? (
                <FormRow label={ucopy.perCase(caseUnit)} suffix={packUnit} divider={false}>
                  <input
                type="number"
                inputMode="decimal"
                value={caseSize}
                onChange={(event) => reshape({ caseSize: event.target.value })}
                placeholder="0"
                className="w-full bg-transparent text-right text-[16px] tabular-nums text-(--inv-heading) outline-none placeholder:text-(--inv-faint)"
              />
                </FormRow>
              ) : null}
            </>
          ) : null}
        </FormGroup>
        <p className="-mt-4 mb-[22px] px-1 text-[11px] leading-snug text-(--inv-faint)">
          {packExample(packShape, lang) ?? ucopy.buyNote}
        </p>

        <FormGroup label={copy.groupStock}>
          <FormRow label={copy.openingStock} divider={!stockNote}>
            {editing ? (
              <span className="text-[15px] tabular-nums text-(--inv-faint)">{formatNumber(editing.stock, lang)}</span>
            ) : (
              <input
                type="number"
                inputMode="decimal"
                value={typed.stock}
                onChange={(event) => changeOpeningStock(event.target.value)}
                placeholder="0"
                className="w-full bg-transparent text-right text-[16px] tabular-nums text-(--inv-heading) outline-none placeholder:text-(--inv-faint)"
              />
            )}
            <UnitButton
              label={editing ? unit : stockUnit}
              onPress={!editing && unitChoices.length > 1 ? () => setPicker("stockIn") : undefined}
            />
          </FormRow>
          {stockNote ? <RowNote>{stockNote}</RowNote> : null}
          {/* px-4 rather than the row's px-3: the chip row bleeds 16px to scroll
              edge to edge, and the card clips anything past its own padding. */}
          {!editing && resolved.stock > 0 ? (
            <div className="border-b border-(--inv-hairline) px-4 py-3">
              <ExpiryPicker
                key={storageType}
                value={expiryDays}
                onChange={setExpiryDays}
                storageType={storageType}
                lang={lang}
              />
            </div>
          ) : null}
          <FormRow label={pricingTotal ? ucopy.totalPaid : copy.price} divider={!priceNote}>
            <input
              type="number"
              inputMode="decimal"
              value={typed.cost}
              onChange={(event) => setTyped({ ...typed, cost: event.target.value })}
              placeholder="0"
              className="w-full bg-transparent text-right text-[16px] tabular-nums text-(--inv-heading) outline-none placeholder:text-(--inv-faint)"
            />
            <UnitButton
              label={pricingTotal ? ucopy.baht : `฿/${costUnit}`}
              onPress={!pricingTotal && unitChoices.length > 1 ? () => setPicker("costIn") : undefined}
            />
          </FormRow>
          {priceNote ? <RowNote>{priceNote}</RowNote> : null}
          {minPercent > 0 && shelfMax > 0 ? (
            <FormRow label={copy.minStock} suffix="%" divider={!minNote}>
              <div className="flex w-full items-center gap-3">
                {/* Whole tens only, the same as the web slider. */}
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={10}
                  value={Math.round(minPercent / 10) * 10}
                  onChange={(event) => {
                    const percent = Number(event.target.value);
                    setMinPercent(percent);
                    setTyped({ ...typed, min: typedText(reorderQuantityFor(shelfMax, percent) / minFactor) });
                  }}
                  className="h-9 flex-1 accent-(--inv-action)"
                />
                <span className="w-9 shrink-0 text-right text-[16px] tabular-nums text-(--inv-heading)">
                  {Math.round(minPercent)}
                </span>
              </div>
            </FormRow>
          ) : (
            <FormRow label={copy.minStock} divider={!minNote}>
              <input
                type="number"
                inputMode="decimal"
                value={typed.min}
                onChange={(event) => {
                  setTyped({ ...typed, min: event.target.value });
                  setMinPercent(0);
                }}
                placeholder="0"
                className="w-full bg-transparent text-right text-[16px] tabular-nums text-(--inv-heading) outline-none placeholder:text-(--inv-faint)"
              />
              <UnitButton
                label={minUnit}
                onPress={unitChoices.length > 1 ? () => setPicker("minIn") : undefined}
              />
            </FormRow>
          )}
          {minNote ? <RowNote>{minNote}</RowNote> : null}
        </FormGroup>
        {shelfMax > 0 ? (
          <div className="-mt-4 mb-[22px] flex items-baseline justify-between gap-3 px-1">
            <span className="text-[11px] leading-snug text-(--inv-faint)">
              {minPercent > 0
                ? copy.warnsAt(
                    formatNumber(resolved.min_stock / minFactor, lang),
                    minUnit,
                    formatNumber(shelfMax / minFactor, lang),
                  )
                : ""}
            </span>
            <button
              type="button"
              onClick={() => {
                const next = minPercent > 0 ? 0 : 20;
                setMinPercent(next);
                if (next > 0) setTyped({ ...typed, min: typedText(reorderQuantityFor(shelfMax, next) / minFactor) });
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
          options={(UNITS.includes(unit) ? UNITS : [unit, ...UNITS]).map((u) => ({ value: u, label: u }))}
          value={unit}
          onPick={(value) => {
            reshape({ unit: value });
            setPicker("none");
          }}
        />
      </BottomSheet>

      <BottomSheet open={picker === "pack"} title={ucopy.pickPack} onClose={() => setPicker("none")}>
        <PickerList
          options={[
            { value: "", label: ucopy.none },
            ...PACK_UNITS.filter((u) => u !== unit).map((u) => ({ value: u, label: u })),
          ]}
          value={packUnit}
          onPick={(value) => {
            reshape(value ? { packUnit: value } : { packUnit: "", packSize: "", caseUnit: "", caseSize: "" });
            setPicker("none");
          }}
        />
      </BottomSheet>

      <BottomSheet open={picker === "case"} title={ucopy.pickCase} onClose={() => setPicker("none")}>
        <PickerList
          options={[
            { value: "", label: ucopy.none },
            ...PACK_UNITS.filter((u) => u !== unit && u !== packUnit).map((u) => ({ value: u, label: u })),
          ]}
          value={caseUnit}
          onPick={(value) => {
            reshape(value ? { caseUnit: value } : { caseUnit: "", caseSize: "" });
            setPicker("none");
          }}
        />
      </BottomSheet>

      <BottomSheet
        open={picker === "stockIn" || picker === "minIn" || picker === "costIn"}
        title={ucopy.pickEntryUnit}
        onClose={() => setPicker("none")}
      >
        <PickerList
          options={unitChoices.map((u) => ({ value: u, label: picker === "costIn" ? `฿/${u}` : u }))}
          value={
            picker === "stockIn" ? stockUnit : picker === "minIn" ? minUnit : picker === "costIn" ? costUnit : unit
          }
          onPick={(value) => {
            const key = picker === "stockIn" || picker === "minIn" || picker === "costIn" ? picker : null;
            if (key) setTyped({ ...typed, [key]: value === unit ? "" : value });
            setPicker("none");
          }}
        />
      </BottomSheet>

      <BottomSheet open={picker === "storage"} title={copy.pickStorage} onClose={() => setPicker("none")}>
        <PickerList
          options={STORAGE_TYPES.map((type) => ({ value: type, label: storageLabel(type, lang) }))}
          value={storageType}
          onPick={(value) => {
            setStorageType(value);
            // A new storage type means a new shelf life; the picker remounts on
            // it so a custom number typed for the old one does not linger.
            setExpiryDays(defaultShelfLifeDays(value));
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

/** The unit at the end of a row, tappable when the number can be typed in another. */
function UnitButton({ label, onPress }: { label: string; onPress?: () => void }) {
  if (!onPress) {
    return <span className="w-[68px] shrink-0 text-right text-[13px] text-(--inv-muted)">{label}</span>;
  }
  return (
    <button
      type="button"
      onClick={onPress}
      className="ui-press flex w-[68px] shrink-0 items-center justify-end gap-0.5 text-[13px] font-semibold text-(--inv-action)"
    >
      <span className="truncate">{label}</span>
      <ChevronRight className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
    </button>
  );
}

/** What the row above comes to, right-aligned under its number. */
function RowNote({ children }: { children: ReactNode }) {
  return (
    <div className="-mt-2 border-b border-(--inv-hairline) px-3 pb-2 text-right text-[11px] tabular-nums text-(--inv-faint)">
      {children}
    </div>
  );
}
