import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import ThemedTimeInput, { acceptNativeTime } from "./ThemedTimeInput";

describe("acceptNativeTime", () => {
  // On a touch device the time comes from the OS picker's <input type="time">.

  it("takes HH:MM as it is", () => {
    expect(acceptNativeTime("17:30")).toBe("17:30");
    expect(acceptNativeTime("00:00")).toBe("00:00");
  });

  it("drops the seconds a picker with seconds enabled adds", () => {
    expect(acceptNativeTime("07:05:00")).toBe("07:05");
    expect(acceptNativeTime("07:05:30.500")).toBe("07:05");
  });

  it("keeps the saved time when the picker was cleared", () => {
    // iOS has a Reset button that sends an empty value.
    expect(acceptNativeTime("")).toBeNull();
  });

  it("rejects anything that is not a clock time", () => {
    expect(acceptNativeTime("24:00")).toBeNull();
    expect(acceptNativeTime("7:30")).toBeNull();
    expect(acceptNativeTime("17:3")).toBeNull();
    expect(acceptNativeTime("17:30abc")).toBeNull();
  });
});

describe("ThemedTimeInput", () => {
  it("renders the drawn picker on the server, where no device is known yet", () => {
    const markup = renderToStaticMarkup(<ThemedTimeInput value="17:00" onChange={() => {}} />);

    expect(markup).toContain('aria-haspopup="dialog"');
    expect(markup).not.toContain('type="time"');
  });
});
