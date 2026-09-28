import { afterAll, beforeEach, describe, expect, it } from "vitest";

// The suite runs in node. The module reads localStorage through `window` and
// announces changes with a DOM event, so a small window is stood up here — the
// same way aiChatStorage.test.ts does it.
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
});

// Imported after the window exists, so the module's own reads see it.
const prefs = await import("@/src/lib/aiPrefs");

describe("aiPrefs", () => {
  beforeEach(() => {
    storage.clear();
  });

  // With nothing set the greeting is "สวัสดีเจ้าของร้าน" (the default was
  // "คุณผู้จัดการ" until 28 ก.ย. 2569), and a chosen name replaces the whole
  // title, not just part of it.
  it("greets with the default title and with a chosen one", () => {
    expect(prefs.welcomeFor("th", "")).toBe("สวัสดีเจ้าของร้าน");
    expect(prefs.welcomeFor("th", "  พี่เก่ง ")).toBe("สวัสดีพี่เก่ง");
    expect(prefs.welcomeFor("en", "")).toBe("Hello, Owner");
    expect(prefs.welcomeFor("en", "Boss")).toBe("Hello, Boss");
  });

  // Follow-ups are on unless the owner switched them off — a fresh browser
  // with nothing stored shows them.
  it("shows follow-ups by default and remembers switching them off", () => {
    expect(prefs.followUpsEnabled()).toBe(true);
    prefs.setFollowUpsEnabled(false);
    expect(prefs.followUpsEnabled()).toBe(false);
    prefs.setFollowUpsEnabled(true);
    expect(prefs.followUpsEnabled()).toBe(true);
    expect(storage.getItem("aiFollowUpsEnabled")).toBeNull();
  });

  // The cached title is a convenience for first paint: empty clears it rather
  // than storing an empty string that would read as a chosen name.
  it("caches the owner title and clears it on empty", () => {
    prefs.cacheOwnerTitle(" พี่เก่ง ");
    expect(prefs.cachedOwnerTitle()).toBe("พี่เก่ง");
    prefs.cacheOwnerTitle("   ");
    expect(prefs.cachedOwnerTitle()).toBe("");
    expect(storage.getItem("aiOwnerTitle")).toBeNull();
  });

  // A change is announced, so an open chat re-renders its greeting and its
  // follow-up rows without a reload.
  it("announces changes to subscribers", () => {
    let fired = 0;
    fakeWindow.addEventListener("ai-prefs-change", () => {
      fired += 1;
    });
    prefs.setFollowUpsEnabled(false);
    prefs.cacheOwnerTitle("พี่เก่ง");
    expect(fired).toBe(2);
  });
});
