"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Gift, Package, Percent, Plus, ReceiptText, Trash2, type LucideIcon } from "lucide-react";
import { useBackdropClose } from "@/src/hooks/useBackdropClose";
import { apiErrorMessage } from "@/src/lib/apiErrors";
import type { AppLanguage } from "@/src/lib/format";
import { toDashboardDate } from "@/src/lib/homeDashboard";
import {
  createPromotion,
  deletePromotion,
  promotionTypes,
  updatePromotion,
  type Promotion,
  type PromotionDiscountKind,
  type PromotionType,
} from "@/src/lib/promotion";
import type { Category, MenuItem } from "@/src/types/menu";
import { useConfirm, useToast } from "@/src/components/shared/FeedbackProvider";
import NumberInput from "@/src/components/shared/NumberInput";
import ThemedTimeInput from "@/src/components/shared/ThemedTimeInput";
import DishPicker from "./DishPicker";
import type { PromotionCopy } from "./promotionCopy";
import {
  EVERY_DAY,
  WEEK_ORDER,
  dayLabel,
  formToPromotionInput,
  promotionFormProblems,
  type PromotionForm,
  type PromotionFormProblem,
  type PromotionNames,
  type TargetRef,
} from "./promotionRules";

const TYPE_ICONS: Record<PromotionType, LucideIcon> = {
  buy_x_get_y: Gift,
  item_discount: Percent,
  bundle_price: Package,
  bill_discount: ReceiptText,
};

const DAY_NAMES: Record<AppLanguage, readonly string[]> = {
  th: ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"],
  en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
};

// The first time someone switches to set hours or set dates, start from a
// value that means something instead of 00:00 or an empty calendar.
const DEFAULT_HOURS = { startTime: "11:00", endTime: "14:00" };
const DEFAULT_DAYS = 6;

// Day bits follow Date.getDay(): Sunday 0 ... Saturday 6.
const WEEKDAYS_MASK = 0b0111110;
const WEEKEND_MASK = 0b1000001;

const MAX_MONEY = 1_000_000;

const inputClass =
  "h-10 w-full rounded-md border border-gray-200 bg-white px-3 text-[16px] text-gray-950 outline-none transition-colors placeholder:text-gray-400 hover:border-gray-300 focus:border-orange-500 dark:border-gray-800 dark:bg-gray-900 dark:text-white dark:placeholder:text-gray-500 dark:hover:border-gray-700 dark:focus:border-orange-500 sm:text-[14px]";
const invalidClass = "border-red-400 dark:border-red-500/70";
const labelClass = "mb-1.5 block text-[12px] font-medium text-gray-500 dark:text-gray-400";

// The schedule's choices (days, hours, dates) are marked the way the type
// picker above them is - the one treatment the owner kept on 2026-09-21: an
// orange edge and ring over a light orange fill, never a near-black block.
const scheduleLabelClass = "mb-2 block text-[13px] font-semibold text-gray-800 dark:text-gray-200";
const choiceBase =
  "inline-flex h-9 items-center justify-center rounded-md border px-3 text-[13px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-700 dark:focus-visible:outline-orange-400";
const choiceOn =
  "border-orange-500 bg-orange-50 text-gray-950 ring-1 ring-orange-500 dark:border-orange-500 dark:bg-orange-500/10 dark:text-white";
const choiceOff =
  "border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800";

type PromotionDialogProps = {
  initial: PromotionForm;
  menus: MenuItem[];
  categories: Category[];
  names: PromotionNames;
  copy: PromotionCopy;
  language: AppLanguage;
  onClose: () => void;
  onSaved: (promotion: Promotion, created: boolean) => void;
  onDeleted: (promotionId: number) => void;
};

function Problem({ id, text }: { id?: string; text?: string }) {
  if (!text) return null;
  return <p id={id} className="mt-1.5 text-[12px] font-medium text-red-600 dark:text-red-400">{text}</p>;
}

/** A two-way choice drawn as one control; real radios keep arrow keys and focus native. */
function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  appearance = "track",
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  /** "chips" is the schedule's filled look; "track" the older raised-on-track one. */
  appearance?: "track" | "chips";
}) {
  const name = useId();
  const chips = appearance === "chips";
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={chips ? "grid grid-cols-2 gap-1.5" : "inline-flex rounded-md border border-gray-200 bg-gray-100 p-0.5 dark:border-gray-800 dark:bg-gray-950"}
    >
      {options.map((option) => (
        <label
          key={option.value}
          className={
            chips
              ? `${choiceBase} cursor-pointer has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-orange-700 dark:has-[:focus-visible]:outline-orange-400 ${
                  value === option.value ? choiceOn : choiceOff
                }`
              : "flex h-8 cursor-pointer items-center rounded-[5px] px-3 text-[12px] font-semibold text-gray-500 transition-colors hover:text-gray-800 has-[:checked]:bg-white has-[:checked]:text-gray-950 has-[:checked]:shadow-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-orange-700 dark:text-gray-400 dark:hover:text-gray-200 dark:has-[:checked]:bg-gray-800 dark:has-[:checked]:text-white dark:has-[:focus-visible]:outline-orange-400"
          }
        >
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
            className="sr-only"
          />
          {option.label}
        </label>
      ))}
    </div>
  );
}

function MoneyField({
  label,
  value,
  onValue,
  unit,
  placeholder,
  blankWhenZero,
  invalid,
  describedBy,
}: {
  label: string;
  value: number;
  onValue: (value: number) => void;
  unit: string;
  placeholder?: string;
  blankWhenZero?: boolean;
  invalid?: boolean;
  describedBy?: string;
}) {
  return (
    <label className="block">
      <span className={labelClass}>{label}</span>
      <span className="relative block">
        <NumberInput
          value={value}
          onValue={onValue}
          min={0}
          max={MAX_MONEY}
          step="0.01"
          blankWhenZero={blankWhenZero}
          placeholder={placeholder}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={`${inputClass} pr-12 font-mono tabular-nums ${invalid ? invalidClass : ""}`}
        />
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[12px] text-gray-500 dark:text-gray-400">{unit}</span>
      </span>
    </label>
  );
}

export default function PromotionDialog({
  initial,
  menus,
  categories,
  names,
  copy,
  language,
  onClose,
  onSaved,
  onDeleted,
}: PromotionDialogProps) {
  const { showToast } = useToast();
  const confirm = useConfirm();
  const [form, setForm] = useState<PromotionForm>(initial);
  const [showProblems, setShowProblems] = useState(false);
  const [busy, setBusy] = useState<"saving" | "deleting" | null>(null);
  // Stable keys, so removing a slot does not hand its open picker to the next one.
  const [slotKeys, setSlotKeys] = useState(() => initial.slots.map((_, index) => index));
  const nextSlotKey = useRef(initial.slots.length);
  // While a save or delete is on its way the dialog stays: closing it then
  // would look like backing out, and the change would still land a moment later.
  const close = () => {
    if (busy === null) onClose();
  };
  const backdrop = useBackdropClose(close);
  const titleId = useId();
  const problemId = useId();
  const typeGroup = useId();

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  const set = (patch: Partial<PromotionForm>) => setForm((current) => ({ ...current, ...patch }));
  const problems = promotionFormProblems(form);
  const problem = (key: PromotionFormProblem) => (showProblems && problems.includes(key) ? copy.problems[key] : undefined);
  const problemIdFor = (key: PromotionFormProblem) => (problem(key) ? `${problemId}-${key}` : undefined);

  const setSlot = (index: number, patch: Partial<PromotionForm["slots"][number]>) =>
    set({ slots: form.slots.map((slot, current) => (current === index ? { ...slot, ...patch } : slot)) });
  const addSlot = () => {
    set({ slots: [...form.slots, { quantity: 1, targets: [] }] });
    setSlotKeys((keys) => [...keys, nextSlotKey.current++]);
  };
  const removeSlot = (index: number) => {
    set({ slots: form.slots.filter((_, current) => current !== index) });
    setSlotKeys((keys) => keys.filter((_, current) => current !== index));
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (problems.length > 0) {
      setShowProblems(true);
      return;
    }
    setBusy("saving");
    try {
      const input = formToPromotionInput(form);
      const response = form.id === null ? await createPromotion(input) : await updatePromotion(form.id, input);
      showToast({ title: form.id === null ? copy.created : copy.saved });
      onSaved(response.data.promotion, form.id === null);
    } catch (error) {
      // The server's wording never reaches the screen; only the one failure a
      // person can fix from here gets its own message.
      const gone = /^promotion (menu item|category) not found$/.test(apiErrorMessage(error));
      showToast({ title: gone ? copy.goneTargets : copy.saveError, tone: "error" });
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (form.id === null || busy) return;
    const confirmed = await confirm({
      title: copy.confirmDelete(initial.name),
      confirmLabel: copy.remove,
      cancelLabel: copy.cancel,
      tone: "danger",
    });
    if (!confirmed) return;
    setBusy("deleting");
    try {
      await deletePromotion(form.id);
      showToast({ title: copy.deleted });
      onDeleted(form.id);
    } catch {
      showToast({ title: copy.deleteError, tone: "error" });
      setBusy(null);
    }
  };

  const discountKindOptions: { value: PromotionDiscountKind; label: string }[] = [
    { value: "percent", label: copy.percent },
    { value: "amount", label: copy.baht },
  ];

  const discountFields = (
    <div className="flex items-end gap-2">
      <label className="block w-36">
        <span className={labelClass}>{copy.discount}</span>
        <NumberInput
          value={form.discountValue}
          onValue={(discountValue) => set({ discountValue })}
          min={0}
          max={form.discountKind === "percent" ? 100 : MAX_MONEY}
          step="0.01"
          blankWhenZero
          aria-invalid={Boolean(problem("discount") || problem("percent")) || undefined}
          aria-describedby={problemIdFor("discount") ?? problemIdFor("percent")}
          className={`${inputClass} font-mono tabular-nums ${problem("discount") || problem("percent") ? invalidClass : ""}`}
        />
      </label>
      <div className="pb-0.5">
        <Segmented label={copy.discount} value={form.discountKind} options={discountKindOptions} onChange={(discountKind) => set({ discountKind })} />
      </div>
    </div>
  );

  const renderPicker = (selected: TargetRef[], onChange: (next: TargetRef[]) => void, label: string, invalid: boolean) => (
    <DishPicker
      label={label}
      selected={selected}
      onChange={onChange}
      menus={menus}
      categories={categories}
      names={names}
      copy={copy}
      language={language}
      invalid={invalid}
    />
  );

  return (
    <div {...backdrop} className="motion-overlay fixed inset-0 z-50 flex items-center justify-center bg-gray-950/45 p-3 backdrop-blur-sm sm:p-4">
      <form
        onSubmit={submit}
        noValidate
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="motion-dialog flex max-h-[calc(100dvh-1.5rem)] w-full max-w-lg flex-col overflow-hidden rounded-md border border-gray-200 bg-white shadow-2xl shadow-black/20 dark:border-gray-800 dark:bg-gray-900 sm:max-h-[calc(100dvh-2rem)]"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-800">
          <h2 id={titleId} className="text-[15px] font-semibold text-gray-950 dark:text-white">{form.id === null ? copy.add : copy.edit}</h2>
          <button type="button" onClick={close} disabled={busy !== null} className="ui-press h-9 shrink-0 rounded-md border border-gray-200 px-3 text-[12px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-800">
            {copy.cancel}
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-4">
          <label className="block">
            <span className={labelClass}>{copy.name}</span>
            <input
              type="text"
              value={form.name}
              maxLength={120}
              autoFocus={form.id === null}
              placeholder={copy.namePlaceholder}
              onChange={(event) => set({ name: event.target.value })}
              aria-invalid={Boolean(problem("name")) || undefined}
              aria-describedby={problemIdFor("name")}
              className={`${inputClass} ${problem("name") ? invalidClass : ""}`}
            />
            <Problem id={problemIdFor("name")} text={problem("name")} />
          </label>

          <fieldset>
            <legend className={labelClass}>{copy.type}</legend>
            <div className="grid grid-cols-2 gap-2">
              {promotionTypes.map((type) => {
                const Icon = TYPE_ICONS[type];
                return (
                  <label
                    key={type}
                    className="group flex min-h-11 cursor-pointer items-center gap-2.5 rounded-md border border-gray-200 px-3 py-2 text-[13px] font-semibold text-gray-600 transition-colors hover:bg-gray-50 has-[:checked]:border-orange-500 has-[:checked]:text-gray-950 has-[:checked]:ring-1 has-[:checked]:ring-orange-500 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-orange-500 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-800 dark:has-[:checked]:border-orange-500 dark:has-[:checked]:text-white"
                  >
                    <input
                      type="radio"
                      name={typeGroup}
                      value={type}
                      checked={form.type === type}
                      onChange={() => set({ type })}
                      className="sr-only"
                    />
                    <Icon className="h-4 w-4 shrink-0 text-gray-400 group-has-[:checked]:text-orange-600 dark:text-gray-500 dark:group-has-[:checked]:text-orange-400" aria-hidden="true" />
                    {copy.types[type]}
                  </label>
                );
              })}
            </div>
          </fieldset>

          {form.type === "buy_x_get_y" ? (
            <div>
              <div className="flex items-end gap-3">
                {([["buyQuantity", copy.buy], ["getQuantity", copy.get]] as const).map(([key, label]) => (
                  <label key={key} className="block w-24">
                    <span className={labelClass}>{label}</span>
                    <NumberInput
                      value={form[key]}
                      onValue={(value) => set({ [key]: Math.round(value) } as Partial<PromotionForm>)}
                      min={1}
                      max={99}
                      step="1"
                      inputMode="numeric"
                      aria-invalid={Boolean(problem("quantities")) || undefined}
                      aria-describedby={problemIdFor("quantities")}
                      className={`${inputClass} font-mono tabular-nums ${problem("quantities") ? invalidClass : ""}`}
                    />
                  </label>
                ))}
              </div>
              <Problem id={problemIdFor("quantities")} text={problem("quantities")} />
            </div>
          ) : null}

          {form.type === "item_discount" ? (
            <div>
              {discountFields}
              <Problem id={problemIdFor("discount") ?? problemIdFor("percent")} text={problem("discount") ?? problem("percent")} />
            </div>
          ) : null}

          {form.type === "bundle_price" ? (
            <div className="w-44">
              <MoneyField
                label={copy.bundlePrice}
                value={form.bundlePrice}
                onValue={(bundlePrice) => set({ bundlePrice })}
                unit={copy.baht}
                blankWhenZero
                invalid={Boolean(problem("bundle_price"))}
                describedBy={problemIdFor("bundle_price")}
              />
              <Problem id={problemIdFor("bundle_price")} text={problem("bundle_price")} />
            </div>
          ) : null}

          {form.type === "bill_discount" ? (
            <div className="space-y-3">
              <div className="w-44">
                <MoneyField
                  label={copy.minSubtotal}
                  value={form.minSubtotal}
                  onValue={(minSubtotal) => set({ minSubtotal })}
                  unit={copy.baht}
                  placeholder={copy.noMinimum}
                  blankWhenZero
                />
              </div>
              <div>
                {discountFields}
                <Problem id={problemIdFor("discount") ?? problemIdFor("percent")} text={problem("discount") ?? problem("percent")} />
              </div>
              {form.discountKind === "percent" ? (
                <div className="w-44">
                  <MoneyField
                    label={copy.maxDiscount}
                    value={form.maxDiscount}
                    onValue={(maxDiscount) => set({ maxDiscount })}
                    unit={copy.baht}
                    placeholder={copy.noCap}
                    blankWhenZero
                  />
                </div>
              ) : null}
            </div>
          ) : null}

          {form.type === "buy_x_get_y" || form.type === "item_discount" ? (
            <div>
              <p className={labelClass}>{copy.dishes}</p>
              {renderPicker(form.targets, (targets) => set({ targets }), copy.dishes, Boolean(problem("targets")))}
              <Problem id={problemIdFor("targets")} text={problem("targets")} />
            </div>
          ) : null}

          {form.type === "bundle_price" ? (
            <div>
              <div className="divide-y divide-gray-100 border-y border-gray-100 dark:divide-gray-800 dark:border-gray-800">
                {form.slots.map((slot, index) => (
                  <div key={slotKeys[index]} className="space-y-2 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[13px] font-semibold text-gray-900 dark:text-white">{copy.slot(index + 1)}</span>
                      <div className="flex items-center gap-2">
                        <label className="flex items-center gap-2 text-[12px] text-gray-500 dark:text-gray-400">
                          {copy.slotQuantity}
                          <NumberInput
                            value={slot.quantity}
                            onValue={(quantity) => setSlot(index, { quantity: Math.round(quantity) })}
                            min={1}
                            max={20}
                            step="1"
                            inputMode="numeric"
                            className={`${inputClass} h-8 w-16 px-2 text-center font-mono tabular-nums`}
                          />
                        </label>
                        {form.slots.length > 1 ? (
                          <button
                            type="button"
                            onClick={() => removeSlot(index)}
                            aria-label={copy.removeSlot(index + 1)}
                            title={copy.removeSlot(index + 1)}
                            className="ui-press inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-red-600 dark:hover:bg-gray-800 dark:hover:text-red-400"
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </button>
                        ) : null}
                      </div>
                    </div>
                    {renderPicker(slot.targets, (targets) => setSlot(index, { targets }), copy.slot(index + 1), Boolean(problem("bundle_slots")) && slot.targets.length === 0)}
                  </div>
                ))}
              </div>
              <Problem id={problemIdFor("bundle_slots") ?? problemIdFor("bundle_size")} text={problem("bundle_slots") ?? problem("bundle_size")} />
              <button
                type="button"
                onClick={addSlot}
                className="ui-press mt-3 inline-flex h-8 items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 text-[12px] font-semibold text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                {copy.addSlot}
              </button>
            </div>
          ) : null}

          <div className="space-y-4 border-t border-gray-100 pt-4 dark:border-gray-800">
            <div>
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <p className="text-[13px] font-semibold text-gray-800 dark:text-gray-200">{copy.days}</p>
                {/* The common sets in one tap; the one that matches is marked. */}
                <div className="flex gap-1">
                  {([
                    [copy.everyDay, EVERY_DAY],
                    [copy.weekdays, WEEKDAYS_MASK],
                    [copy.weekend, WEEKEND_MASK],
                  ] as const).map(([label, mask]) => (
                    <button
                      key={mask}
                      type="button"
                      aria-pressed={form.daysMask === mask}
                      onClick={() => set({ daysMask: mask })}
                      className={`h-7 rounded-md px-2 text-[12px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-700 dark:focus-visible:outline-orange-400 ${
                        form.daysMask === mask
                          ? "bg-orange-50 text-orange-800 dark:bg-orange-500/10 dark:text-orange-300"
                          : "text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {/* One button per day across the full width, filled when the
                  promotion runs that day. */}
              <div role="group" aria-label={copy.days} className="grid grid-cols-7 gap-1.5">
                {WEEK_ORDER.map((bit) => {
                  const on = (form.daysMask & (1 << bit)) !== 0;
                  return (
                    <button
                      key={bit}
                      type="button"
                      aria-pressed={on}
                      aria-label={DAY_NAMES[language][bit]}
                      onClick={() => set({ daysMask: form.daysMask ^ (1 << bit) })}
                      className={`${choiceBase} min-w-0 px-1 ${on ? choiceOn : choiceOff}`}
                    >
                      {dayLabel(bit, language)}
                    </button>
                  );
                })}
              </div>
              <Problem text={problem("days")} />
            </div>

            <div>
              <p className={scheduleLabelClass}>{copy.hours}</p>
              <Segmented
                appearance="chips"
                label={copy.hours}
                value={form.timed ? "timed" : "all"}
                options={[{ value: "all", label: copy.allDay }, { value: "timed", label: copy.someHours }]}
                onChange={(value) => {
                  const timed = value === "timed";
                  set(timed && !form.startTime && !form.endTime ? { timed, ...DEFAULT_HOURS } : { timed });
                }}
              />
              {form.timed ? (
                <div className="mt-2.5 grid grid-cols-2 gap-2">
                  <div>
                    <span className={labelClass}>{copy.from}</span>
                    <ThemedTimeInput value={form.startTime} onChange={(startTime) => set({ startTime })} aria-label={copy.from} />
                  </div>
                  <div>
                    <span className={labelClass}>{copy.to}</span>
                    <ThemedTimeInput value={form.endTime} onChange={(endTime) => set({ endTime })} aria-label={copy.to} />
                  </div>
                </div>
              ) : null}
              <Problem text={problem("hours")} />
            </div>

            <div>
              <p className={scheduleLabelClass}>{copy.dates}</p>
              <Segmented
                appearance="chips"
                label={copy.dates}
                value={form.dated ? "dated" : "always"}
                options={[{ value: "always", label: copy.always }, { value: "dated", label: copy.someDates }]}
                onChange={(value) => {
                  const dated = value === "dated";
                  if (!dated || form.startDate || form.endDate) {
                    set({ dated });
                    return;
                  }
                  const today = new Date();
                  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate() + DEFAULT_DAYS);
                  set({ dated, startDate: toDashboardDate(today), endDate: toDashboardDate(end) });
                }}
              />
              {form.dated ? (
                <div className="mt-2.5 grid grid-cols-2 gap-2">
                  {([["startDate", copy.startDate], ["endDate", copy.endDate]] as const).map(([key, label]) => (
                    <label key={key} className="block">
                      <span className={labelClass}>{label}</span>
                      <input
                        type="date"
                        value={form[key]}
                        onChange={(event) => set({ [key]: event.target.value } as Partial<PromotionForm>)}
                        aria-invalid={Boolean(problem("dates")) || undefined}
                        className={`${inputClass} font-mono dark:[color-scheme:dark] ${problem("dates") ? invalidClass : ""}`}
                      />
                    </label>
                  ))}
                </div>
              ) : null}
              <Problem text={problem("dates")} />
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-gray-200 px-4 py-3 dark:border-gray-800">
          {form.id !== null ? (
            <button
              type="button"
              onClick={() => void remove()}
              disabled={busy !== null}
              className="ui-press inline-flex h-10 items-center gap-1.5 rounded-md px-3 text-[13px] font-semibold text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950/30"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              {copy.remove}
            </button>
          ) : (
            <span />
          )}
          <button
            type="submit"
            disabled={busy !== null}
            className="ui-press h-10 rounded-md bg-orange-700 px-5 text-[13px] font-semibold text-white transition-colors hover:bg-orange-800 disabled:opacity-50 dark:bg-orange-700 dark:text-white dark:hover:bg-orange-800"
          >
            {copy.save}
          </button>
        </div>
      </form>
    </div>
  );
}
