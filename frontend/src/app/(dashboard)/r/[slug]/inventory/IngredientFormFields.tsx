"use client";

import ThemedSelect from "@/src/components/shared/ThemedSelect";
import NumberInput from "@/src/components/shared/NumberInput";
import { formatAdaptiveNumber as formatNumber, formatCurrency } from "@/src/lib/format";
import type { Ingredient, IngredientInput } from "@/src/types/ingredient";
import ExpiryChips from "./ExpiryChips";
import type { IngredientFieldErrors } from "./inventoryFormValidation";
import { defaultShelfLifeDays, expiryCopy, expiryDateFromDays } from "./inventoryExpiryUtils";
import { emptyForm, inputCls, reorderQuantityFor, stockUnitRows } from "./inventoryPageUtils";
import {
  emptyTypedAmounts,
  entryChain,
  packExample,
  packUnitChoices,
  purchaseFactor,
  purchaseUnitChoices,
  resolveTypedAmounts,
  retargetTypedUnits,
  typedText,
  unitCopy,
  TOTAL_PRICE,
  type TypedAmounts,
} from "./inventoryUnitUtils";

/**
 * One ingredient being filled in: `form` holds the stock-unit values the server
 * stores, `typed` the numbers exactly as typed with the unit each was typed in,
 * and `expiryDays` the opening lot's shelf life (null is "ไม่ระบุ").
 * The single-add drawer holds one of these; the bulk dialog holds a list.
 */
export type IngredientDraft = {
  form: IngredientInput;
  typed: TypedAmounts;
  expiryDays: number | null;
};

export function newIngredientDraft(categoryId = 0): IngredientDraft {
  return {
    form: { ...emptyForm, category_id: categoryId },
    typed: emptyTypedAmounts,
    expiryDays: defaultShelfLifeDays(emptyForm.storage_type),
  };
}

/** The create request for a new ingredient, exactly as the single-add drawer sends it. */
export function createPayloadFor(draft: IngredientDraft): IngredientInput {
  const { form, typed, expiryDays } = draft;
  const payload: IngredientInput = { ...form, name: form.name.trim() };
  // Opening stock typed in a pack goes up as typed, so the history row
  // reads "ยอดเริ่มต้น · กรอก 2 ลัง" — the server does the conversion.
  const stockTypedIn = typed.stockIn && typed.stockIn !== form.unit ? typed.stockIn : "";
  if (stockTypedIn && form.stock > 0) {
    payload.stock = parseFloat(typed.stock) || 0;
    payload.stock_unit = stockTypedIn;
  }
  if (form.stock > 0 && expiryDays !== null) payload.expires_at = expiryDateFromDays(expiryDays);
  return payload;
}

// Everything that changes what a typed number means goes through here: the
// typed text, the unit beside it, and the pack fields that size those units.
function applyTyped(draft: IngredientDraft, nextForm: IngredientInput, nextTyped: TypedAmounts, minFromTyped = true): IngredientDraft {
  const resolved = resolveTypedAmounts(nextForm, nextTyped);
  return {
    ...draft,
    typed: nextTyped,
    form: {
      ...nextForm,
      stock: resolved.stock,
      cost_per_unit: resolved.cost_per_unit,
      min_stock: minFromTyped ? resolved.min_stock : nextForm.min_stock,
    },
  };
}

function changePackFields(draft: IngredientDraft, patch: Partial<IngredientInput>): IngredientDraft {
  const nextForm = { ...draft.form, ...patch };
  return applyTyped(draft, nextForm, retargetTypedUnits(draft.form, nextForm, draft.typed));
}

function changeTypedStock(draft: IngredientDraft, patch: Partial<TypedAmounts>, creating: boolean): IngredientDraft {
  const { form } = draft;
  const nextTyped = { ...draft.typed, ...patch };
  // With opening stock on the form, the only price anyone knows is what that
  // stock cost, so the price box always means "total paid" and the price per
  // unit is worked out from it — there is no mode to pick. With no stock
  // there is nothing to divide by, and it goes back to a price per unit.
  if (creating) {
    const hasStock = (parseFloat(nextTyped.stock) || 0) > 0;
    if (hasStock) nextTyped.costIn = TOTAL_PRICE;
    else if (nextTyped.costIn === TOTAL_PRICE) {
      nextTyped.costIn = form.pack_unit && (form.pack_size ?? 0) > 0 ? form.pack_unit : "";
    }
  }
  const stock = resolveTypedAmounts(form, nextTyped).stock;
  // The shelf just changed size, so a reorder level held as a share of it is
  // recomputed rather than left as a quantity from the old shelf.
  if ((form.min_percent ?? 0) > 0) {
    const min = reorderQuantityFor(stock, form.min_percent ?? 0);
    const factor = purchaseFactor(form, nextTyped.minIn) ?? 1;
    return applyTyped(draft, { ...form, min_stock: min }, { ...nextTyped, min: typedText(min / factor) }, false);
  }
  return applyTyped(draft, form, nextTyped);
}

export type IngredientFormLabels = {
  name: string;
  category: string;
  manageCategories: string;
  storageType: string;
  initialStock: string;
  costPerUnit: string;
  minStock: string;
};

export default function IngredientFormFields({
  draft,
  onChange,
  editingItem,
  errors,
  labels,
  categoryOptions,
  storageOptions,
  lang,
  onManageCategories,
}: {
  draft: IngredientDraft;
  onChange: (next: IngredientDraft) => void;
  /** The ingredient being edited, or null while creating one. */
  editingItem: Ingredient | null;
  /** Only the errors to show — callers hold them back until a save is tried. */
  errors: IngredientFieldErrors;
  labels: IngredientFormLabels;
  categoryOptions: { value: string; label: string }[];
  storageOptions: { value: string; label: string }[];
  lang: "th" | "en";
  /** Shows the "จัดการหมวด" link beside the category when given. */
  onManageCategories?: () => void;
}) {
  const { form, typed } = draft;
  const ucopy = unitCopy(lang);
  const xcopy = expiryCopy(lang);
  const creating = !editingItem;
  const setForm = (patch: Partial<IngredientInput>) => onChange({ ...draft, form: { ...form, ...patch } });
  const packFields = (patch: Partial<IngredientInput>) => onChange(changePackFields(draft, patch));
  const typedStock = (patch: Partial<TypedAmounts>) => onChange(changeTypedStock(draft, patch, creating));

  // Where the reorder slider's handle sits. A percent set by dragging is kept as
  // it is; a quantity typed by hand is shown at the place it falls on this
  // shelf, so the handle is never somewhere the number is not.
  // An existing item is measured against the shelf maximum its restocks have
  // established; a new one against the opening stock being typed, which is what
  // the server records as its first maximum.
  const maxStock = editingItem ? editingItem.max_stock ?? 0 : form.stock;
  const warnPercent =
    (form.min_percent ?? 0) > 0
      ? (form.min_percent ?? 0)
      : maxStock > 0
        ? Math.max(0, Math.min(100, Math.round((form.min_stock / maxStock) * 100)))
        : 0;

  // A price is typed per a unit of the ingredient only when there is no stock
  // to divide a total by — an edit, or a new ingredient with no opening stock.
  const priceUnitOptions = purchaseUnitChoices(form).map((unit) => ({ value: unit, label: unit }));
  const pricingTotal = typed.costIn === TOTAL_PRICE;

  // The dropdown lists the containers that usually hold this kind of stock
  // first, then a disabled divider, then the rest — the web select has no
  // group headings, so the divider row stands in for one. Nothing is refused.
  function containerOptions(level: "pack" | "case", exclude: string[]) {
    const { likely, other } = packUnitChoices(form.unit, level, exclude);
    const rows: { value: string; label: string; disabled?: boolean }[] = [
      { value: "", label: level === "pack" ? ucopy.none : `${ucopy.caseAs}: ${ucopy.none}` },
      ...likely.map((unit) => ({ value: unit, label: unit })),
    ];
    if (likely.length && other.length) rows.push({ value: "__divider__", label: `── ${ucopy.otherUnits} ──`, disabled: true });
    return [...rows, ...other.map((unit) => ({ value: unit, label: unit }))];
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-slate-500 dark:text-slate-400">{labels.name}</label>
          <input
            type="text"
            value={form.name}
            onChange={(event) => setForm({ name: event.target.value })}
            className={inputCls}
            autoFocus
          />
          {errors.name ? <p className="mt-1 text-[11px] text-red-500">{errors.name}</p> : null}
        </div>
        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400">{labels.category}</label>
            {onManageCategories && (
              <button
                type="button"
                onClick={onManageCategories}
                className="text-xs font-semibold text-orange-600 transition hover:text-orange-500 dark:text-orange-300"
              >
                {labels.manageCategories}
              </button>
            )}
          </div>
          <ThemedSelect
            aria-label={labels.category}
            value={String(form.category_id ?? 0)}
            onChange={(value) => setForm({ category_id: parseInt(value, 10) || 0 })}
            options={categoryOptions}
          />
        </div>
      </div>
      {/* Order follows what each field depends on: the stock unit, then
          the packs sized in it, then the price, stock and reorder level
          that may be typed in those packs. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-slate-500 dark:text-slate-400">{ucopy.stockUnitLabel}</label>
          <ThemedSelect
            aria-label={ucopy.stockUnitLabel}
            value={form.unit}
            onChange={(value) => packFields({ unit: value })}
            options={stockUnitRows(lang, form.unit)}
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-slate-500 dark:text-slate-400">{labels.storageType}</label>
          <ThemedSelect
            aria-label={labels.storageType}
            value={form.storage_type ?? "room_temp"}
            // A new storage type means a new shelf life for the opening lot.
            onChange={(value) =>
              onChange({ ...draft, form: { ...form, storage_type: value }, expiryDays: defaultShelfLifeDays(value) })
            }
            options={storageOptions}
          />
        </div>
      </div>
      <div>
        <label className="mb-1.5 block text-xs font-semibold text-slate-500 dark:text-slate-400">{ucopy.groupBuy}</label>
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-36">
            <ThemedSelect
              aria-label={ucopy.buyAs}
              value={form.pack_unit ?? ""}
              onChange={(value) =>
                packFields({
                  pack_unit: value,
                  pack_size: value ? form.pack_size : 0,
                  case_unit: value ? form.case_unit : "",
                  case_size: value ? form.case_size : 0,
                })
              }
              options={containerOptions("pack", [])}
            />
          </div>
          {form.pack_unit ? (
            <>
              <span className="text-sm text-slate-500 dark:text-slate-400">{ucopy.perPack(form.pack_unit)}</span>
              <div className="w-28">
                <NumberInput
                  min={0}
                  blankWhenZero
                  aria-label={ucopy.perPack(form.pack_unit)}
                  value={form.pack_size ?? 0}
                  onValue={(value) => packFields({ pack_size: value })}
                  className={inputCls}
                />
              </div>
              <span className="text-sm text-slate-500 dark:text-slate-400">{form.unit}</span>
            </>
          ) : null}
        </div>
        {form.pack_unit ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <div className="w-36">
              <ThemedSelect
                aria-label={ucopy.caseAs}
                value={form.case_unit ?? ""}
                onChange={(value) => packFields({ case_unit: value, case_size: value ? form.case_size : 0 })}
                options={containerOptions("case", [form.pack_unit ?? ""])}
              />
            </div>
            {form.case_unit ? (
              <>
                <span className="text-sm text-slate-500 dark:text-slate-400">{ucopy.perCase(form.case_unit)}</span>
                <div className="w-28">
                  <NumberInput
                    min={0}
                    blankWhenZero
                    aria-label={ucopy.perCase(form.case_unit)}
                    value={form.case_size ?? 0}
                    onValue={(value) => packFields({ case_size: value })}
                    className={inputCls}
                  />
                </div>
                <span className="text-sm text-slate-500 dark:text-slate-400">{form.pack_unit}</span>
              </>
            ) : null}
          </div>
        ) : null}
        {errors.packSize ? <p className="mt-1 text-[11px] text-red-500">{errors.packSize}</p> : null}
        {errors.caseSize ? <p className="mt-1 text-[11px] text-red-500">{errors.caseSize}</p> : null}
        {packExample(form, lang) ? (
          <p className="mt-1.5 text-[11px] text-slate-400 dark:text-slate-500">{packExample(form, lang)}</p>
        ) : null}
      </div>
      {/* Opening stock comes first because the price can be read off
          it: type what was paid for that stock and the price per unit
          follows. On an existing item the price takes the whole row. */}
      <div className={creating ? "grid grid-cols-1 gap-3 sm:grid-cols-2" : "grid grid-cols-1 gap-3"}>
        {creating ? (
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-500 dark:text-slate-400">{labels.initialStock}</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={0}
                inputMode="decimal"
                aria-label={labels.initialStock}
                placeholder="0"
                value={typed.stock}
                onChange={(event) => typedStock({ stock: event.target.value })}
                className={inputCls}
              />
              {purchaseUnitChoices(form).length > 1 ? (
                <div className="w-28 shrink-0">
                  <ThemedSelect
                    aria-label={labels.initialStock}
                    value={typed.stockIn || form.unit}
                    onChange={(value) => typedStock({ stockIn: value === form.unit ? "" : value })}
                    options={purchaseUnitChoices(form).map((unit) => ({ value: unit, label: unit }))}
                  />
                </div>
              ) : null}
            </div>
            {typed.stockIn && form.stock > 0 ? (
              <p className="mt-1.5 text-[11px] text-slate-400 dark:text-slate-500">
                {entryChain(form, parseFloat(typed.stock) || 0, typed.stockIn, lang) ??
                  ucopy.inStockUnit(formatNumber(form.stock, lang), form.unit)}
              </p>
            ) : null}
            {errors.stock ? <p className="mt-1 text-[11px] text-red-500">{errors.stock}</p> : null}
          </div>
        ) : null}
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-slate-500 dark:text-slate-400">
            {pricingTotal
              ? ucopy.totalPaidFor(formatNumber(parseFloat(typed.stock) || 0, lang), typed.stockIn || form.unit)
              : priceUnitOptions.length > 1
                ? ucopy.price
                : `${labels.costPerUnit} (THB)`}
          </label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              aria-label={ucopy.price}
              value={typed.cost}
              onChange={(event) => onChange(applyTyped(draft, form, { ...typed, cost: event.target.value }))}
              className={inputCls}
            />
            {!pricingTotal && priceUnitOptions.length > 1 ? (
              <>
                <span className="shrink-0 text-sm text-slate-500 dark:text-slate-400">{ucopy.perWord}</span>
                <div className="w-28 shrink-0">
                  <ThemedSelect
                    aria-label={ucopy.price}
                    value={typed.costIn || form.unit}
                    onChange={(value) => onChange(applyTyped(draft, form, { ...typed, costIn: value === form.unit ? "" : value }))}
                    options={priceUnitOptions}
                  />
                </div>
              </>
            ) : null}
          </div>
          {typed.costIn && form.cost_per_unit > 0 ? (
            <p className="mt-1.5 text-[11px] text-slate-400 dark:text-slate-500">
              {/* Every price the typed one implies, so the owner can check
                  it against the shelf tag: แพ็กละ ฿60 · ขวดละ ฿5. */}
              {"= "}
              {purchaseUnitChoices(form)
                .slice()
                .reverse()
                .filter((unit) => unit !== typed.costIn)
                .map((unit) =>
                  ucopy.pricePerUnit(unit, formatCurrency(form.cost_per_unit * (purchaseFactor(form, unit) ?? 1), lang, 2)),
                )
                .join(" · ")}
            </p>
          ) : null}
          {errors.cost ? <p className="mt-1 text-[11px] text-red-500">{errors.cost}</p> : null}
        </div>
      </div>
      {creating && form.stock > 0 ? (
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-slate-500 dark:text-slate-400">{xcopy.label}</label>
          <ExpiryChips
            key={form.storage_type ?? "room_temp"}
            value={draft.expiryDays}
            onChange={(days) => onChange({ ...draft, expiryDays: days })}
            storageType={form.storage_type}
            lang={lang}
          />
        </div>
      ) : null}
      {/* The reorder level is set by the slider alone, in whole tens of
          the shelf's full level — 10%, 20% … 100% — so it is always a
          share people can say out loud, and it keeps tracking the shelf
          as the full level grows. The line under it says what that
          comes to in the pack and in the stock unit. */}
      <div>
        <label className="mb-1.5 block text-xs font-semibold text-slate-500 dark:text-slate-400">{labels.minStock}</label>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={0}
            max={100}
            step={10}
            aria-label={labels.minStock}
            disabled={!(maxStock > 0)}
            value={Math.round(warnPercent / 10) * 10}
            onChange={(event) => {
              const percent = Number(event.target.value);
              const min = reorderQuantityFor(maxStock, percent);
              const factor = purchaseFactor(form, typed.minIn) ?? 1;
              onChange(
                applyTyped(draft, { ...form, min_percent: percent, min_stock: min }, { ...typed, min: typedText(min / factor) }, false),
              );
            }}
            className="h-9 min-w-0 flex-1 accent-orange-500 disabled:opacity-40"
          />
          <span className="w-11 shrink-0 text-right text-sm font-semibold tabular-nums text-slate-900 dark:text-white">
            {Math.round(warnPercent)}%
          </span>
        </div>
        {maxStock > 0 ? (
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            {(() => {
              const unit = typed.minIn || form.unit;
              const factor = purchaseFactor(form, unit) ?? 1;
              return ucopy.warnLine(
                formatNumber(form.min_stock / factor, lang),
                unit,
                factor === 1 ? null : `${formatNumber(form.min_stock, lang)} ${form.unit}`,
                formatNumber(maxStock / factor, lang),
              );
            })()}
          </p>
        ) : null}
      </div>
    </div>
  );
}
