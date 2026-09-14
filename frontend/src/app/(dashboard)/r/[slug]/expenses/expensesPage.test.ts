import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(
  fileURLToPath(new URL("./page.tsx", import.meta.url)),
  "utf8",
);

describe("expenses page integration guards", () => {
  it("ignores stale list responses after the month or category changes", () => {
    expect(pageSource).toContain("const requestGeneration = expenseRequests.begin();");
    expect(pageSource.match(/expenseRequests\.isCurrent\(requestGeneration\)/g)).toHaveLength(3);
  });

  it("never renders ledger data from a previously active restaurant", () => {
    expect(pageSource).toContain("const restaurantId = activeMembership?.restaurant_id ?? null;");
    expect(pageSource).toContain(
      "const scopedData = canView && data.restaurantId === restaurantId ? data : EMPTY_EXPENSE_DATA;",
    );
    expect(pageSource).toContain("restaurantId: requestedRestaurantId,");
    expect(pageSource).toContain(
      "}, [canView, categoryFilter, copy.loadError, expenseRequests, monthEnd, monthStart, restaurantId]);",
    );
  });

  it("drops edit-form and mutation UI state when the active restaurant changes", () => {
    expect(pageSource).toContain(
      "const form = storedForm.restaurantId === restaurantId ? storedForm : emptyForm(restaurantId);",
    );
    expect(pageSource).toContain("const saving = restaurantId !== null && savingRestaurantId === restaurantId;");
    // Formatting-tolerant: the guard is that the edit prefill still stamps the
    // row's restaurantId, wherever the call is laid out.
    expect(pageSource).toMatch(/setForm\(\{\s*restaurantId,\s*id: expense\.ID,/);
  });

  it("pages only the on-screen rows, never the exported ones", () => {
    // The ledger list is the one place that slices; the PDF body, the print
    // table and the row-cap notice all have to keep the whole month.
    expect(pageSource).toContain("{visibleExpenses.map((expense) => (");
    expect(pageSource).toContain("body: sortedExpenses.map((expense, index) => [");
    expect(pageSource).toContain("{sortedExpenses.map((expense, index) => (");
    expect(pageSource).not.toContain("visibleExpenses.length");
  });

  it("clamps the page instead of resetting it, so a shrinking list cannot strand the view", () => {
    expect(pageSource).toContain(
      "const pageCount = Math.max(1, Math.ceil(scopedData.expenses.length / pageSize));",
    );
    expect(pageSource).toContain("const currentPage = Math.min(page, pageCount);");
  });

  it("gives the ledger row and its delete action meaningful accessible names", () => {
    // Edit is the row itself now, so the row carries the name a button used to.
    expect(pageSource).toContain('"aria-label": `${copy.edit}: ${expense.note || copy.categories[expense.category]}`');
    expect(pageSource).toContain('aria-label={`${copy.deleteAction}: ${expense.note || copy.categories[expense.category]}`}');
  });
});
