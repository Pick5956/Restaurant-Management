"use client";

import {
  SHELF_LIFE_PRESETS,
  defaultShelfLifeDays,
  expiryCopy,
  expiryDateFromDays,
  formatExpiryDate,
  storageLabel,
  useExpiryChoice,
} from "./inventoryExpiryUtils";
import { inputCls } from "./inventoryPageUtils";

const chipOn =
  "border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-900";
const chipOff =
  "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700 dark:border-gray-700 dark:bg-gray-800 dark:text-slate-300 dark:hover:text-white";

/**
 * Desktop expiry picker: preset chips (the storage type's own default is what
 * the caller pre-selects), "กำหนดเอง" with a days field, and the date it all
 * resolves to — so what gets saved is visible before it is saved.
 */
export default function ExpiryChips({
  value,
  onChange,
  storageType,
  lang,
}: {
  value: number | null;
  onChange: (days: number | null) => void;
  storageType?: string | null;
  lang: "th" | "en";
}) {
  const copy = expiryCopy(lang);
  const fallback = defaultShelfLifeDays(storageType);
  const { chip, custom, draft, pick, typeDraft } = useExpiryChoice(value, onChange, fallback);
  const options = [
    { value: "none", label: copy.none },
    ...SHELF_LIFE_PRESETS.map((days) => ({ value: String(days), label: copy.preset(days) })),
    { value: "custom", label: copy.custom },
  ];

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => pick(option.value)}
            className={`rounded-md border px-3 py-1.5 text-[13px] font-semibold transition ${
              chip === option.value ? chipOn : chipOff
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
      {custom ? (
        <div className="mt-2 flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
          <span>{copy.customDays}</span>
          <div className="w-24">
            <input
              type="number"
              min={0}
              inputMode="numeric"
              value={draft}
              onChange={(event) => typeDraft(event.target.value)}
              className={inputCls}
            />
          </div>
          <span>{copy.dayUnit}</span>
        </div>
      ) : null}
      <p className="mt-1.5 text-[11px] text-slate-400 dark:text-slate-500">
        {value === null ? copy.noExpiry : copy.expiresOn(formatExpiryDate(expiryDateFromDays(value), lang))}
        {" · "}
        {copy.defaultHint(fallback, storageLabel(storageType, lang))}
      </p>
    </div>
  );
}
