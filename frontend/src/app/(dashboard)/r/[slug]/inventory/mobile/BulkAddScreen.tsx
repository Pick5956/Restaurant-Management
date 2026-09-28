"use client";

import { useMemo, useRef, useState } from "react";
import { AlertCircle, Check, ChevronRight, Plus } from "lucide-react";
import { formatCurrency, formatAdaptiveNumber as formatNumber } from "@/src/lib/format";
import type { IngredientCategory } from "@/src/types/ingredient";
import { expiryDateFromDays, formatExpiryDate, storageLabel } from "../inventoryExpiryUtils";
import { TOTAL_PRICE } from "../inventoryUnitUtils";
import { inventoryErrorMessage, validateIngredientForm } from "../inventoryFormValidation";
import type { useInventoryData } from "./useInventoryData";
import AddIngredientScreen, { createInputFor, emptyMobileDraft, type MobileIngredientDraft } from "./AddIngredientScreen";
import { FormGroup, PrimaryButton, ScreenNav, SecondaryButton } from "./primitives";

type Actions = ReturnType<typeof useInventoryData>["actions"];

type Item = { key: number; draft: MobileIngredientDraft };

// Nothing typed in it: dropped rather than kept as an empty row.
const isBlank = (draft: MobileIngredientDraft) => !draft.name.trim() && !draft.typed.stock && !draft.typed.cost;

/**
 * Several new ingredients at once, the phone's version of the web's list-and-form
 * dialog: a list of what has been filled in, and a tap opens the same form as
 * adding one ingredient — every field it has — for that row. Nothing reaches the
 * server until "บันทึกทั้งหมด".
 */
export default function BulkAddScreen({
  lang,
  categories,
  onCancel,
  onSaved,
  actions,
  existingNames,
}: {
  lang: "th" | "en";
  categories: IngredientCategory[];
  /** Every ingredient name already in the restaurant, for the duplicate check. */
  existingNames: string[];
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
            count: (n: number) => `${n} รายการ`,
            toFix: (n: number) => `ต้องแก้ ${n}`,
            unnamed: "ยังไม่ตั้งชื่อ",
            newItem: "วัตถุดิบใหม่",
            addRow: "เพิ่มวัตถุดิบ",
            hint: "แตะรายการเพื่อแก้ · ยังไม่มีอะไรเข้าคลังจนกด “บันทึกทั้งหมด”",
            save: (n: number) => `บันทึกทั้งหมด (${n})`,
            paid: "จ่าย",
            expires: (date: string) => `หมดอายุ ${date}`,
            fixFirst: "ยังบันทึกไม่ได้ แก้รายการที่มีเครื่องหมายส้มก่อน",
            partial: (ok: number, fail: number) => `บันทึกได้ ${ok} · ไม่สำเร็จ ${fail}`,
            failed: "บันทึกไม่สำเร็จ",
          }
        : {
            title: "Add several",
            cancel: "Cancel",
            count: (n: number) => `${n} items`,
            toFix: (n: number) => `${n} to fix`,
            unnamed: "Unnamed",
            newItem: "New ingredient",
            addRow: "Add ingredient",
            hint: "Tap an item to edit · nothing is saved until “Save all”",
            save: (n: number) => `Save all (${n})`,
            paid: "paid",
            expires: (date: string) => `expires ${date}`,
            fixFirst: "Fix the items marked in orange first",
            partial: (ok: number, fail: number) => `Saved ${ok} · failed ${fail}`,
            failed: "Could not save",
          },
    [lang],
  );

  // Keys come from a ref advanced outside any state updater, which React may
  // call twice — a counter bumped in there would skip or repeat.
  const nextKey = useRef(1);
  const takeKey = () => nextKey.current++;
  // It opens straight on the first ingredient's form: that is the next thing
  // anyone does here, and the list has nothing to show yet.
  const [items, setItems] = useState<Item[]>(() => [{ key: 0, draft: emptyMobileDraft() }]);
  const [openKey, setOpenKey] = useState<number | null>(0);
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const namesExcept = (key: number) => items.filter((item) => item.key !== key).map((item) => item.draft.name);

  // Each row checked as the add-one form checks it, plus against the batch.
  const problems = new Map(
    items.map((item) => {
      const { draft } = item;
      const errors = validateIngredientForm(
        {
          name: draft.name,
          existingNames,
          batchNames: namesExcept(item.key),
          packUnit: draft.packUnit,
          packSize: draft.packSize,
          caseUnit: draft.caseUnit,
          caseSize: draft.caseSize,
          stockText: draft.typed.stock,
          costText: draft.typed.cost,
          creating: true,
        },
        lang,
      );
      return [item.key, Object.values(errors).find(Boolean) ?? null];
    }),
  );
  const badCount = items.filter((item) => problems.get(item.key)).length;

  function addItem() {
    // A new row starts in the category of the one before — a batch is usually
    // one delivery of one kind of thing.
    const key = takeKey();
    const last = items[items.length - 1];
    setItems((current) => [...current, { key, draft: emptyMobileDraft(last?.draft.categoryId ?? 0) }]);
    setOpenKey(key);
  }

  function finish(key: number, draft: MobileIngredientDraft) {
    setItems((current) =>
      isBlank(draft) ? current.filter((item) => item.key !== key) : current.map((item) => (item.key === key ? { key, draft } : item)),
    );
    setOpenKey(null);
  }

  function remove(key: number) {
    setItems((current) => current.filter((item) => item.key !== key));
    setOpenKey(null);
  }

  async function save() {
    if (badCount > 0) {
      setShowErrors(true);
      setError(copy.fixFirst);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const results = await actions.createMany(items.map((item) => createInputFor(item.draft)));
      const failed = results.filter((result) => !result.ok);
      if (failed.length === 0) {
        onSaved(results.length);
        return;
      }
      // Keep only the rows that did not go in, so trying again cannot add the
      // others a second time; name each failure with its own reason.
      setItems((current) => current.filter((_, index) => !results[index].ok));
      setError(
        `${copy.partial(results.length - failed.length, failed.length)}: ${failed
          .map((f) => `${f.name}${f.error ? ` (${inventoryErrorMessage(f.error, lang)})` : ""}`)
          .join(", ")}`,
      );
    } catch {
      setError(copy.failed);
    } finally {
      setBusy(false);
    }
  }

  const open = items.find((item) => item.key === openKey);
  if (open) {
    return (
      <AddIngredientScreen
        key={open.key}
        lang={lang}
        categories={categories}
        existingNames={existingNames}
        batchNames={namesExcept(open.key)}
        editing={null}
        draft={open.draft}
        title={open.draft.name.trim() || copy.newItem}
        onDone={(draft) => finish(open.key, draft)}
        onRemove={() => remove(open.key)}
        onCancel={() => setOpenKey(null)}
        onSaved={() => setOpenKey(null)}
        actions={actions}
      />
    );
  }

  // What was typed, said back in one line: 5 แพ็ก · จ่าย ฿750 · แช่เย็น · หมดอายุ 1 ต.ค. 69
  function summary({ typed, unit, storageType, expiryDays }: MobileIngredientDraft) {
    const stock = parseFloat(typed.stock) || 0;
    const cost = parseFloat(typed.cost) || 0;
    return [
      stock > 0 ? `${formatNumber(stock, lang)} ${typed.stockIn || unit}` : null,
      typed.cost
        ? typed.costIn === TOTAL_PRICE
          ? `${copy.paid} ${formatCurrency(cost, lang)}`
          : `${formatCurrency(cost, lang)}/${typed.costIn || unit}`
        : null,
      storageLabel(storageType, lang),
      stock > 0 && expiryDays !== null ? copy.expires(formatExpiryDate(expiryDateFromDays(expiryDays), lang)) : null,
    ]
      .filter(Boolean)
      .join(" · ");
  }

  return (
    <div data-inventory-mobile className="min-h-dvh bg-(--inv-canvas) text-(--inv-body) pb-32">
      <ScreenNav title={copy.title} onBack={onCancel} />

      <div className="px-4 pt-4">
        <FormGroup
          label={
            showErrors && badCount > 0 ? `${copy.count(items.length)} · ${copy.toFix(badCount)}` : copy.count(items.length)
          }
        >
          {items.map((item) => {
            const problem = showErrors ? problems.get(item.key) : null;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setOpenKey(item.key)}
                className="ui-press flex min-h-[62px] w-full items-center gap-3 border-b border-(--inv-hairline) px-3 text-left"
              >
                {problem ? (
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-600 dark:bg-amber-950/60 dark:text-amber-300">
                    <AlertCircle className="h-3.5 w-3.5" />
                  </span>
                ) : (
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-300">
                    <Check className="h-3.5 w-3.5" />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span
                    className={`block truncate text-[15px] font-semibold ${
                      item.draft.name.trim() ? "text-(--inv-heading)" : "text-(--inv-faint)"
                    }`}
                  >
                    {item.draft.name.trim() || copy.unnamed}
                  </span>
                  <span
                    className={`block truncate text-[12px] ${
                      problem ? "text-amber-600 dark:text-amber-300" : "text-(--inv-muted)"
                    }`}
                  >
                    {problem ?? summary(item.draft)}
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-(--inv-faint)" strokeWidth={2} />
              </button>
            );
          })}
          <button
            type="button"
            onClick={addItem}
            className="ui-press flex min-h-[50px] w-full items-center gap-3 px-3 text-[15px] font-semibold text-(--inv-action)"
          >
            <Plus className="h-5 w-5" />
            {copy.addRow}
          </button>
        </FormGroup>
        <p className="px-1 text-[12px] leading-snug text-(--inv-faint)">{copy.hint}</p>
        {error && <p className="mt-3 px-1 text-[13px] text-(--inv-out)">{error}</p>}
      </div>

      <div
        className="fixed inset-x-0 bottom-0 z-30 flex gap-2 bg-(--inv-canvas) px-4 pt-3 tablet:left-[68px]"
        style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
      >
        <SecondaryButton onClick={onCancel}>{copy.cancel}</SecondaryButton>
        <PrimaryButton onClick={save} disabled={busy || items.length === 0}>
          {busy ? "..." : copy.save(items.length)}
        </PrimaryButton>
      </div>
    </div>
  );
}
