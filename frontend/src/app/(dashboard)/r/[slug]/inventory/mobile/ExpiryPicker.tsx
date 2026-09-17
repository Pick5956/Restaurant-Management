"use client";

import {
  SHELF_LIFE_PRESETS,
  defaultShelfLifeDays,
  expiryCopy,
  expiryDateFromDays,
  formatExpiryDate,
  storageLabel,
  useExpiryChoice,
} from "../inventoryExpiryUtils";
import { ChipRow, inputBase } from "./primitives";

/**
 * Phone expiry picker — same choices as the desktop chips, drawn with the
 * inventory-mobile tokens. Mount it with a `key` per ingredient or lot so the
 * custom/preset choice does not carry over from the last one edited.
 */
export default function ExpiryPicker({
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
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-(--inv-muted)">
        {copy.label}
      </p>
      <ChipRow value={chip} options={options} onChange={pick} />
      {custom ? (
        <div className="mt-3 flex items-center gap-2">
          <span className="text-[13px] text-(--inv-muted)">{copy.customDays}</span>
          <input
            type="number"
            min={0}
            inputMode="numeric"
            value={draft}
            onChange={(event) => typeDraft(event.target.value)}
            className={`${inputBase} h-11 w-24 border-(--inv-hairline) text-center tabular-nums`}
          />
          <span className="text-[13px] text-(--inv-muted)">{copy.dayUnit}</span>
        </div>
      ) : null}
      <p className="mt-2 text-[12px] leading-snug text-(--inv-muted)">
        {value === null ? copy.noExpiry : copy.expiresOn(formatExpiryDate(expiryDateFromDays(value), lang))}
        <span className="text-(--inv-faint)">
          {" · "}
          {copy.defaultHint(fallback, storageLabel(storageType, lang))}
        </span>
      </p>
    </div>
  );
}
