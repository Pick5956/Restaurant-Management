import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  dailyExpenseTotalsByDate,
  hasPartialDailyExpenseRows,
  shiftDashboardDate,
  toDashboardDate,
  toDashboardFloorTables,
  totalDailyExpensesForMonth,
  uniqueKitchenTickets,
  uniqueOrdersById,
} from "../homeDashboard";
import type { Order } from "../../types/order";
import type { RestaurantTable } from "../../types/table";

const homePageSource = readFileSync(
  fileURLToPath(new URL("../../app/(dashboard)/r/[slug]/home/page.tsx", import.meta.url)),
  "utf8",
);

const table = (id: number, label: string): RestaurantTable => ({
  ID: id,
  restaurant_id: 1,
  zone: "main",
  table_number: label,
  display_label: label,
  sequence_number: id,
  capacity: 4,
  status: "free",
});

const order = (id: number): Order => ({
  ID: id,
  restaurant_id: 1,
  order_type: "dine_in",
  order_number: `A${id}`,
  order_date: "2026-07-13",
  staff_id: 1,
  customer_count: 2,
  status: "open",
  subtotal: 100,
  discount_amount: 0,
  service_charge_amount: 0,
  vat_amount: 0,
  total_amount: 100,
  grand_total: 100,
  payment_status: "unpaid",
  note: "",
  opened_at: "2026-07-13T12:00:00+07:00",
  version: 1,
});

describe("home dashboard helpers", () => {
  it("never renders expense aggregates from a previously active restaurant", () => {
    expect(homePageSource).toContain("const restaurantId = activeMembership?.restaurant_id ?? null;");
    expect(homePageSource).toContain(
      "const expenseScopeMatches = canViewExpenses && expenseLedger.restaurantId === restaurantId;",
    );
    expect(homePageSource).toContain(
      "setExpenseLedger((current) => (current.restaurantId === restaurantId ? current : EMPTY_EXPENSE_LEDGER));",
    );
    expect(homePageSource).toContain("restaurantId: requestedRestaurantId,");
  });

  it("keeps table keys unique even when display labels are duplicated", () => {
    const floor = toDashboardFloorTables([
      table(11, "16"),
      table(12, "16"),
    ], [], new Date("2026-07-13T13:00:00+07:00"));

    expect(floor.map((item) => item.key)).toEqual([11, 12]);
  });

  it("deduplicates repeated kitchen orders by database ID", () => {
    expect(uniqueOrdersById([order(16), order(16), order(17)]).map((item) => item.ID)).toEqual([16, 17]);
  });

  it("keeps a table's second kitchen round as its own ticket", () => {
    const round = (id: number, batch: number) => ({ ...order(id), kitchen_batch: batch, kitchen_ticket_id: `${id}:${batch}` });
    const kept = uniqueKitchenTickets([round(16, 1), round(16, 2), round(16, 2), round(17, 1)]);
    expect(kept.map((item) => item.kitchen_ticket_id)).toEqual(["16:1", "16:2", "17:1"]);
  });

  it("uses server-side daily expense aggregates instead of capped ledger rows", () => {
    const daily = [
      { date: "2026-07-13", amount: 370.5, entries: 2 },
      { date: "2026-07-14", amount: 80, entries: 1 },
      { date: "2026-08-01", amount: 999, entries: 8 },
    ];

    const totals = dailyExpenseTotalsByDate(daily);

    expect(totals.get("2026-07-13")).toEqual({ amount: 370.5, entries: 2 });
    expect(totals.get("2026-07-14")).toEqual({ amount: 80, entries: 1 });
    expect(totalDailyExpensesForMonth(daily, "2026-07")).toBe(450.5);
  });

  it("marks only the selected expense day as partial", () => {
    expect(hasPartialDailyExpenseRows(3, 5)).toBe(true);
    expect(hasPartialDailyExpenseRows(5, 5)).toBe(false);
    expect(hasPartialDailyExpenseRows(6, 5)).toBe(false);
  });

  it("moves dashboard dates without UTC conversion", () => {
    expect(shiftDashboardDate("2026-07-13", -1)).toBe("2026-07-12");
    expect(toDashboardDate(new Date("2026-07-13T00:30:00+07:00"))).toBe("2026-07-13");
  });
});

// TopMenuItemsByMonth groups by menu id AND the name the dish was sold under,
// so a renamed dish comes back as two rows with one id. Keyed by the id alone,
// React saw a repeated key (the phone's profit table crashed the same way).
describe("month top items", () => {
  it("key each row by the menu id and the name it was sold under", () => {
    expect(homePageSource).toContain("<tr key={`${item.menu_id}-${item.menu_name}`}>");
    expect(homePageSource).not.toMatch(/monthTopItems[\s\S]{0,120}<tr key=\{item\.menu_id\}>/);
  });
});
