import { AxiosError, AxiosHeaders } from "axios";
import { describe, expect, it } from "vitest";

import { apiFailureKind, apiFailureText } from "../apiFailure";

/** An axios failure as the dashboard's apiClient throws it. */
function failure(status: number | undefined, error: string) {
  const config = { headers: new AxiosHeaders() };
  const response = status === undefined
    ? undefined
    : { status, statusText: "", headers: {}, config, data: { error } };
  return new AxiosError(error, status === undefined ? "ERR_NETWORK" : "ERR_BAD_RESPONSE", config, undefined, response);
}

describe("apiFailureText", () => {
  it("sorts the failures every page shares", () => {
    expect(apiFailureKind(failure(undefined, "Network Error"))).toBe("offline");
    expect(apiFailureKind(failure(502, "bad gateway"))).toBe("server_busy");
    expect(apiFailureKind(failure(429, "too many requests"))).toBe("rate_limited");
    expect(apiFailureKind(failure(403, "missing view_orders permission"))).toBe("forbidden");
    expect(apiFailureKind(failure(404, "record not found"))).toBe("not_found");
    expect(apiFailureKind(failure(400, "table already has an open order"))).toBe("unknown");
    expect(apiFailureKind(new Error("boom"))).toBe("unknown");
  });

  it("says the app's words, and the page's own line for anything else - never the server's", () => {
    expect(apiFailureText(failure(403, "missing view_orders permission"), "th", "โหลดไม่สำเร็จ")).toBe("บัญชีนี้ไม่มีสิทธิ์ทำรายการนี้");
    expect(apiFailureText(failure(400, "invalid item status transition from served to cooking"), "th", "บันทึกไม่สำเร็จ")).toBe("บันทึกไม่สำเร็จ");
    for (const raw of ["missing view_orders permission", "record not found", "internal server error"]) {
      expect(apiFailureText(failure(403, raw), "en", "x")).not.toContain(raw);
    }
  });
});
