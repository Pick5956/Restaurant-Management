export type Permission =
  | "*"
  | "view_dashboard"
  | "manage_menu"
  | "manage_promotions"
  | "view_tables"
  | "manage_table"
  | "take_order"
  | "view_orders"
  | "take_payment"
  | "view_kitchen"
  | "update_order_status"
  | "view_inventory"
  | "manage_inventory"
  | "manage_expenses"
  | "view_reports"
  | "manage_invites"
  | "manage_members"
  | "manage_roles"
  | "view_audit_log"
  | "manage_restaurant_settings"
  | "manage_staff"
  | "view_menu";

export interface User {
  ID: number;
  first_name: string;
  last_name: string;
  nickname: string;
  birthday: string;
  email: string;
  auth_provider?: "local" | "google";
  address: string;
  profile_image: string;
  phone: string;
  status?: string;
}
