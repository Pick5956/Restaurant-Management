import type { OrderPromotion } from '@/src/types/order';

export interface BillDiscountLine {
  key: string;
  label: string;
  amount: number;
}

/**
 * The lines a bill shows between the food subtotal and the total: one per
 * promotion the server applied ("ชาเย็น 1 แถม 1 ×2"), or a single discount
 * line for a bill that carries a discount without itemised promotions.
 * Mirrors frontend/src/lib/billPromotions.ts so the web and the app read the
 * same bill the same way.
 */
export function billDiscountLines(
  bill: { discount_amount: number; promotions?: OrderPromotion[] | null },
  discountLabel: string,
): BillDiscountLine[] {
  const promotions = bill.promotions ?? [];
  if (promotions.length > 0) {
    return promotions.map((promotion) => ({
      key: `promotion-${promotion.ID}`,
      label: promotion.times > 1 ? `${promotion.name} ×${promotion.times}` : promotion.name,
      amount: promotion.amount,
    }));
  }
  return bill.discount_amount > 0 ? [{ key: 'discount', label: discountLabel, amount: bill.discount_amount }] : [];
}
