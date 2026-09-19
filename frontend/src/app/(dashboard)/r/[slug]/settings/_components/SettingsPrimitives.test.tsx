import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  FOCUS_RING,
  SettingsButton,
  SettingsField,
  SettingsItem,
  SettingsMediaRow,
  SettingsSearchContext,
  SettingsSkeleton,
  SettingsSwitch,
  matchesSetting,
} from "./SettingsPrimitives";

function attribute(markup: string, tag: string, name: string): string | undefined {
  const element = markup.match(new RegExp(`<${tag}\\b[^>]*>`))?.[0] ?? "";
  return element.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];
}

const noop = () => {};

describe("SettingsItem", () => {
  it("lays out title, description and control as the reference row does", () => {
    const markup = renderToStaticMarkup(<SettingsItem title="VAT" description="บวกภาษีเข้าไปในบิล">control</SettingsItem>);

    expect(markup).toContain("text-[18px]");
    expect(markup).toContain("md:max-w-[50%]");
    expect(markup).toContain("md:flex-row");
    // A hairline under every row, coloured by the shell token.
    expect(markup).toContain("border-b");
    expect(markup).toContain("border-[color:var(--dashboard-shell-border)]");
  });

  it("hides when the search query does not match its title or description", () => {
    const row = <SettingsItem title="VAT" description="บวกภาษีเข้าไปในบิล">control</SettingsItem>;
    const match = renderToStaticMarkup(<SettingsSearchContext.Provider value="ภาษี">{row}</SettingsSearchContext.Provider>);
    const miss = renderToStaticMarkup(<SettingsSearchContext.Provider value="โลโก้">{row}</SettingsSearchContext.Provider>);

    expect(attribute(match, "div", "hidden")).toBeUndefined();
    expect(attribute(miss, "div", "hidden")).toBe("");
  });
});

describe("matchesSetting", () => {
  it("needs every word, in any case, somewhere in the texts", () => {
    expect(matchesSetting("", "anything")).toBe(true);
    expect(matchesSetting("  vat  ", "VAT", "")).toBe(true);
    expect(matchesSetting("service rate", "Service charge (%)", "the rate from 0 to 30")).toBe(true);
    expect(matchesSetting("service logo", "Service charge (%)", "the rate")).toBe(false);
  });
});

describe("SettingsSwitch", () => {
  it("is a switch named by its row title and reports its state", () => {
    const on = renderToStaticMarkup(<SettingsSwitch label="VAT" description="d" checked onChange={noop} />);
    const off = renderToStaticMarkup(<SettingsSwitch label="VAT" description="d" checked={false} onChange={noop} />);
    const titleId = attribute(on, "p", "id");

    expect(attribute(on, "button", "role")).toBe("switch");
    expect(attribute(on, "button", "aria-checked")).toBe("true");
    expect(attribute(off, "button", "aria-checked")).toBe("false");
    expect(attribute(on, "button", "aria-labelledby")).toBe(titleId);
  });
});

describe("SettingsField", () => {
  it("labels the input with the row title", () => {
    const markup = renderToStaticMarkup(<SettingsField label="ชื่อร้าน" description="d" value="" onChange={noop} />);

    expect(attribute(markup, "label", "for")).toBe(attribute(markup, "input", "id"));
  });

  it("marks itself invalid and points at the message that says why", () => {
    const markup = renderToStaticMarkup(<SettingsField label="ชื่อร้าน" description="d" value="" onChange={noop} error="กรอกชื่อร้าน" />);
    const describedBy = attribute(markup, "input", "aria-describedby");

    expect(attribute(markup, "input", "aria-invalid")).toBe("true");
    expect(markup).toContain(`id="${describedBy}"`);
    expect(markup).toContain("กรอกชื่อร้าน");
  });

  it("says nothing about validity while the value is fine", () => {
    const markup = renderToStaticMarkup(<SettingsField label="ชื่อร้าน" description="d" value="ครัวบ้าน" onChange={noop} />);

    expect(attribute(markup, "input", "aria-invalid")).toBeUndefined();
    expect(attribute(markup, "input", "aria-describedby")).toBeUndefined();
  });

  it("is the reference's flat field: 40px, tinted, 300px wide from md", () => {
    const classes = (attribute(renderToStaticMarkup(<SettingsField label="x" description="d" value="" onChange={noop} />), "input", "class") ?? "").split(" ");

    expect(classes).toEqual(expect.arrayContaining(["h-10", "rounded-[2px]", "bg-(--settings-field)", "md:w-[300px]"]));
  });

  it("gives a one-line field a full 40px line box so Thai tone marks are not clipped", () => {
    // With p-2 the input's line box was 24px and the marks above stacked
    // vowels (ตี๋, ปั๊ม) were sliced off.
    const classes = (attribute(renderToStaticMarkup(<SettingsField label="x" description="d" value="สุกี้ตี๋ใหญ่" onChange={noop} />), "input", "class") ?? "").split(" ");

    expect(classes).toContain("leading-10");
    expect(classes).not.toContain("p-2");
    expect(classes.some((name) => /^py-/.test(name))).toBe(false);
  });

  it("marks an invalid time field as invalid", () => {
    const markup = renderToStaticMarkup(<SettingsField label="เวลาเปิด" description="d" type="time" value="5:00" onChange={noop} error="เวลาเปิดต้องอยู่ในรูปแบบ HH:mm" />);

    expect(markup).toMatch(/\s(?:aria-invalid|data-invalid)="true"/);
  });

  it("never pairs its focus outline with outline-none", () => {
    // Tailwind v4's outline-none sets --tw-outline-style: none, which a later
    // outline width does not undo - the focused field would draw no outline.
    const classes = (attribute(renderToStaticMarkup(<SettingsField label="x" description="d" value="" onChange={noop} />), "input", "class") ?? "").split(" ");

    expect(classes).toContain("focus-visible:outline-2");
    expect(classes).not.toContain("outline-none");
  });
});

describe("SettingsButton", () => {
  it("keeps its label for screen readers while it works, and cannot be pressed twice", () => {
    const markup = renderToStaticMarkup(<SettingsButton loading>บันทึก</SettingsButton>);

    expect(attribute(markup, "button", "aria-busy")).toBe("true");
    expect(markup).toMatch(/<button\b[^>]*\sdisabled=""/);
    expect(markup).toContain("บันทึก");
  });

  it("is the reference's 48px button otherwise", () => {
    const markup = renderToStaticMarkup(<SettingsButton>บันทึก</SettingsButton>);

    expect(attribute(markup, "button", "aria-busy")).toBeUndefined();
    expect(attribute(markup, "button", "type")).toBe("button");
    expect((attribute(markup, "button", "class") ?? "").split(" ")).toContain("h-12");
  });

  it("draws the brand focus ring in both themes", () => {
    expect(FOCUS_RING).toContain("focus-visible:outline-orange-700");
    expect(FOCUS_RING).toContain("dark:focus-visible:outline-orange-400");
  });
});

describe("SettingsMediaRow", () => {
  const row = (imageSrc: string) => (
    <SettingsMediaRow
      title="โลโก้ร้าน"
      description="d"
      imageSrc={imageSrc}
      imageAlt="ครัวบ้าน"
      emptyLabel="ไม่มีโลโก้"
      uploadLabel="อัปโหลด"
      replaceLabel="เปลี่ยน"
      busy={false}
      onFile={noop}
    />
  );

  it("names its action after the image, never a bare verb", () => {
    expect(attribute(renderToStaticMarkup(row("")), "button", "aria-label")).toBe("อัปโหลด โลโก้ร้าน");
    expect(attribute(renderToStaticMarkup(row("https://cdn.example.test/logo.png")), "button", "aria-label")).toBe("เปลี่ยน โลโก้ร้าน");
  });

  it("says there is no image instead of leaving the frame blank", () => {
    expect(renderToStaticMarkup(row(""))).toContain("ไม่มีโลโก้");
  });

  it("offers only the files the backend accepts", () => {
    // backend validateImageUpload: jpg, jpeg, png, webp.
    expect(attribute(renderToStaticMarkup(row("")), "input", "accept")).toBe("image/png,image/jpeg,image/webp");
  });
});

describe("SettingsSkeleton", () => {
  it("announces the load and hides the placeholder bars", () => {
    const markup = renderToStaticMarkup(<SettingsSkeleton label="กำลังโหลดข้อมูลร้าน" rows={1} />);

    expect(attribute(markup, "div", "role")).toBe("status");
    expect(markup).toContain("กำลังโหลดข้อมูลร้าน");
    expect(markup).toContain('aria-hidden="true"');
  });
});
