import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ThemedMultiSelect, { fittingChips, mergeSelection, splitChips, toggleValue } from "./ThemedMultiSelect";

const OPTIONS = [
  { value: "1", label: "กับข้าว" },
  { value: "2", label: "อาหารจานเดียว" },
  { value: "3", label: "เครื่องดื่ม" },
  { value: "4", label: "ของหวาน" },
];

const noop = () => {};

describe("toggleValue", () => {
  it("adds a new pick last, so the first pick stays first", () => {
    expect(toggleValue(["2"], "1")).toEqual(["2", "1"]);
  });

  it("takes an existing pick out", () => {
    expect(toggleValue(["2", "1"], "2")).toEqual(["1"]);
  });
});

describe("mergeSelection", () => {
  it("keeps earlier picks in their order when the OS picker hands back list order", () => {
    // Chosen as 3 then 1; the phone picker returns 1, 3 and a new 2 in list order.
    expect(mergeSelection(["3", "1"], ["1", "2", "3"])).toEqual(["3", "1", "2"]);
  });

  it("drops what was unticked", () => {
    expect(mergeSelection(["3", "1"], ["1"])).toEqual(["1"]);
  });
});

describe("splitChips", () => {
  it("shows chips in the order they were picked, first on the left, and counts the rest", () => {
    const { shown, hidden } = splitChips(OPTIONS, ["4", "1", "3"], 2);
    expect(shown.map((option) => option.label)).toEqual(["ของหวาน", "กับข้าว"]);
    expect(hidden).toBe(1);
  });

  it("puts a new pick at the right end", () => {
    const picked = toggleValue(["3", "1"], "2");
    expect(splitChips(OPTIONS, picked, 5).shown.map((option) => option.label)).toEqual(["เครื่องดื่ม", "กับข้าว", "อาหารจานเดียว"]);
  });

  it("has nothing hidden when everything fits", () => {
    expect(splitChips(OPTIONS, ["2"], 2).hidden).toBe(0);
  });
});

describe("fittingChips", () => {
  // Chips 100, 120 and 80 wide with 6px gaps; the "+N" chip is 40 wide.
  const widths = [100, 120, 80];

  it("shows every chip when they all fit, with no +N at all", () => {
    expect(fittingChips(widths, 40, 312)).toBe(3);
  });

  it("folds only what no longer fits, keeping room for the +N chip", () => {
    // 100 + 6 + 120 = 226, then 6 + 40 for "+1" = 272.
    expect(fittingChips(widths, 40, 280)).toBe(2);
    expect(fittingChips(widths, 40, 271)).toBe(1);
  });

  it("keeps one chip even when the field is too narrow for it", () => {
    expect(fittingChips(widths, 40, 60)).toBe(1);
  });

  it("has nothing to show when nothing is chosen", () => {
    expect(fittingChips([], 40, 300)).toBe(0);
  });
});

describe("ThemedMultiSelect", () => {
  it("shows the placeholder when nothing is chosen", () => {
    const markup = renderToStaticMarkup(<ThemedMultiSelect values={[]} onChange={noop} options={OPTIONS} placeholder="เพิ่มเข้าหมวด..." aria-label="หมวด" />);
    expect(markup).toContain("เพิ่มเข้าหมวด...");
    expect(markup).toContain('aria-haspopup="listbox"');
  });

  it("puts the chosen ones in the field as removable chips, and names what +N hides", () => {
    // Before it can measure (the server render), two chips show and the rest fold.
    const markup = renderToStaticMarkup(
      <ThemedMultiSelect values={["1", "2", "3"]} onChange={noop} options={OPTIONS} aria-label="หมวด" moreLabel={(count) => `+${count} หมวด`} />,
    );
    expect(markup).toContain('aria-label="เอาออก กับข้าว"');
    expect(markup).toContain('aria-label="เอาออก อาหารจานเดียว"');
    expect(markup).not.toContain('aria-label="เอาออก เครื่องดื่ม"');
    expect(markup).toContain("+1 หมวด");
  });
});
