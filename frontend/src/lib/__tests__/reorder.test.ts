import { describe, expect, it } from "vitest";
import { dropIndex, landingOffset, makeRoomOffset, moveItem } from "../reorder";

describe("moveItem", () => {
  it("moves an entry down past the ones below it", () => {
    expect(moveItem(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
  });

  it("moves an entry up", () => {
    expect(moveItem(["a", "b", "c", "d"], 3, 1)).toEqual(["a", "d", "b", "c"]);
  });

  it("clamps a target past either end", () => {
    expect(moveItem(["a", "b", "c"], 0, 9)).toEqual(["b", "c", "a"]);
    expect(moveItem(["a", "b", "c"], 2, -4)).toEqual(["c", "a", "b"]);
  });

  it("returns a copy, never the list it was given", () => {
    const list = ["a", "b"];
    const same = moveItem(list, 1, 1);
    expect(same).toEqual(list);
    expect(same).not.toBe(list);
    expect(moveItem(list, 5, 0)).toEqual(list);
  });
});

describe("dropIndex", () => {
  // The other rows' middles, 50px apart.
  const centers = [25, 75, 125];

  it("lands first above every middle", () => {
    expect(dropIndex(centers, 10)).toBe(0);
  });

  it("lands after each middle the pointer has passed", () => {
    expect(dropIndex(centers, 80)).toBe(2);
  });

  it("lands last below every middle", () => {
    expect(dropIndex(centers, 400)).toBe(3);
  });
});

describe("drag offsets", () => {
  // Three 40px rows with a 4px gap: tops at 0, 44 and 88.
  const boxes = [
    { top: 0, height: 40 },
    { top: 44, height: 40 },
    { top: 88, height: 40 },
  ];

  it("slides the passed rows up one row when dragging down", () => {
    expect([1, 2].map((index) => makeRoomOffset(boxes, 0, 2, index))).toEqual([-44, -44]);
  });

  it("slides the passed rows down one row when dragging up", () => {
    expect([0, 1].map((index) => makeRoomOffset(boxes, 2, 0, index))).toEqual([44, 44]);
  });

  it("leaves rows outside the move where they are", () => {
    expect(makeRoomOffset(boxes, 0, 1, 2)).toBe(0);
    expect(makeRoomOffset(boxes, 1, 1, 0)).toBe(0);
  });

  it("lands the dragged row exactly in its new slot", () => {
    expect(landingOffset(boxes, 0, 2)).toBe(88);
    expect(landingOffset(boxes, 2, 0)).toBe(-88);
    expect(landingOffset(boxes, 1, 1)).toBe(0);
  });
});
