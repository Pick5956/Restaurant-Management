import { beforeEach, describe, expect, it, vi } from "vitest";

const apiClient = vi.hoisted(() => ({
  delete: vi.fn(),
  get: vi.fn(),
  post: vi.fn(),
}));

vi.mock("../apiClient", () => ({ apiClient }));

import { askOperationsAI, cancelAIAction, confirmAIAction, deleteAIConversation, normalizeAIAnswer, readAIOutage } from "@/src/lib/ai";

describe("AI conversation API", () => {
  beforeEach(() => {
    apiClient.delete.mockReset();
    apiClient.post.mockReset();
  });

  it("accepts a non-empty string answer and rejects malformed payload values", () => {
    expect(normalizeAIAnswer("  Safe answer  ")).toBe("Safe answer");
    expect(normalizeAIAnswer("")).toBeNull();
    expect(normalizeAIAnswer(null)).toBeNull();
    expect(normalizeAIAnswer({ answer: "nested" })).toBeNull();
  });

  it("passes a normalized conversation ID with the ask request", () => {
    askOperationsAI(
      "แล้วเมื่อวานล่ะ",
      [{ id: "turn-1-assistant", role: "assistant", content: "วันนี้ขายได้ 10,000 บาท" }],
      " conversation-123 ",
    );

    expect(apiClient.post).toHaveBeenCalledWith("/api/v1/ai/operations/ask", {
      question: "แล้วเมื่อวานล่ะ",
      history: [{ id: "turn-1-assistant", role: "assistant", content: "วันนี้ขายได้ 10,000 บาท" }],
      conversation_id: "conversation-123",
      ingredient_card: true,
    });
  });

  it("omits an empty conversation ID during the local-history transition", () => {
    askOperationsAI("สรุปยอดขาย", [], "  ");

    expect(apiClient.post).toHaveBeenCalledWith("/api/v1/ai/operations/ask", {
      question: "สรุปยอดขาย",
      history: [],
      ingredient_card: true,
    });
  });

  it("URL-encodes the conversation ID used by the delete endpoint", () => {
    deleteAIConversation("conversation/123");

    expect(apiClient.delete).toHaveBeenCalledWith(
      "/api/v1/ai/operations/conversations/conversation%2F123",
    );
  });

  it("sends only the confirmation token when confirming an action preview", () => {
    confirmAIAction("preview/123", "one-time-secret");

    expect(apiClient.post).toHaveBeenCalledWith(
      "/api/v1/ai/operations/actions/preview%2F123/confirm",
      { confirmation_token: "one-time-secret" },
    );
  });

  it("cancels an action preview without sending its confirmation token", () => {
    cancelAIAction("preview/123");

    expect(apiClient.delete).toHaveBeenCalledWith(
      "/api/v1/ai/operations/actions/preview%2F123",
    );
  });
});

// The assistant refuses to answer from the database once a provider is down, so
// these two shapes are the only thing standing between the owner and a blank
// failure. They have to survive the trip through axios intact.
describe("AI outage reporting", () => {
  const responseError = (status: number, data: unknown) => ({ response: { status, data } });

  it("reads a spent quota together with the wait the provider named", () => {
    const outage = readAIOutage(
      responseError(429, {
        error: "โควตา AI ถูกใช้จนหมดแล้วครับ ลองใหม่อีกครั้งใน 42 นาที",
        code: "ai_quota_exceeded",
        retry_after_seconds: 2520,
      }),
    );
    expect(outage).toEqual({
      kind: "quota",
      message: "โควตา AI ถูกใช้จนหมดแล้วครับ ลองใหม่อีกครั้งใน 42 นาที",
      retryAfterSeconds: 2520,
    });
  });

  it("reads an unreachable provider and invents no countdown", () => {
    const outage = readAIOutage(
      responseError(503, {
        error: "ตอนนี้เชื่อมต่อผู้ช่วย AI ไม่ได้ครับ",
        code: "ai_provider_unavailable",
      }),
    );
    expect(outage?.kind).toBe("provider");
    expect(outage?.retryAfterSeconds).toBeUndefined();
  });

  it("leaves ordinary failures to the ordinary error strip", () => {
    expect(readAIOutage(responseError(400, { error: "question is required" }))).toBeNull();
    expect(readAIOutage(new Error("network down"))).toBeNull();
    expect(readAIOutage(null)).toBeNull();
  });
});
