import { describe, expect, it } from "vitest";
import { REVEAL_MIN_PER_SECOND, graphemes, revealStep, tidyPartialMarkdown } from "../smoothReveal";

describe("graphemes", () => {
  it("keeps a Thai vowel and tone mark with the consonant they sit on", () => {
    // "กุ้ง" is two characters on screen: ก+ุ+้ and ง.
    expect(graphemes("กุ้ง")).toEqual(["กุ้", "ง"]);
    expect(graphemes("ไข่ไก่").join("")).toBe("ไข่ไก่");
  });
});

describe("revealStep", () => {
  it("moves nothing when everything that arrived is already shown", () => {
    expect(revealStep(0, 16)).toBe(0);
  });

  it("drains a long backlog faster than a short one", () => {
    expect(revealStep(200, 16)).toBeGreaterThan(revealStep(20, 16));
  });

  it("never moves slower than the floor, and never past what arrived", () => {
    expect(revealStep(5, 100)).toBeCloseTo((REVEAL_MIN_PER_SECOND * 100) / 1000);
    expect(revealStep(2, 1000)).toBe(2);
  });
});

describe("tidyPartialMarkdown", () => {
  it("holds back a bold marker whose closing pair has not arrived", () => {
    expect(tidyPartialMarkdown("ยอดขาย **93,5")).toBe("ยอดขาย 93,5");
  });

  it("leaves complete bold alone", () => {
    expect(tidyPartialMarkdown("ยอดขาย **93,524 บาท** ครับ")).toBe("ยอดขาย **93,524 บาท** ครับ");
  });
});
