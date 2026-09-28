export interface BillDiscountLine {
  key: string;
  label: string;
  amount: number;
}

/**
 * The line a bill shows between the food subtotal and the total when it
 * carries a discount. Only bills paid while the retired automatic promotions
 * ran have one; every other bill shows none. Mirrors
 * frontend/src/lib/billDiscount.ts so the web and the app read the same bill
 * the same way.
 */
export function billDiscountLines(bill: { discount_amount: number }, discountLabel: string): BillDiscountLine[] {
  return bill.discount_amount > 0 ? [{ key: 'discount', label: discountLabel, amount: bill.discount_amount }] : [];
}
