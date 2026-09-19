// The order API refuses a dish the stock cannot make with its own English -
// "ข้าวผัดกุ้ง is sold out", "only 2 left for ต้มยำกุ้ง" - and the app used to
// print that straight onto the screen. These are the two refusals a waiter can
// act on, so they get the app's own words; anything else keeps just the title
// of the step that failed.

export type StockFailure =
  | { kind: 'sold_out'; name: string }
  | { kind: 'only_left'; name: string; left: number };

/** Recognises the backend's two stock refusals (service/order_flow_helpers.go). */
export function stockFailure(raw: string | null | undefined): StockFailure | null {
  const message = String(raw || '').trim();
  const soldOut = /^(.+) is sold out$/i.exec(message);
  if (soldOut) return { kind: 'sold_out', name: soldOut[1] };
  const onlyLeft = /^only (\d+) left for (.+)$/i.exec(message);
  if (onlyLeft) return { kind: 'only_left', name: onlyLeft[2], left: Number(onlyLeft[1]) };
  return null;
}

/** Worded the way the web POS words the same two cases. */
export function stockFailureMessage(failure: StockFailure, language: 'th' | 'en'): string {
  if (failure.kind === 'sold_out') {
    return language === 'th' ? `${failure.name} หมดแล้ว` : `${failure.name} is sold out`;
  }
  return language === 'th'
    ? `${failure.name} เหลืออีก ${failure.left} ที่`
    : `Only ${failure.left} left of ${failure.name}`;
}
