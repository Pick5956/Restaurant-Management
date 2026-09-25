import axios from "axios";

// The shared answer to "what does a failed request say on screen". The server
// answers in English and in its own words ("missing view_orders permission",
// "record not found", "internal server error"), and pages used to put
// `apiErrorMessage(error) || copy.fallback` in their banners, so that English
// reached staff and customers. The rule: never show the API's own wording.
//
// A page maps the refusals it knows (a table already in service, a name
// already taken) with its own table first, then falls back to this for the
// failures every page shares, and to its own fallback line for anything else.

export type ApiFailureKind = "offline" | "server_busy" | "rate_limited" | "forbidden" | "not_found" | "unknown";

export function apiFailureKind(error: unknown): ApiFailureKind {
  if (!axios.isAxiosError(error)) return "unknown";
  const status = error.response?.status;
  if (status === undefined) return "offline";
  if (status >= 500) return "server_busy";
  if (status === 429) return "rate_limited";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  return "unknown";
}

const DETAILS: Record<Exclude<ApiFailureKind, "unknown">, { th: string; en: string }> = {
  offline: { th: "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจอินเทอร์เน็ตแล้วลองใหม่", en: "Cannot reach the server. Check the connection and try again." },
  server_busy: { th: "ระบบขัดข้องชั่วคราว ลองใหม่อีกครั้ง", en: "The service is having trouble. Try again." },
  rate_limited: { th: "ส่งคำขอถี่เกินไป ลองใหม่ในอีกสักครู่", en: "Too many attempts. Try again shortly." },
  forbidden: { th: "บัญชีนี้ไม่มีสิทธิ์ทำรายการนี้", en: "This account does not have permission for this." },
  not_found: { th: "ไม่พบรายการนี้แล้ว", en: "This no longer exists." },
};

/**
 * The page's own words for a failed request: a shared failure's line when the
 * failure is one every page shares, otherwise `fallback`. Never the server's
 * wording.
 */
export function apiFailureText(error: unknown, language: "th" | "en", fallback: string): string {
  const kind = apiFailureKind(error);
  return kind === "unknown" ? fallback : DETAILS[kind][language];
}
