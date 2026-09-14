import { describe, expect, it } from "vitest";

import { tableStatusEditorState } from "./tablesPageUtils";

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
