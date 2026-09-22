import type { Membership } from "../types/restaurant";
import { can } from "./rbac";

export function getDefaultWorkspaceRoute(membership: Membership | null | undefined) {
  const roleName = membership?.role?.name ?? "";
  if (roleName === "chef") return "/kitchen";
  if (roleName === "waiter") return "/pos/tables";
  // Cashiers work the front like waiters — they start on the order-taking floor,
  // not the paid-bill archive.
  if (roleName === "cashier") return "/pos/tables";
  if (roleName === "owner" || roleName === "manager") return "/home";

  if (can(membership, "view_kitchen")) return "/kitchen";
  if (can(membership, "take_order")) return "/pos/tables";
  if (can(membership, "view_orders")) return "/orders";
  return "/home";
}
