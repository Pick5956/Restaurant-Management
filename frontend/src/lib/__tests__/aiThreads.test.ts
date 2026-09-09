import { afterAll, beforeEach, describe, expect, it } from "vitest";

// The suite runs in node; the module reads localStorage through `window` and
// announces changes with DOM events, so a small window is stood up here — the
// same way aiChatStorage.test.ts and aiPrefs.test.ts do it.
class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  clear() {
    this.values.clear();
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

const originalWindow = globalThis.window;
const originalLocalStorage = globalThis.localStorage;
const storage = new MemoryStorage();
const listeners = new Map<string, Set<() => void>>();
const fakeWindow = {
  localStorage: storage,
  addEventListener: (type: string, fn: () => void) => {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type)!.add(fn);
  },
  removeEventListener: (type: string, fn: () => void) => {
    listeners.get(type)?.delete(fn);
  },
  dispatchEvent: (event: { type: string }) => {
    listeners.get(event.type)?.forEach((fn) => fn());
    return true;
  },
};
Object.defineProperty(globalThis, "window", { configurable: true, value: fakeWindow });
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
if (typeof globalThis.Event === "undefined") {
  Object.defineProperty(globalThis, "Event", {
    configurable: true,
    value: class {
      constructor(public readonly type: string) {}
    },
  });
}

afterAll(() => {
  Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: originalLocalStorage });
});

const threads = await import("@/src/lib/aiThreads");

const BASE = "restaurant_ai_chat:1:4";

describe("aiThreads — the active chat and its caches", () => {
  beforeEach(() => {
    storage.clear();
  });

  it("keeps one active chat per restaurant and owner, null for an unsent chat", () => {
    expect(threads.loadActiveThread(BASE)).toBeNull();
    threads.setActiveThread(BASE, "abc123");
    expect(threads.loadActiveThread(BASE)).toBe("abc123");
    threads.setActiveThread(BASE, null);
    expect(threads.loadActiveThread(BASE)).toBeNull();
    // An id that is not one the server would issue is never stored.
    threads.setActiveThread(BASE, "not valid/id");
    expect(threads.loadActiveThread(BASE)).toBeNull();
  });

  it("announces a change so the other surface follows", () => {
    let fired = 0;
    fakeWindow.addEventListener("ai-thread-change", () => {
      fired += 1;
    });
    threads.setActiveThread(BASE, "abc123");
    expect(fired).toBe(1);
  });

  it("caches transcripts per chat and keeps only the newest five", () => {
    const ids = ["a1", "a2", "a3", "a4", "a5", "a6", "a7"];
    ids.forEach((id, index) => {
      threads.saveThreadCache(BASE, id, [
        { id: `${id}-q`, role: "user", content: "q" },
        { id, role: "assistant", content: `answer ${index}` },
      ]);
      // Distinct savedAt values, so the order is decided by time and not by luck.
      const key = threads.threadKey(BASE, id)!;
      const entry = JSON.parse(storage.getItem(key)!);
      entry.savedAt = Date.now() - (ids.length - index) * 1_000;
      storage.setItem(key, JSON.stringify(entry));
    });
    threads.pruneThreadCaches(BASE);
    const kept = ids.filter((id) => storage.getItem(threads.threadKey(BASE, id)!) !== null);
    expect(kept).toEqual(["a3", "a4", "a5", "a6", "a7"]);
    expect(threads.loadThreadCache(BASE, "a7")).toHaveLength(2);
    expect(threads.loadThreadCache(BASE, "a1")).toBeNull();
  });

  // A chat with no server id yet caches under a slot of its own, and everything
  // typed before the first answer lands there. Once the server issues an id the
  // transcript moves to that id — and the unsent slot has to be emptied, or the
  // next "new chat" opens on the leftovers instead of a clean page.
  it("empties the unsent slot when a chat gains its server id", () => {
    threads.saveThreadCache(BASE, null, [
      { id: "welcome", role: "assistant", content: "สวัสดี" },
      { id: "q1", role: "user", content: "สรุปร้าน" },
    ]);
    expect(threads.loadThreadCache(BASE, null)).toHaveLength(2);

    threads.adoptUnsentThread(BASE, "abc123", [
      { id: "welcome", role: "assistant", content: "สวัสดี" },
      { id: "q1", role: "user", content: "สรุปร้าน" },
      { id: "a1", role: "assistant", content: "วันนี้ขายได้ 4,061 บาท" },
    ]);
    threads.setActiveThread(BASE, "abc123");

    expect(threads.loadThreadCache(BASE, "abc123")).toHaveLength(3);
    expect(threads.loadThreadCache(BASE, null)).toBeNull();
  });

  // Every browser that hit the bug above is still carrying the leftover, and a
  // fix that only stops new ones would leave those owners staring at the same
  // stale page. The unsent slot ages out on its own in half an hour, so they
  // heal without being told to clear anything.
  it("forgets an unsent chat that is hours old, but keeps a real one", () => {
    const stale = (baseKey: string, id: string | null, ageMs: number) => {
      threads.saveThreadCache(baseKey, id, [
        { id: "welcome", role: "assistant", content: "สวัสดี" },
        { id: "q1", role: "user", content: "สรุปร้าน" },
      ]);
      const key = threads.threadKey(baseKey, id)!;
      const entry = JSON.parse(storage.getItem(key)!);
      entry.savedAt = Date.now() - ageMs;
      storage.setItem(key, JSON.stringify(entry));
    };

    stale(BASE, null, 3 * 60 * 60 * 1000);
    expect(threads.loadThreadCache(BASE, null)).toBeNull();

    // A minute-old draft is exactly what the slot is for, so it survives.
    stale(BASE, null, 60 * 1000);
    expect(threads.loadThreadCache(BASE, null)).toHaveLength(2);

    // A chat with a server id keeps the full seven days it always had.
    stale(BASE, "abc123", 3 * 60 * 60 * 1000);
    expect(threads.loadThreadCache(BASE, "abc123")).toHaveLength(2);
  });

  // The pre-list app kept one thread at the base key with the server id beside
  // it. On first load that thread becomes the cache of its conversation and the
  // active chat, so the owner opens the app on the chat they were in.
  it("migrates the single legacy thread into the active chat, once", () => {
    storage.setItem(BASE, JSON.stringify({ savedAt: Date.now(), messages: [{ id: "m1", role: "user", content: "สวัสดี" }] }));
    storage.setItem(`${BASE}:server-conversation`, JSON.stringify({ savedAt: Date.now(), conversationId: "legacy1" }));

    expect(threads.migrateLegacyThread(BASE)).toBe("legacy1");
    expect(threads.loadActiveThread(BASE)).toBe("legacy1");
    expect(threads.loadThreadCache(BASE, "legacy1")).toHaveLength(1);
    expect(storage.getItem(BASE)).toBeNull();
    expect(storage.getItem(`${BASE}:server-conversation`)).toBeNull();
    // Nothing left to migrate; the active chat is not disturbed.
    expect(threads.migrateLegacyThread(BASE)).toBeNull();
    expect(threads.loadActiveThread(BASE)).toBe("legacy1");
  });

  it("drops a legacy thread that never reached the server", () => {
    storage.setItem(BASE, JSON.stringify({ savedAt: Date.now(), messages: [{ id: "m1", role: "user", content: "x" }] }));
    expect(threads.migrateLegacyThread(BASE)).toBeNull();
    expect(storage.getItem(BASE)).toBeNull();
    expect(threads.loadActiveThread(BASE)).toBeNull();
  });
});

describe("aiThreads — reopening a chat from the server", () => {
  it("turns stored exchanges into the two bubbles each, with the display data on the answer", () => {
    const messages = threads.turnsToMessages([
      {
        id: "t1",
        sequence: 1,
        question: "ยอดขายวันนี้",
        answer: "4,895 บาท",
        tool: "get_sales_for_period",
        latency_ms: 4200,
        created_at: "2026-09-06T12:00:00+07:00",
        display: { tools_used: ["get_sales_for_period"], scope_assumed: false, model: "gemini-3.5-flash-lite" },
      },
      {
        id: "t2",
        sequence: 2,
        question: "เทียบกับสัปดาห์ก่อน",
        answer: "ขึ้น 12%",
        latency_ms: 5100,
        created_at: "2026-09-06T12:01:00+07:00",
        display: { chart: { kind: "bar", title: "เทียบ", categories: ["ก่อน", "นี้"], series: [] } },
      },
    ]);
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(messages[0]).toMatchObject({ id: "t1-q", content: "ยอดขายวันนี้" });
    expect(messages[1]).toMatchObject({ id: "t1", content: "4,895 บาท", tool: "get_sales_for_period", model: "gemini-3.5-flash-lite" });
    expect(messages[3].chart).toMatchObject({ kind: "bar" });
    expect(messages[1].createdAt).toBeInstanceOf(Date);
  });

  it("recognises the server's conversation_gone code and nothing else", () => {
    expect(threads.isConversationGone({ response: { data: { code: "conversation_gone" } } })).toBe(true);
    expect(threads.isConversationGone({ response: { data: { code: "not_found" } } })).toBe(false);
    expect(threads.isConversationGone(new Error("network"))).toBe(false);
  });

  it("groups chats by day the way a chat app lists them", () => {
    const now = new Date(2026, 8, 6, 20, 0, 0); // Sunday 6 Sep 2026 20:00
    expect(threads.threadGroup(new Date(2026, 8, 6, 9, 0), now)).toBe("today");
    expect(threads.threadGroup(new Date(2026, 8, 5, 23, 0), now)).toBe("yesterday");
    expect(threads.threadGroup(new Date(2026, 8, 1, 12, 0), now)).toBe("week");
    expect(threads.threadGroup(new Date(2026, 7, 20, 12, 0), now)).toBe("older");
  });

  it("filters titles as the owner types, ignoring case and blanks", () => {
    expect(threads.matchesThreadQuery("ยอดขายสัปดาห์นี้", "  ")).toBe(true);
    expect(threads.matchesThreadQuery("ยอดขายสัปดาห์นี้", "ขาย")).toBe(true);
    expect(threads.matchesThreadQuery("Menu Ranking", "menu")).toBe(true);
    expect(threads.matchesThreadQuery("ยอดขายสัปดาห์นี้", "สต๊อก")).toBe(false);
  });
});
