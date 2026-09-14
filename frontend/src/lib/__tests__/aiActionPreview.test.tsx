import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import AIActionPreviewCard from "@/src/components/shared/AIActionPreviewCard";
import {
  formatAIActionPreviewAnswer,
  formatAIActionConfirmationMessage,
  getAIActionCancellationErrorMessage,
  isTerminalAIActionCancellationError,
} from "@/src/lib/aiActionPreview";
import type { AIActionConfirmation, AIActionPreview } from "@/src/types/ai";

const preview: AIActionPreview = {
  id: "preview-1",
  action_type: "set_menu_availability",
  status: "pending",
  expires_at: "2026-08-03T12:30:00Z",
  confirmation_token: "must-not-appear-in-markup",
  summary: "ข้อความสรุปจากเซิร์ฟเวอร์ที่ไม่ควรแสดง",
  target: { menu_item_id: 42, name: "Pad Thai" },
  current: { is_available: true },
  requested: { is_available: false },
  warnings: ["คำเตือนจากเซิร์ฟเวอร์ที่ไม่ควรแสดง"],
};

describe("AIActionPreviewCard", () => {
  it("shows the before/after state in English without rendering the secret token", () => {
    const markup = renderToStaticMarkup(
      <AIActionPreviewCard
        preview={preview}
        language="en"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(markup).toContain("Review before AI takes action");
    expect(markup).toContain("Current status");
    expect(markup).toContain("Available");
    expect(markup).toContain("Unavailable");
    expect(markup).toContain("Confirm change");
    expect(markup).toContain("Change “Pad Thai” from available to unavailable.");
    expect(markup).toContain("Customers cannot order it after confirmation.");
    expect(markup).not.toContain(preview.summary);
    expect(markup).not.toContain(preview.warnings[0]);
    expect(markup).not.toContain(preview.confirmation_token);
  });

  it("renders Thai confirmation and cancellation labels", () => {
    const markup = renderToStaticMarkup(
      <AIActionPreviewCard
        preview={preview}
        language="th"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(markup).toContain("ตรวจสอบก่อนให้ AI ดำเนินการ");
    expect(markup).toContain("ยืนยันการเปลี่ยนแปลง");
    expect(markup).toContain("ยกเลิก");
  });
});

describe("formatAIActionConfirmationMessage", () => {
  const confirmation: AIActionConfirmation = {
    action_id: "action-1",
    status: "executed",
    replayed: false,
    executed_at: "2026-08-03T12:00:00Z",
    message: "executed",
    result: { menu_item_id: 42, name: "Pad Thai", is_available: false },
  };

  it("formats a localized assistant result after confirmation", () => {
    expect(formatAIActionConfirmationMessage(confirmation, "th")).toContain("ปิดขาย");
    expect(formatAIActionConfirmationMessage(confirmation, "en")).toContain("unavailable");
  });
});

describe("formatAIActionPreviewAnswer", () => {
  const backendThaiAnswer = "เตรียมปิดขายเมนูให้แล้ว กรุณายืนยัน";

  it("replaces the backend action prose with localized English above the preview", () => {
    const answer = formatAIActionPreviewAnswer(backendThaiAnswer, preview, "en");

    expect(answer).toBe("I've prepared this change for review. Nothing will change until you confirm.");
    expect(answer).not.toContain(backendThaiAnswer);
  });

  it("preserves the backend answer for Thai and for responses without an action preview", () => {
    expect(formatAIActionPreviewAnswer(backendThaiAnswer, preview, "th")).toBe(backendThaiAnswer);
    expect(formatAIActionPreviewAnswer("Regular analysis answer", undefined, "en")).toBe("Regular analysis answer");
  });
});

describe("getAIActionCancellationErrorMessage", () => {
  it("does not claim an unknown server-side preview state", () => {
    expect(getAIActionCancellationErrorMessage("en")).toBe(
      "The server could not confirm cancellation. Check the preview status and try again.",
    );
    expect(isTerminalAIActionCancellationError({ response: { status: 404 } })).toBe(true);
    expect(isTerminalAIActionCancellationError({ response: { status: 409 } })).toBe(true);
    expect(isTerminalAIActionCancellationError({ response: { status: 410 } })).toBe(true);
    expect(isTerminalAIActionCancellationError({ response: { status: 500 } })).toBe(false);
  });
});

describe("AI action request invalidation", () => {
  it("clears both mutation busy states when either chat resets its request generation", () => {
    const chatSources = [
      new URL("../../app/(dashboard)/r/[slug]/ai-assistant/page.tsx", import.meta.url),
      new URL("../../components/shared/AIOperationsFloatingChat.tsx", import.meta.url),
    ].map((url) => readFileSync(fileURLToPath(url), "utf8"));

    for (const source of chatSources) {
      expect(source.match(/conversationRequests\.invalidate\(\);/g)).toHaveLength(2);
      expect(source.match(
        /conversationRequests\.invalidate\(\);[\s\S]{0,500}?setActionConfirming\(false\);[\s\S]{0,160}?setActionCancelling\(false\);/g,
      )).toHaveLength(2);
      expect(source).toContain("async function discardPendingActionPreview(): Promise<boolean>");
      expect(source.match(/await discardPendingActionPreview\(\)/g)).toHaveLength(3);
      expect(source).toContain("subscribeToChatWrites(");
      expect(source).toContain("normalizeAIAnswer(data?.answer)");
      expect(source).toContain("formatAIActionPreviewAnswer(answer, data.action_preview, language)");
    }
  });
});
