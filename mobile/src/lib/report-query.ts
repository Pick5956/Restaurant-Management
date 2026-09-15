export interface ReportMonth {
  year: number;
  month: number;
}

function boundedInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}

export function buildManagerReportPath(days = 14): string {
  return `/api/v1/reports/manager?days=${boundedInteger(days, 1, 90)}`;
}

/** A chosen range, both days inclusive, YYYY-MM-DD. */
export function buildManagerReportRangePath(from: string, to: string): string {
  const query = new URLSearchParams({ from, to });
  return `/api/v1/reports/manager?${query.toString()}`;
}

export function buildSalesByHourPath(date: string): string {
  return `/api/v1/reports/sales-by-hour?${new URLSearchParams({ date }).toString()}`;
}

export function buildTopMenuItemsPath(month: ReportMonth): string {
  const query = new URLSearchParams({
    year: String(boundedInteger(month.year, 2000, 2100)),
    month: String(boundedInteger(month.month, 1, 12)),
  });
  return `/api/v1/reports/top-menu-items?${query.toString()}`;
}

export function getBangkokReportMonth(date = new Date()): ReportMonth {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(date);
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  return { year, month };
}

export function shiftReportMonth(
  current: ReportMonth,
  delta: number,
): ReportMonth {
  const shifted = new Date(
    Date.UTC(current.year, current.month - 1 + Math.trunc(delta), 1),
  );
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
  };
}
