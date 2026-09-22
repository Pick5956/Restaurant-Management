import { describe, expect, it } from "vitest";
import { branchLabel } from "../branchLabel";

describe("branchLabel", () => {
  it("keeps a Thai branch name that already says สาขา", () => {
    expect(branchLabel("สาขาหลัก", "th")).toBe("สาขาหลัก");
  });

  it("adds สาขา in front of a bare branch name", () => {
    expect(branchLabel("สยาม", "th")).toBe("สาขาสยาม");
    expect(branchLabel("  เซ็นทรัล  ", "th")).toBe("สาขาเซ็นทรัล");
  });

  it("says there is no branch instead of leaving the line blank", () => {
    expect(branchLabel("", "th")).toBe("ไม่ระบุสาขา");
    expect(branchLabel(undefined, "en")).toBe("No branch set");
  });

  it("reads naturally in English", () => {
    expect(branchLabel("Main branch", "en")).toBe("Main branch");
    expect(branchLabel("Siam", "en")).toBe("Siam branch");
    expect(branchLabel("สาขาหลัก", "en")).toBe("สาขาหลัก");
  });
});
