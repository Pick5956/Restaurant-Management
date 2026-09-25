import { describe, expect, it } from "vitest";

import {
  activeOrderTableIds,
  drawerTableStatus,
  isTableInService,
  tableErrorNeedsReload,
  tableErrorText,
  tableServiceStatus,
  tableStatusEditorState,
  zoneHasTableInService,
} from "./tablesPageUtils";

describe("activeOrderTableIds", () => {
  it("collects the tables that hold an active order and skips takeaways and closed orders", () => {
    const ids = activeOrderTableIds([
      { table_id: 3, status: "open" },
      { table_id: 4, status: "served" },
      { table_id: null, status: "cooking" },
      { table_id: 5, status: "completed" },
      { table_id: 6, status: "cancelled" },
    ]);

    expect([...ids].sort()).toEqual([3, 4]);
  });
});

describe("table lock", () => {
  const noOrders = new Set<number>();

  it.each(["occupied", "reserved"] as const)("locks a %s table", (status) => {
    expect(isTableInService({ ID: 1, status }, noOrders)).toBe(true);
  });

  it.each(["free", "inactive"] as const)("leaves a %s table without an order editable", (status) => {
    expect(isTableInService({ ID: 1, status }, noOrders)).toBe(false);
  });

  it("locks a table whose active order has not reached its status column", () => {
    expect(isTableInService({ ID: 7, status: "free" }, new Set([7]))).toBe(true);
    expect(tableServiceStatus({ ID: 7, status: "free" }, new Set([7]))).toBe("occupied");
  });

  it("keeps the column status when the table has no active order", () => {
    expect(tableServiceStatus({ ID: 7, status: "reserved" }, noOrders)).toBe("reserved");
    expect(tableServiceStatus({ ID: 7, status: "inactive" }, noOrders)).toBe("inactive");
  });

  it("finds a zone that holds a table in service", () => {
    const tables = [
      { ID: 1, status: "free" as const, zone_id: 2 },
      { ID: 2, status: "occupied" as const, zone_id: 3 },
      { ID: 3, status: "free" as const, zone_id: null },
    ];

    expect(zoneHasTableInService(3, tables, noOrders)).toBe(true);
    expect(zoneHasTableInService(2, tables, noOrders)).toBe(false);
    expect(zoneHasTableInService(2, tables, new Set([1]))).toBe(true);
  });
});

describe("tableErrorText", () => {
  it("says a refused edit on a table in service in the staff member's language", () => {
    expect(tableErrorText("table is in use", "th", "fallback")).toBe("โต๊ะนี้ยังไม่ว่าง");
    expect(tableErrorText("table is in use", "en", "fallback")).toBe("This table is in use.");
    expect(tableErrorText("table has an open order", "th", "fallback")).toBe("โต๊ะนี้มีออเดอร์เปิดอยู่");
  });

  it("says a refused prefix change on a zone in terms of the zone", () => {
    expect(tableErrorText("table is in use", "th", "fallback", "zone")).toBe("โซนนี้มีโต๊ะที่ยังไม่ว่าง");
  });

  it("names the other refusals the table and zone endpoints give", () => {
    expect(tableErrorText("table has order history; mark it inactive instead", "th", "x")).toBe("โต๊ะนี้มีประวัติออเดอร์ ใช้ปิดใช้งานแทน");
    expect(tableErrorText("table has an active reservation; cancel it first", "th", "x")).toBe("โต๊ะนี้มีการจองอยู่ ยกเลิกการจองก่อน");
    expect(tableErrorText("cannot delete a zone that still has tables", "th", "x")).toBe("ยังมีโต๊ะในโซนนี้");
    expect(tableErrorText("zone prefix is already used", "th", "x")).toBe("ตัวอักษรนำหน้านี้ถูกใช้แล้ว");
  });

  it("reads a duplicate as a label clash on a table and a taken prefix on a zone", () => {
    expect(tableErrorText("resource already exists", "th", "x")).toBe("เลขโต๊ะซ้ำกับโต๊ะอื่น");
    expect(tableErrorText("resource already exists", "th", "x", "zone")).toBe("ตัวอักษรนำหน้านี้ถูกใช้แล้ว");
  });

  it("never shows the API's own wording", () => {
    expect(tableErrorText("internal server error", "th", "บันทึกข้อมูลไม่สำเร็จ")).toBe("บันทึกข้อมูลไม่สำเร็จ");
    expect(tableErrorText("", "en", "Could not save data.")).toBe("Could not save data.");
  });

  it("asks for a reload when the refusal means the page is out of date", () => {
    expect(tableErrorNeedsReload("table is in use")).toBe(true);
    expect(tableErrorNeedsReload("table has an open order")).toBe(true);
    expect(tableErrorNeedsReload("resource not found")).toBe(true);
    expect(tableErrorNeedsReload("zone prefix is already used")).toBe(false);
  });
});

describe("drawerTableStatus", () => {
  it.each(["reserved", "occupied"] as const)(
    "drops the stale %s status once the table has left service",
    (stale) => {
      expect(drawerTableStatus(stale, "free", false)).toBe("free");
      expect(drawerTableStatus(stale, "inactive", false)).toBe("inactive");
    },
  );

  it("keeps the owner's own switch while the table is out of service", () => {
    expect(drawerTableStatus("inactive", "free", false)).toBe("inactive");
    expect(drawerTableStatus("free", "inactive", false)).toBe("free");
  });

  it("leaves the form alone while the table is still in service or has no live row", () => {
    expect(drawerTableStatus("reserved", "reserved", true)).toBe("reserved");
    expect(drawerTableStatus("occupied", undefined, false)).toBe("occupied");
  });
});

describe("tableStatusEditorState", () => {
  it.each(["reserved", "occupied"] as const)(
    "keeps the %s lifecycle status read-only and visible",
    (status) => {
      expect(tableStatusEditorState(status)).toEqual({
        status,
        isLifecycleManaged: true,
        isActive: true,
      });
    },
  );

  it.each([
    ["free", true],
    ["inactive", false],
  ] as const)("keeps %s editable as an availability status", (status, isActive) => {
    expect(tableStatusEditorState(status)).toEqual({
      status,
      isLifecycleManaged: false,
      isActive,
    });
  });
});
