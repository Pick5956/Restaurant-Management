// The period a report covers, chosen by the owner (15 ก.ย. 2569): a preset, one
// day, or any range up to 93 days. Mirrors mobile/src/lib/report-view.ts so both
// apps offer the same presets and send the server the same from/to pair.

export type ReportRange = { from: string; to: string };

export type ReportPreset = "today" | "yesterday" | "last7" | "last14" | "last30" | "thisMonth" | "lastMonth";

export const REPORT_PRESETS: ReportPreset[] = ["today", "yesterday", "last7", "last14", "last30", "thisMonth", "lastMonth"];

/** The server refuses a longer range. */
export const REPORT_MAX_DAYS = 93;

/** Today in Bangkok, YYYY-MM-DD. */
export function bangkokToday(value = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function isoDay(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month - 1, day, 12)).toISOString().slice(0, 10);
}

function addDays(date: string, delta: number) {
  const [year, month, day] = date.split("-").map(Number);
  return isoDay(year, month, day + delta);
}

export function rangeDayCount(range: ReportRange): number {
  const [y1, m1, d1] = range.from.split("-").map(Number);
  const [y2, m2, d2] = range.to.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000) + 1;
}

export function presetRange(preset: ReportPreset, today: string): ReportRange {
  const [year, month] = today.split("-").map(Number);
  switch (preset) {
    case "today": return { from: today, to: today };
    case "yesterday": { const day = addDays(today, -1); return { from: day, to: day }; }
    case "last7": return { from: addDays(today, -6), to: today };
    case "last14": return { from: addDays(today, -13), to: today };
    case "last30": return { from: addDays(today, -29), to: today };
    case "thisMonth": return { from: isoDay(year, month, 1), to: today };
    case "lastMonth": return { from: isoDay(year, month - 1, 1), to: isoDay(year, month, 0) };
  }
}

export function matchPreset(range: ReportRange, today: string): ReportPreset | null {
  return REPORT_PRESETS.find((preset) => {
    const candidate = presetRange(preset, today);
    return candidate.from === range.from && candidate.to === range.to;
  }) ?? null;
}

/**
 * Why a hand-typed range cannot be shown, or null when it can. The date inputs
 * let a person type an end before the start or a day after today; saying so
 * beats a request the server would refuse.
 */
export function rangeProblem(range: ReportRange, today: string): "order" | "future" | "tooLong" | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(range.from) || !/^\d{4}-\d{2}-\d{2}$/.test(range.to)) return "order";
  if (range.from > today) return "future";
  if (range.from > range.to) return "order";
  const clipped = { from: range.from, to: range.to > today ? today : range.to };
  if (rangeDayCount(clipped) > REPORT_MAX_DAYS) return "tooLong";
  return null;
}
