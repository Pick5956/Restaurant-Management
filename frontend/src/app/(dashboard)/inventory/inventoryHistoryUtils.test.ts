import { describe, expect, it } from "vitest";
import {
  HISTORY_PAGE_SIZE,
  defaultHistoryRange,
  historyMovement,
  historyPageCount,
  historyTypeLabel,
  toDateInput,
} from "./inventoryHistoryUtils";
import { filenameFromDisposition, transactionParams } from "@/src/lib/ingredient";
import {
  FULL_COVER_DAYS,
  formatDaysLeft,
  getReorderPercent,
  getStockPercent,
  getTargetStock,
  reorderQuantityFor,
} from "./inventoryPageUtils";
import type { Ingredient } from "@/src/types/ingredient";
import { normalizeApiMediaUrls } from "@/src/lib/mediaUrl";

describe("toDateInput", () => {
  // toISOString() converts to UTC first, which lands on the previous day for any
  // Bangkok evening — the filter would silently miss today's movements.
  it("uses the local calendar day, not the UTC one", () => {
    const lateEvening = new Date(2026, 8, 1, 23, 30);
    expect(toDateInput(lateEvening)).toBe("2026-09-01");
  });

  it("pads single-digit months and days", () => {
    expect(toDateInput(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});

describe("defaultHistoryRange", () => {
  it("opens on the last 30 days, today included", () => {
    const range = defaultHistoryRange(new Date(2026, 8, 1));
    expect(range).toEqual({ from: "2026-08-03", to: "2026-09-01" });
  });
});

describe("historyMovement", () => {
  // "adjust" sets an absolute level rather than moving stock by an amount. Mixing
  // it into the change column would make a running total silently wrong.
  it("keeps an absolute set out of the change column", () => {
    expect(historyMovement({ type: "adjust", quantity: 3.2 })).toEqual({ change: null, setTo: 3.2 });
  });

  it("signs a stock-out negative and a stock-in positive", () => {
    expect(historyMovement({ type: "out", quantity: 0.6 })).toEqual({ change: -0.6, setTo: null });
    expect(historyMovement({ type: "in", quantity: 5 })).toEqual({ change: 5, setTo: null });
  });
});

describe("historyPageCount", () => {
  it("counts the partial last page", () => {
    expect(historyPageCount(51, HISTORY_PAGE_SIZE)).toBe(2);
    expect(historyPageCount(50, HISTORY_PAGE_SIZE)).toBe(1);
  });

  // An empty history still renders one page rather than "page 1 of 0".
  it("never reports fewer than one page", () => {
    expect(historyPageCount(0, HISTORY_PAGE_SIZE)).toBe(1);
    expect(historyPageCount(10, 0)).toBe(1);
  });
});

describe("historyTypeLabel", () => {
  it("labels every type in both languages", () => {
    expect(historyTypeLabel("", "th")).toBe("ทุกประเภท");
    expect(historyTypeLabel("in", "th")).toBe("เข้า");
    expect(historyTypeLabel("out", "en")).toBe("Out");
    expect(historyTypeLabel("adjust", "en")).toBe("Set");
  });
});

describe("transactionParams", () => {
  it("drops empty filters instead of sending blank values", () => {
    expect(transactionParams({ type: "", search: "   ", category_id: 0, page: 1 })).toEqual({});
  });

  it("passes through the filters that are set", () => {
    expect(
      transactionParams({
        ingredient_id: 7,
        category_id: 2,
        type: "in",
        search: " pork ",
        from: "2026-08-19",
        to: "2026-09-01",
        page: 3,
        limit: 50,
      }),
    ).toEqual({
      ingredient_id: "7",
      category_id: "2",
      type: "in",
      search: "pork",
      from: "2026-08-19",
      to: "2026-09-01",
      page: "3",
      limit: "50",
    });
  });
});

describe("filenameFromDisposition", () => {
  it("reads the name the server picked", () => {
    expect(
      filenameFromDisposition('attachment; filename="inventory-history-2026-08-19_2026-09-01.csv"', "x.csv"),
    ).toBe("inventory-history-2026-08-19_2026-09-01.csv");
  });

  // CORS can hide the header entirely; the download still needs a name.
  it("falls back when the header is missing", () => {
    expect(filenameFromDisposition(undefined, "inventory-history.csv")).toBe("inventory-history.csv");
  });
});

describe("normalizeApiMediaUrls", () => {
  // The response interceptor rebuilds JSON bodies to rewrite media URLs. A Blob is
  // an object too, and rebuilding it would hand the user a 0-byte CSV.
  it("leaves a Blob response untouched", () => {
    const blob = new Blob(["a,b\r\n1,2\r\n"], { type: "text/csv" });
    const result = normalizeApiMediaUrls(blob, "http://localhost:8080");
    expect(result).toBe(blob);
    expect(result.size).toBe(blob.size);
  });

  it("still rewrites media fields on a JSON body", () => {
    const payload = { items: [{ image_url: "/uploads/a.png" }] };
    const result = normalizeApiMediaUrls(payload, "http://localhost:8080");
    expect(result.items[0].image_url).toContain("http://localhost:8080");
  });
});

function ingredient(fields: Partial<Ingredient>): Ingredient {
  return {
    ID: 1,
    restaurant_id: 1,
    name: "หมูสับ",
    unit: "กรัม",
    stock: 0,
    min_stock: 0,
    cost_per_unit: 0,
    ...fields,
  };
}

describe("getStockPercent", () => {
  // An item at its reorder line is not full. The first version of this bar
  // divided by min_stock and showed exactly that, which made an item sitting at
  // its minimum look identical to one at ten times it.
  it("does not pin at 100% the moment stock reaches the minimum", () => {
    const atMinimum = ingredient({ stock: 3000, min_stock: 3000, max_stock: 9000 });
    expect(getStockPercent(atMinimum)).toBe(33);
  });

  it("caps at 100% rather than reporting a shelf as more than full", () => {
    expect(getStockPercent(ingredient({ stock: 9000, max_stock: 9000 }))).toBe(100);
    expect(getStockPercent(ingredient({ stock: 90000, max_stock: 9000 }))).toBe(100);
  });

  // Nothing has ever been observed on this shelf, so there is no ceiling to
  // divide by. A percentage here would be invented, and an empty bar would read
  // as "about to run out" when the truth is "we have no idea yet".
  it("returns null when the shelf has no observed maximum", () => {
    expect(getStockPercent(ingredient({ stock: 5000 }))).toBeNull();
    expect(getStockPercent(ingredient({ stock: 5000, max_stock: 0 }))).toBeNull();
  });

  it("reports an empty shelf as 0 once there is a maximum to measure against", () => {
    expect(getStockPercent(ingredient({ stock: 0, max_stock: 9000 }))).toBe(0);
  });
});

describe("getReorderPercent", () => {
  it("places the mark where the reorder level falls along the bar", () => {
    expect(getReorderPercent(ingredient({ stock: 0, min_stock: 2000, max_stock: 10000 }))).toBe(20);
  });

  // A reorder level at or above the observed maximum has no place on the bar.
  // Drawing it at the far end would say the shelf is permanently short, which
  // is a statement about the numbers rather than about the shelf.
  it("has no mark when the reorder level is not below the maximum", () => {
    expect(getReorderPercent(ingredient({ stock: 0, min_stock: 9000, max_stock: 9000 }))).toBeNull();
    expect(getReorderPercent(ingredient({ stock: 0, min_stock: 0, max_stock: 9000 }))).toBeNull();
    expect(getReorderPercent(ingredient({ stock: 0, min_stock: 500 }))).toBeNull();
  });
});

describe("getTargetStock", () => {
  it("aims a restock at the most the shelf has held", () => {
    expect(getTargetStock(ingredient({ stock: 200, min_stock: 1000, max_stock: 8000 }))).toBe(8000);
  });

  // Before there was an observed maximum the target was twice the reorder
  // level, which nobody chose. Ingredients that still have no maximum keep it.
  it("falls back to twice the reorder level while no maximum has been observed", () => {
    expect(getTargetStock(ingredient({ stock: 200, min_stock: 1000 }))).toBe(2000);
  });
});

describe("reorderQuantityFor", () => {
  it("turns a share of the maximum into the quantity the rest of the system reads", () => {
    expect(reorderQuantityFor(5000, 20)).toBe(1000);
  });

  it("is zero when there is no maximum or no percentage to work from", () => {
    expect(reorderQuantityFor(0, 20)).toBe(0);
    expect(reorderQuantityFor(5000, 0)).toBe(0);
  });
});

describe("formatDaysLeft", () => {
  it("collapses anything past a week into the capped label", () => {
    expect(formatDaysLeft(ingredient({ days_left: 400 }), "th")).toBe("พอใช้ 7 วัน+");
    expect(formatDaysLeft(ingredient({ days_left: 400 }), "en")).toBe("7+ days left");
  });

  it("keeps one decimal for a short runway", () => {
    expect(formatDaysLeft(ingredient({ days_left: 2.34 }), "th")).toBe("พอใช้ 2.3 วัน");
  });

  it("says nothing when there is no usage history", () => {
    expect(formatDaysLeft(ingredient({ stock: 100 }), "th")).toBeNull();
  });
});
