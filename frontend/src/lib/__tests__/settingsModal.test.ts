import { describe, expect, it } from "vitest";

import { listenForSettings, openSettings, settingsRequestForPath, type OpenSettingsDetail } from "../settingsModal";

describe("openSettings", () => {
  it("reaches a window that is already listening, and says so", () => {
    const heard: OpenSettingsDetail[] = [];
    const stop = listenForSettings((detail) => heard.push(detail));

    expect(openSettings({ section: "display" })).toBe(true);
    expect(heard).toEqual([{ section: "display" }]);
    stop();
  });

  it("keeps a request made before any window mounts for the first one that does", () => {
    // An old /settings address typed in: the page asks before the layout listens.
    expect(openSettings({ section: "restaurant", focus: "billing" })).toBe(false);

    const heard: OpenSettingsDetail[] = [];
    const stop = listenForSettings((detail) => heard.push(detail));
    expect(heard).toEqual([{ section: "restaurant", focus: "billing" }]);
    stop();

    // Delivered once: a window mounting later does not reopen it.
    const later: OpenSettingsDetail[] = [];
    const stopLater = listenForSettings((detail) => later.push(detail));
    expect(later).toEqual([]);
    stopLater();
  });
});

describe("settingsRequestForPath", () => {
  it("maps each old settings address to its section", () => {
    expect(settingsRequestForPath("/settings")).toEqual({});
    expect(settingsRequestForPath("/settings/account")).toEqual({ section: "account" });
    expect(settingsRequestForPath("/settings/display")).toEqual({ section: "display" });
    expect(settingsRequestForPath("/settings/restaurant")).toEqual({ section: "restaurant", focus: undefined });
    expect(settingsRequestForPath("/settings/restaurant", "?group=billing")).toEqual({ section: "restaurant", focus: "billing" });
  });
});
