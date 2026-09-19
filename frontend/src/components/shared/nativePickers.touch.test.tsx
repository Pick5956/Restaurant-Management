import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Everything in this file runs as if the primary pointer were a finger.
vi.mock("@/src/hooks/useCoarsePointer", () => ({ useCoarsePointer: () => true }));

import ThemedSelect from "./ThemedSelect";
import ThemedTimeInput from "./ThemedTimeInput";

describe("on a touch device", () => {
  it("ThemedSelect hands the list to a native select instead of drawing its menu", () => {
    const markup = renderToStaticMarkup(
      <ThemedSelect value="waiter" onChange={() => {}} options={[{ value: "waiter", label: "Waiter" }]} />,
    );

    expect(markup).toContain("<select");
    expect(markup).not.toContain("<button");
  });

  it("ThemedTimeInput leaves the native input as the only form control, so a wrapping label names it", () => {
    // A <label> names and clicks only its first form control. A hidden button
    // before the input would take the label's name, and a tap on the label text
    // would open the drawn panel under the OS picker.
    const markup = renderToStaticMarkup(
      <label>
        เวลาเปิด
        <ThemedTimeInput value="17:00" onChange={() => {}} />
      </label>,
    );

    expect(markup).toContain('type="time"');
    expect(markup).not.toContain("<button");
    expect(markup).not.toContain("aria-label=");
  });

  it("ThemedTimeInput names the input from aria-label when no label wraps it", () => {
    const markup = renderToStaticMarkup(
      <ThemedTimeInput value="17:00" onChange={() => {}} aria-label="เวลาปิด" />,
    );

    expect(markup).toMatch(/<input[^>]*type="time"[^>]*aria-label="เวลาปิด"/);
  });

  it("ThemedTimeInput keeps a disabled field as the disabled button screen readers can still find", () => {
    const markup = renderToStaticMarkup(<ThemedTimeInput value="17:00" onChange={() => {}} disabled />);

    expect(markup).not.toContain('type="time"');
    expect(markup).toMatch(/<button[^>]*disabled=""/);
    expect(markup).not.toMatch(/<button[^>]*aria-hidden/);
  });
});
