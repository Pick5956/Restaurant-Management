import { describe, expect, it } from "vitest";

import { trappedFocusIndex } from "./useDialogFocus";

describe("trappedFocusIndex", () => {
  it("wraps Tab from the last control to the first", () => {
    expect(trappedFocusIndex(3, 2, false)).toBe(0);
  });

  it("wraps Shift+Tab from the first control to the last", () => {
    expect(trappedFocusIndex(3, 0, true)).toBe(2);
  });

  it("leaves a move between two inner controls to the browser", () => {
    expect(trappedFocusIndex(3, 1, false)).toBeNull();
    expect(trappedFocusIndex(3, 1, true)).toBeNull();
    expect(trappedFocusIndex(3, 0, false)).toBeNull();
    expect(trappedFocusIndex(3, 2, true)).toBeNull();
  });

  it("pulls focus back in once it has escaped the dialog", () => {
    expect(trappedFocusIndex(3, -1, false)).toBe(0);
    expect(trappedFocusIndex(3, -1, true)).toBe(2);
  });

  it("keeps a single control focused either way", () => {
    expect(trappedFocusIndex(1, 0, false)).toBe(0);
    expect(trappedFocusIndex(1, 0, true)).toBe(0);
  });

  it("does nothing when there is nothing to focus", () => {
    expect(trappedFocusIndex(0, -1, false)).toBeNull();
  });
});
