import { describe, expect, it } from "vitest";

import { matchPreset, presetRange, rangeDayCount, rangeProblem } from "../reportRange";

const TODAY = "2026-09-15";

describe("report range", () => {
  it("presets cover whole calendar days ending today", () => {
    expect(presetRange("last14", TODAY)).toEqual({ from: "2026-09-02", to: TODAY });
    expect(presetRange("yesterday", TODAY)).toEqual({ from: "2026-09-14", to: "2026-09-14" });
    expect(presetRange("thisMonth", TODAY)).toEqual({ from: "2026-09-01", to: TODAY });
    expect(presetRange("lastMonth", "2026-01-10")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(matchPreset({ from: "2026-09-09", to: TODAY }, TODAY)).toBe("last7");
    expect(matchPreset({ from: "2026-09-03", to: "2026-09-04" }, TODAY)).toBeNull();
    expect(rangeDayCount({ from: "2026-08-28", to: "2026-09-03" })).toBe(7);
  });

  it("names what is wrong with a typed range", () => {
    expect(rangeProblem({ from: "2026-09-05", to: "2026-09-05" }, TODAY)).toBeNull();
    expect(rangeProblem({ from: "2026-09-10", to: "2026-09-02" }, TODAY)).toBe("order");
    expect(rangeProblem({ from: "2026-09-20", to: "2026-09-25" }, TODAY)).toBe("future");
    expect(rangeProblem({ from: "2026-06-01", to: TODAY }, TODAY)).toBe("tooLong");
    expect(rangeProblem({ from: "2026-09-01", to: "2026-09-30" }, TODAY)).toBeNull();
    expect(rangeProblem({ from: "", to: TODAY }, TODAY)).toBe("order");
  });
});
