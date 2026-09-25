"use client";

// The new-ingredient card, asked one step at a time (แบบ B, chosen 25 ก.ย. 2569).
//
// "เพิ่มน้ำปลา 2 ขวด" arrives as a plan whose item is not ready to confirm: the
// unit it is counted in is unknown, and so is how much one bottle holds and
// what it cost. The card asks those in order, inside the card, and every answer
// goes to the server (setupAIPlanIngredient). What comes back — the opening
// stock, the price per unit, the expense — is Go's arithmetic; this file only
// draws it and decides which question comes next.
//
// The last step is the ordinary confirm bar, so confirming, cancelling and
// expiring behave exactly as they do for every other change.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, ChevronLeft, Package } from "lucide-react";
import InlineDbConfirmBar, { isTerminal, type InlineDbConfirmState } from "@/src/components/shared/InlineDbConfirmBar";
import { setupAIPlanIngredient } from "@/src/lib/ai";
import type { AIActionPlan, AIIngredientPriceMode, AIIngredientSetup, AIIngredientSetupAnswers } from "@/src/types/ai";

type Step = "unit" | "stock" | "pack" | "price" | "extras" | "review";
const STEP_ORDER: Step[] = ["unit", "stock", "pack", "price", "extras", "review"];

// How each question enters: from the right going forward, from the left going
// back, with the card's height following instead of jumping (25 ก.ย. 2569).
const MOTION_CSS = `
@keyframes aisc-in-fwd { from { opacity: 0; transform: translateX(18px); } to { opacity: 1; transform: none; } }
@keyframes aisc-in-back { from { opacity: 0; transform: translateX(-18px); } to { opacity: 1; transform: none; } }
@keyframes aisc-fade { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
.aisc-in-fwd { animation: aisc-in-fwd .28s cubic-bezier(.2,.9,.3,1) both; }
.aisc-in-back { animation: aisc-in-back .28s cubic-bezier(.2,.9,.3,1) both; }
.aisc-fade { animation: aisc-fade .3s cubic-bezier(.2,.9,.3,1) both; }
.aisc-height { transition: height .28s cubic-bezier(.2,.9,.3,1); }
@media (prefers-reduced-motion: reduce) {
  .aisc-in-fwd, .aisc-in-back, .aisc-fade { animation: none; }
  .aisc-height { transition: none; }
}`;

// AutoHeight animates its own height to whatever its content measures, so a
// short question after a long one shrinks the card smoothly.
function AutoHeight({ children }: { children: ReactNode }) {
  const inner = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    const measure = () => setHeight(el.offsetHeight);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return (
    <div className="aisc-height overflow-hidden" style={{ height }}>
      <div ref={inner}>{children}</div>
    </div>
  );
}

const STORAGE_LABELS: Record<string, string> = {
  room_temp: "อุณหภูมิห้อง",
  chilled: "แช่เย็น",
  frozen: "แช่แข็ง",
  dry: "ของแห้ง",
};
const ALERT_OPTIONS = [0, 10, 20, 30];

export function planNeedsSetup(plan: AIActionPlan | null): boolean {
  return Boolean(plan?.items.some((item) => item.setup));
}

// --- Pure helpers (unit-tested) ---------------------------------------------

export function answersFrom(setup: AIIngredientSetup): AIIngredientSetupAnswers {
  return {
    unit: setup.unit,
    ...(setup.stock_set ? { stock: setup.stock } : {}),
    pack_unit: setup.pack_unit ?? "",
    pack_size: setup.pack_size ?? 0,
    price_mode: setup.price_mode,
    price: setup.price ?? 0,
    storage_type: setup.storage_type,
    min_percent: setup.min_percent,
  };
}

// The questions this item has, in order. Every one the inventory needs is
// asked and none can be skipped (เจ้าของสั่ง 25 ก.ย. 2569): the amount on hand
// when the command said none, the pack size when it was said in packs, and a
// price.
export function stepsFor(setup: AIIngredientSetup): Step[] {
  const steps: Step[] = ["unit"];
  if (setup.unit && setup.needs_stock) steps.push("stock");
  if (setup.unit && setup.needs_pack) steps.push("pack");
  if (setup.unit) steps.push("price");
  steps.push("extras");
  return steps;
}

export function firstOpenStep(setup: AIIngredientSetup): Step {
  if (!setup.unit) return "unit";
  if (setup.needs_stock && !setup.stock_set) return "stock";
  if (setup.needs_pack && !setup.pack_size) return "pack";
  if (!setup.cost_per_unit) return "price";
  return "extras";
}

export function priceModeLabel(mode: AIIngredientPriceMode, setup: AIIngredientSetup): string {
  if (mode === "total") return "จ่ายไปทั้งหมด";
  if (mode === "per_pack") return `ราคาต่อ${setup.pack_unit ?? ""}`;
  return `ราคาต่อ${setup.unit}`;
}

export function nextStep(current: Step, setup: AIIngredientSetup): Step | null {
  const steps = stepsFor(setup);
  const index = steps.indexOf(current);
  return index >= 0 && index + 1 < steps.length ? steps[index + 1] : null;
}

export function sizeOptions(unit: string): number[] {
  switch (unit) {
    case "มิลลิลิตร":
      return [250, 500, 700, 750, 1000];
    case "ลิตร":
      return [1, 1.5, 5];
    case "กรัม":
      return [100, 500, 1000];
    case "กิโลกรัม":
      return [1, 5, 10];
    case "ฟอง":
      return [10, 12, 30];
    default:
      return [6, 12, 24];
  }
}

function fmt(value: number, digits = 2) {
  return value.toLocaleString("th-TH", { maximumFractionDigits: digits });
}

function errorText(err: unknown): { text: string; gone: boolean } {
  const response = (err as { response?: { status?: number; data?: { error?: string } } })?.response;
  return {
    text: response?.data?.error?.trim() || "บันทึกคำตอบไม่สำเร็จ ลองอีกครั้ง",
    gone: response?.status === 410 || response?.status === 404,
  };
}

// --- Small parts --------------------------------------------------------------

function Chip({ active, onClick, children, disabled }: { active?: boolean; onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex min-h-[36px] items-center gap-1 rounded-full border px-3.5 text-[13.5px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        active
          ? "border-orange-500 bg-orange-500 text-white shadow-sm shadow-orange-500/25"
          : "border-gray-200 bg-white text-gray-700 hover:border-orange-300 hover:text-orange-700 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200"
      }`}
    >
      {active && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
      {children}
    </button>
  );
}

function NumberField({ value, onChange, suffix, placeholder }: { value: string; onChange: (v: string) => void; suffix?: string; placeholder: string }) {
  return (
    <label className="inline-flex min-h-[36px] items-center gap-1 rounded-full border border-gray-200 bg-white px-3 text-[13.5px] focus-within:border-orange-400 dark:border-gray-700 dark:bg-gray-900">
      <input
        type="number"
        inputMode="decimal"
        min={0}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="w-20 bg-transparent text-gray-900 outline-none placeholder:text-gray-400 dark:text-gray-100"
      />
      {suffix && <span className="text-gray-500">{suffix}</span>}
    </label>
  );
}

function Question({ title, note, tag }: { title: string; note?: string; tag?: "required" | "suggested" }) {
  return (
    <div className="mb-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[16px] font-semibold text-gray-950 dark:text-white">{title}</p>
        {tag && (
          <span
            className={`rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold ${
              tag === "required"
                ? "bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-300"
                : "bg-orange-50 text-orange-600 dark:bg-orange-950/40 dark:text-orange-300"
            }`}
          >
            {tag === "required" ? "จำเป็น" : "ควรใส่"}
          </span>
        )}
      </div>
      {note && <p className="mt-0.5 text-[12px] text-gray-500 dark:text-gray-400">{note}</p>}
    </div>
  );
}

function Actions({ onBack, onSkip, onNext, nextLabel = "ถัดไป", busy }: { onBack?: () => void; onSkip?: () => void; onNext?: () => void; nextLabel?: string; busy: boolean }) {
  return (
    <div className="mt-4 flex items-center gap-2">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          disabled={busy}
          aria-label="ย้อนกลับ"
          className="grid h-[38px] w-[38px] place-items-center rounded-full border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-900"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </button>
      )}
      {onSkip && (
        <button
          type="button"
          onClick={onSkip}
          disabled={busy}
          className="min-h-[36px] rounded-full px-3 text-[13px] font-medium text-gray-500 underline-offset-2 hover:text-gray-800 hover:underline disabled:opacity-50 dark:text-gray-400"
        >
          ข้าม
        </button>
      )}
      <span className="flex-1" />
      <button
        type="button"
        disabled={!onNext || busy}
        onClick={() => onNext?.()}
        className="inline-flex min-h-[38px] items-center justify-center rounded-full bg-gradient-to-br from-orange-500 to-amber-500 px-5 text-[14px] font-semibold text-white shadow-sm shadow-orange-500/30 transition hover:brightness-105 disabled:cursor-not-allowed disabled:from-gray-200 disabled:to-gray-200 disabled:text-gray-400 disabled:shadow-none dark:disabled:from-gray-800 dark:disabled:to-gray-800 dark:disabled:text-gray-500"
      >
        {nextLabel}
      </button>
    </div>
  );
}

// --- Card ---------------------------------------------------------------------

type Props = {
  plan: AIActionPlan;
  onPlanChange: (plan: AIActionPlan) => void;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
  onReissue?: () => void;
  onResolved?: (state: InlineDbConfirmState) => void;
  initialState?: InlineDbConfirmState;
  language?: "th" | "en";
};

export default function AIIngredientSetupCard({
  plan, onPlanChange, onConfirm, onCancel, onReissue, onResolved, initialState, language = "th",
}: Props) {
  const setupSeqs = useMemo(
    () => plan.items.flatMap((item, index) => (item.setup ? [index] : [])),
    [plan.items],
  );
  const [cursor, setCursor] = useState(0);
  const [step, setStep] = useState<Step>(() => {
    if (initialState && isTerminal(initialState)) return "review";
    const first = plan.items[setupSeqs[0]]?.setup;
    return first ? firstOpenStep(first) : "review";
  });
  const [endedAs, setEndedAs] = useState<InlineDbConfirmState | undefined>(initialState);
  const [direction, setDirection] = useState<1 | -1>(1);
  const goTo = (next: Step, forced?: 1 | -1) => {
    setDirection(forced ?? (STEP_ORDER.indexOf(next) >= STEP_ORDER.indexOf(step) ? 1 : -1));
    setStep(next);
  };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [changePack, setChangePack] = useState(false);

  const seq = setupSeqs[cursor] ?? setupSeqs[0];
  const item = plan.items[seq];
  const setup = item?.setup;

  // Text fields hold what is being typed until "ถัดไป" sends it.
  const [sizeText, setSizeText] = useState("");
  const [priceText, setPriceText] = useState("");
  const [stockText, setStockText] = useState("");
  useEffect(() => {
    // A new question starts from what the server holds for it.
    setSizeText(setup?.pack_size && !sizeOptions(setup.unit).includes(setup.pack_size) ? String(setup.pack_size) : "");
    setPriceText(setup?.price ? String(setup.price) : "");
    setStockText(setup?.stock_set ? String(setup.stock) : "");
    setError("");
    // Only when the question or the item changes, not on every server reply.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, seq]);

  // No countdown while the questions are being answered (เจ้าของขอ 25 ก.ย.
  // 2569): the server keeps the card open for ten minutes, and the minute to
  // confirm starts on the last answer, where the confirm bar counts it down.
  // A card left past its window comes back from the server as gone, and the
  // confirm bar shows the expiry then.

  const send = async (patch: Partial<AIIngredientSetupAnswers>, advance: boolean) => {
    if (!setup || busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await setupAIPlanIngredient(plan.id, seq, plan.confirmation_token, { ...answersFrom(setup), ...patch });
      const next: AIActionPlan = { ...plan, ...response.data, confirmation_token: plan.confirmation_token, warnings: plan.warnings };
      onPlanChange(next);
      if (!advance) return;
      const updated = next.items[seq]?.setup;
      const after = updated ? nextStep(step, updated) : null;
      if (after) {
        goTo(after);
      } else if (cursor + 1 < setupSeqs.length) {
        const following = next.items[setupSeqs[cursor + 1]]?.setup;
        setCursor(cursor + 1);
        goTo(following ? firstOpenStep(following) : "review", 1);
      } else {
        goTo("review");
      }
    } catch (err) {
      const { text, gone } = errorText(err);
      if (gone) goTo("review");
      else setError(text);
    } finally {
      setBusy(false);
    }
  };

  const back = () => {
    if (!setup) return;
    const steps = stepsFor(setup);
    const index = steps.indexOf(step);
    if (index > 0) goTo(steps[index - 1]);
  };

  const cancelHere = () => {
    onCancel();
    setEndedAs("cancelled");
    goTo("review");
    onResolved?.("cancelled");
  };

  if (step === "review" || !setup) {
    return (
      <div className="aisc-fade mt-2 space-y-2">
        <style>{MOTION_CSS}</style>
        {!endedAs &&
          setupSeqs.map((index) => {
            const facts = plan.items[index]?.facts ?? [];
            if (facts.length === 0) return null;
            return (
              <section key={index} className="rounded-2xl border border-gray-200/70 bg-white px-4 py-3 text-[13px] dark:border-gray-700/60 dark:bg-gray-800/80">
                <p className="mb-1.5 text-[12px] font-semibold text-gray-500">สิ่งที่จะบันทึก · {plan.items[index].title}</p>
                <dl className="space-y-1">
                  {facts.map((fact) => (
                    <div key={fact.label} className="flex items-baseline gap-2">
                      <dt className="w-28 shrink-0 text-gray-500">{fact.label}</dt>
                      <dd className="min-w-0 flex-1 font-medium text-gray-900 tabular-nums dark:text-gray-100">{fact.value}</dd>
                    </div>
                  ))}
                </dl>
                <button
                  type="button"
                  onClick={() => {
                    setCursor(setupSeqs.indexOf(index));
                    goTo("unit");
                  }}
                  className="mt-2 text-[12px] font-medium text-orange-700 underline-offset-2 hover:underline dark:text-orange-300"
                >
                  แก้คำตอบ
                </button>
              </section>
            );
          })}
        <InlineDbConfirmBar
          summary={plan.summary}
          items={plan.items.map((planItem) => ({
            title: planItem.title,
            change: planItem.change,
            unit: planItem.unit,
            sideEffects: planItem.side_effects,
          }))}
          warnings={plan.warnings}
          detail={language === "th" ? `แก้ข้อมูลจริง ${plan.items.length} รายการ` : `changes ${plan.items.length} record(s)`}
          expiresAt={plan.expires_at}
          onConfirm={onConfirm}
          onCancel={onCancel}
          onReissue={onReissue}
          initialState={endedAs}
          onResolved={onResolved}
          language={language}
        />
      </div>
    );
  }

  // What has been answered, each one a way back to its question. The amount
  // that was said ("2 ขวด") is not an answer, so it sits in the header instead.
  const answered: { key: Step; text: string }[] = [];
  if (setup.unit) answered.push({ key: "unit", text: `นับเป็น${setup.unit}` });
  if (setup.stock_set) answered.push({ key: "stock", text: `มี ${fmt(setup.stock)} ${setup.unit}` });
  if (setup.pack_size && setup.unit) answered.push({ key: "pack", text: `${setup.pack_unit}ละ ${fmt(setup.pack_size)} ${setup.unit}` });
  if (setup.price) answered.push({ key: "price", text: `฿${fmt(setup.price)}${setup.price_mode === "per_pack" ? `/${setup.pack_unit}` : ""}` });

  const steps = stepsFor(setup);
  const stepIndex = steps.indexOf(step);

  let body: ReactNode = null;
  if (step === "unit") {
    body = (
      <>
        <Question
          title={`${setup.name}นับในคลังเป็นหน่วยอะไร?`}
          note={setup.said_unit ? `บอกมาเป็น ${setup.said_unit} · ถ้าใช้ทีละนิด (เท ตวง ชั่ง) ให้เลือกหน่วยที่ใช้ตวง` : "สูตรอาหารจะหักสต๊อกตามหน่วยนี้"}
          tag="required"
        />
        <div className="flex flex-wrap gap-1.5">
          {(setup.units ?? []).map((unit) => (
            <Chip key={unit} active={setup.unit === unit} disabled={busy} onClick={() =>
              // A different unit makes the pack size and price mean something
              // else, so they are asked again; the same unit keeps them.
              send(unit === setup.unit ? {} : { unit, stock: undefined, pack_size: 0, price: 0 }, true)
            }>
              {unit}
            </Chip>
          ))}
        </div>
        <Actions busy={busy} onNext={setup.unit ? () => goTo(nextStep("unit", setup) ?? "review") : undefined} />
      </>
    );
  } else if (step === "stock") {
    const amount = stockText.trim() === "" ? NaN : Number(stockText);
    body = (
      <>
        <Question
          title={`ตอนนี้มี${setup.name}อยู่กี่${setup.unit}?`}
          note="เป็นสต๊อกเริ่มต้นในคลัง · ยังไม่มีของ ใส่ 0 ได้"
          tag="required"
        />
        <NumberField value={stockText} onChange={setStockText} placeholder="จำนวน" suffix={setup.unit} />
        <Actions
          busy={busy}
          onBack={back}
          onNext={Number.isFinite(amount) && amount >= 0 ? () => send({ stock: amount }, true) : undefined}
        />
      </>
    );
  } else if (step === "pack") {
    const size = Number(sizeText);
    body = (
      <>
        <Question
          title={`1 ${setup.pack_unit}กี่${setup.unit}?`}
          note={`ใช้แปลง ${fmt(setup.said_quantity)} ${setup.pack_unit} เป็นสต๊อก`}
          tag="required"
        />
        <button
          type="button"
          onClick={() => setChangePack((open) => !open)}
          className="mb-2 text-[12px] font-medium text-orange-700 underline-offset-2 hover:underline dark:text-orange-300"
        >
          {changePack ? "ซ่อน" : `ไม่ได้ซื้อเป็น${setup.pack_unit}? เปลี่ยน`}
        </button>
        {changePack && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {(setup.pack_units ?? []).map((word) => (
              <Chip key={word} active={setup.pack_unit === word} disabled={busy} onClick={() => send({ pack_unit: word }, false)}>
                {word}
              </Chip>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          {sizeOptions(setup.unit).map((option) => (
            <Chip key={option} active={setup.pack_size === option} disabled={busy} onClick={() => send({ pack_size: option }, true)}>
              {fmt(option)} {setup.unit}
            </Chip>
          ))}
          <NumberField value={sizeText} onChange={setSizeText} placeholder="อื่น ๆ" suffix={setup.unit} />
        </div>
        <Actions
          busy={busy}
          onBack={back}
          onNext={
            size > 0
              ? () => send({ pack_size: size }, true)
              : setup.pack_size
                ? () => goTo(nextStep("pack", setup) ?? "review")
                : undefined
          }
        />
      </>
    );
  } else if (step === "price") {
    const price = Number(priceText);
    const modes = setup.price_modes ?? [];
    body = (
      <>
        <Question
          title="ราคาเท่าไหร่?"
          note={setup.stock > 0 ? "ใช้คิดต้นทุนเมนู และบันทึกเป็นรายจ่ายวันนี้" : "ใช้คิดต้นทุนเมนู · ยังไม่มีของ จึงยังไม่ลงรายจ่าย"}
          tag="required"
        />
        {modes.length > 1 && (
          <span className="mb-2 inline-flex flex-wrap rounded-full bg-gray-100 p-0.5 dark:bg-gray-800">
            {modes.map((mode) => (
              <button
                key={mode}
                type="button"
                disabled={busy}
                onClick={() => send({ price_mode: mode }, false)}
                className={`rounded-full px-3 py-1 text-[12.5px] font-semibold transition-colors ${
                  setup.price_mode === mode ? "bg-white text-gray-900 shadow-sm dark:bg-gray-950 dark:text-white" : "text-gray-500"
                }`}
              >
                {priceModeLabel(mode, setup)}
              </button>
            ))}
          </span>
        )}
        {modes.length === 1 && <p className="mb-2 text-[12px] text-gray-500">{priceModeLabel(modes[0], setup)}</p>}
        <div className="flex flex-wrap items-center gap-1.5">
          <NumberField value={priceText} onChange={setPriceText} placeholder="ราคา" suffix="บาท" />
        </div>
        {setup.cost_per_unit ? (
          <p className="mt-2 text-[12px] text-gray-500">
            = ฿{fmt(setup.cost_per_unit, setup.cost_per_unit < 1 ? 3 : 2)} ต่อ{setup.unit} · รายจ่าย ฿{fmt(setup.total ?? 0)}
          </p>
        ) : null}
        <Actions
          busy={busy}
          onBack={back}
          onNext={price > 0 ? () => send({ price }, true) : undefined}
        />
      </>
    );
  } else {
    body = (
      <>
        <Question title="ตั้งเพิ่ม (ไม่บังคับ)" note="ค่าเริ่มต้นเหมือนฟอร์มหน้าคลัง ถูกอยู่แล้วกด ใช้ตามนี้ ได้เลย" />
        <div className="space-y-3">
          <div>
            <p className="mb-1 text-[11.5px] text-gray-500">การเก็บ</p>
            <div className="flex flex-wrap gap-1.5">
              {(setup.storage_types ?? []).map((storage) => (
                <Chip key={storage} active={setup.storage_type === storage} disabled={busy} onClick={() => send({ storage_type: storage }, false)}>
                  {STORAGE_LABELS[storage] ?? storage}
                </Chip>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1 text-[11.5px] text-gray-500">เตือนเมื่อเหลือต่ำกว่า</p>
            <div className="flex flex-wrap gap-1.5">
              {ALERT_OPTIONS.map((percent) => (
                <Chip key={percent} active={setup.min_percent === percent} disabled={busy} onClick={() => send({ min_percent: percent }, false)}>
                  {percent === 0 ? "ไม่ตั้ง" : `${percent}%`}
                </Chip>
              ))}
            </div>
          </div>
        </div>
        <Actions busy={busy} onBack={back} nextLabel="ใช้ตามนี้" onNext={() => send({ finish: true }, true)} />
      </>
    );
  }

  return (
    <section className="mt-2 w-full max-w-[380px] overflow-hidden rounded-2xl rounded-tl-md border border-gray-200/70 bg-white text-gray-800 shadow-sm dark:border-gray-700/60 dark:bg-gray-800/80 dark:text-gray-100">
      <div className="flex items-center gap-2.5 border-b border-gray-100 px-4 py-3 dark:border-gray-700/60">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-orange-50 text-orange-600 dark:bg-orange-950/50 dark:text-orange-300">
          <Package className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            เพิ่มวัตถุดิบใหม่
            {setup.said_quantity > 0 ? ` · สั่งมา ${fmt(setup.said_quantity)} ${setup.said_unit ?? ""}`.trimEnd() : ""}
            {setupSeqs.length > 1 ? ` · ${cursor + 1}/${setupSeqs.length}` : ""}
          </p>
          <p className="truncate text-[15px] font-semibold text-gray-950 dark:text-white">{setup.name}</p>
        </div>
        <span className="shrink-0 text-[11px] font-semibold tabular-nums text-gray-500">
          ข้อ {stepIndex + 1}/{steps.length}
        </span>
      </div>
      <div className="flex gap-1 px-4 pt-3" aria-hidden="true">
        {steps.map((name, index) => (
          <span key={name} className={`h-1 flex-1 rounded-full ${index <= stepIndex ? "bg-orange-500" : "bg-gray-200 dark:bg-gray-700"} transition-colors duration-300`} />
        ))}
      </div>
      {answered.length > 0 && (
        <div className="flex flex-wrap gap-1 px-4 pt-2.5">
          {answered.map((entry, index) => (
            <button
              key={`${entry.key}-${index}`}
              type="button"
              onClick={() => steps.includes(entry.key) && goTo(entry.key)}
              className="rounded-full bg-gray-100 px-2 py-0.5 text-[11.5px] text-gray-600 hover:bg-gray-200 dark:bg-gray-900 dark:text-gray-300"
            >
              {entry.text}
            </button>
          ))}
        </div>
      )}
      <style>{MOTION_CSS}</style>
      <AutoHeight>
      <div className="px-4 pb-4 pt-3">
        <div key={`${seq}-${step}`} className={direction > 0 ? "aisc-in-fwd" : "aisc-in-back"}>
          {body}
        </div>
        {error && <p role="alert" className="mt-2 text-[12px] text-red-600 dark:text-red-400">{error}</p>}
        <button
          type="button"
          onClick={cancelHere}
          disabled={busy}
          className="mt-3 text-[12px] font-medium text-red-600 underline-offset-2 hover:text-red-700 hover:underline disabled:opacity-50 dark:text-red-400 dark:hover:text-red-300"
        >
          ยกเลิกคำสั่งนี้
        </button>
      </div>
      </AutoHeight>
    </section>
  );
}
