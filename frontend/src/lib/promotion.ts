import { apiClient } from "./apiClient";

export const promotionTypes = ["buy_x_get_y", "item_discount", "bundle_price", "bill_discount"] as const;
export type PromotionType = (typeof promotionTypes)[number];
export type PromotionDiscountKind = "percent" | "amount";

/** One dish or one whole category a promotion counts. A bundle has one group
 *  per slot and `quantity` dishes per slot; every other type uses group 0. */
export type PromotionTarget = {
  ID?: number;
  group_index: number;
  quantity: number;
  menu_item_id: number | null;
  category_id: number | null;
};

/** A pricing rule the owner sets once; the server applies it to every order by
 *  itself. Schedule fields are Bangkok calendar values and "" means no limit. */
export type Promotion = {
  ID: number;
  name: string;
  type: PromotionType;
  is_active: boolean;
  start_date: string;
  end_date: string;
  /** Bit 0 is Sunday; 127 is every day. */
  days_mask: number;
  start_time: string;
  end_time: string;
  buy_quantity: number;
  get_quantity: number;
  discount_kind: "" | PromotionDiscountKind;
  discount_value: number;
  bundle_price: number;
  min_subtotal: number;
  /** Caps a percent bill discount; 0 means no cap. */
  max_discount: number;
  targets: PromotionTarget[];
};

export type PromotionInput = Omit<Promotion, "ID" | "is_active" | "targets"> & {
  targets: Omit<PromotionTarget, "ID">[];
};

export const listPromotions = () =>
  apiClient.get<{ promotions: Promotion[] }>("/api/v1/promotions");

export const createPromotion = (data: PromotionInput) =>
  apiClient.post<{ promotion: Promotion }>("/api/v1/promotions", data);

export const updatePromotion = (id: number, data: PromotionInput) =>
  apiClient.put<{ promotion: Promotion }>(`/api/v1/promotions/${id}`, data);

export const setPromotionActive = (id: number, isActive: boolean) =>
  apiClient.patch<{ promotion: Promotion }>(`/api/v1/promotions/${id}/active`, { is_active: isActive });

export const deletePromotion = (id: number) => apiClient.delete(`/api/v1/promotions/${id}`);
