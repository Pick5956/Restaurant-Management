import { describe, expect, it } from "vitest";
import type { Ingredient } from "@/src/types/ingredient";
import {
  daysUntil,
  defaultShelfLifeDays,
  expiryDateFromDays,
  expiryState,
  formatShelfLife,
  matchesExpiryFilter,
  parseExpiry,
  restockShelfLifePresets,
} from "./inventoryExpiryUtils";

// A fixed "now" so the tests do not drift with the calendar: 17 Sep 2026, noon.
const noon = new Date(2026, 8, 17, 12, 0, 0);

function item(expiresAt: string | null): Ingredient {
  return {
    ID: 1,
    restaurant_id: 1,
    name: "หมูสับ",
    unit: "กรัม",
    stock: 1000,
    min_stock: 100,
    cost_per_unit: 0.2,
    expiring_lot: expiresAt ? { lot_id: 9, expires_at: expiresAt, remaining: 400 } : null,
  };
}

describe("expiryDateFromDays", () => {
  it("counts calendar days, not 24-hour blocks", () => {
    expect(expiryDateFromDays(2, new Date(2026, 8, 17, 23, 30))).toBe("2026-09-19");
  });
  it("crosses month and year ends", () => {
    expect(expiryDateFromDays(30, noon)).toBe("2026-10-17");
    expect(expiryDateFromDays(180, noon)).toBe("2027-03-16");
  });
  it("never goes into the past", () => {
    expect(expiryDateFromDays(-5, noon)).toBe("2026-09-17");
  });
});

describe("parseExpiry", () => {
  it("reads a bare date as a local calendar day", () => {
    const date = parseExpiry("2026-09-19");
    expect([date.getFullYear(), date.getMonth(), date.getDate()]).toEqual([2026, 8, 19]);
  });
});

describe("expiryState", () => {
  it("is none without a date", () => {
    expect(expiryState(null, noon)).toBe("none");
    expect(expiryState("", noon)).toBe("none");
  });
  it("is expired once the timestamp has passed", () => {
    expect(expiryState("2026-09-15T23:59:59+07:00", noon)).toBe("expired");
  });
  it("treats today as soon until the day ends", () => {
    expect(expiryState("2026-09-17T23:59:59+07:00", noon)).toBe("soon");
  });
  it("warns inside three days and not beyond", () => {
    expect(expiryState("2026-09-20T23:59:59+07:00", noon)).toBe("soon");
    expect(expiryState("2026-09-21T23:59:59+07:00", noon)).toBe("ok");
  });
});

describe("daysUntil", () => {
  it("is negative for the past and zero for today", () => {
    expect(daysUntil("2026-09-15", noon)).toBe(-2);
    expect(daysUntil("2026-09-17", noon)).toBe(0);
    expect(daysUntil("2026-09-20", noon)).toBe(3);
  });
});

describe("matchesExpiryFilter", () => {
  it("soon includes what has already gone off", () => {
    expect(matchesExpiryFilter(item("2026-09-15T23:59:59+07:00"), "soon", noon)).toBe(true);
    expect(matchesExpiryFilter(item("2026-09-19T23:59:59+07:00"), "soon", noon)).toBe(true);
    expect(matchesExpiryFilter(item("2026-10-19T23:59:59+07:00"), "soon", noon)).toBe(false);
    expect(matchesExpiryFilter(item(null), "soon", noon)).toBe(false);
  });
  it("expired is the strict subset", () => {
    expect(matchesExpiryFilter(item("2026-09-15T23:59:59+07:00"), "expired", noon)).toBe(true);
    expect(matchesExpiryFilter(item("2026-09-19T23:59:59+07:00"), "expired", noon)).toBe(false);
  });
  it("all lets everything through", () => {
    expect(matchesExpiryFilter(item(null), "all", noon)).toBe(true);
  });
});

describe("defaultShelfLifeDays", () => {
  it("follows the storage type and falls back to room temperature", () => {
    expect(defaultShelfLifeDays("chilled")).toBe(3);
    expect(defaultShelfLifeDays("frozen")).toBe(30);
    expect(defaultShelfLifeDays("dry")).toBe(180);
    expect(defaultShelfLifeDays(undefined)).toBe(2);
    expect(defaultShelfLifeDays("weird")).toBe(2);
  });
});

describe("a picked date round-trips through days", () => {
  it("stores 25 Sep as the days from today and gives 25 Sep back", () => {
    const today = new Date(2026, 8, 19, 18, 0);
    const days = daysUntil("2026-09-25", today);
    expect(days).toBe(6);
    expect(expiryDateFromDays(days, today)).toBe("2026-09-25");
  });
});

describe("restockShelfLifePresets", () => {
  it("follows the storage type, and opens on that type's default", () => {
    expect(restockShelfLifePresets("room_temp")).toEqual([2, 3, 7]);
    expect(restockShelfLifePresets("chilled")).toEqual([3, 5, 7]);
    expect(restockShelfLifePresets("frozen")).toEqual([30, 60, 90]);
    expect(restockShelfLifePresets("dry")).toEqual([180, 365, 730]);
    for (const type of ["room_temp", "chilled", "frozen", "dry"]) {
      expect(restockShelfLifePresets(type)[0]).toBe(defaultShelfLifeDays(type));
    }
  });

  it("treats a sealed bottle on the shelf as shelf-stable, not as two-day food", () => {
    expect(restockShelfLifePresets("room_temp", true)).toEqual([180, 365, 730]);
    expect(restockShelfLifePresets(undefined, true)).toEqual([180, 365, 730]);
    // Sealed but chilled (a carton of milk) keeps the fridge's short range.
    expect(restockShelfLifePresets("chilled", true)).toEqual([3, 5, 7]);
  });
});

describe("formatShelfLife", () => {
  it("reads whole months and years as such", () => {
    expect(formatShelfLife(2, "th")).toBe("2 วัน");
    expect(formatShelfLife(30, "th")).toBe("1 เดือน");
    expect(formatShelfLife(180, "th")).toBe("6 เดือน");
    expect(formatShelfLife(365, "th")).toBe("1 ปี");
    expect(formatShelfLife(730, "th")).toBe("2 ปี");
    expect(formatShelfLife(45, "th")).toBe("45 วัน");
  });
});
