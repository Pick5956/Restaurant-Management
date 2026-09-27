import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  FOCUS_RING,
  SettingsButton,
  SettingsField,
  SettingsGroup,
  SettingsItem,
  SettingsMediaRow,
  SettingsSelect,
  SettingsSkeleton,
  SettingsSwitch,
} from "./SettingsPrimitives";
import { matchesSearch } from "@/src/components/shared/settingsModalKit";

function attribute(markup: string, tag: string, name: string): string | undefined {
  const element = markup.match(new RegExp(`<${tag}\\b[^>]*>`))?.[0] ?? "";
  return element.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];
}

const noop = () => {};

describe("SettingsItem", () => {
  it("is a row of the Dishy AI settings: 13px name, 11.5px note, control on the right", () => {
    const markup = renderToStaticMarkup(<SettingsItem title="VAT" description="บวกภาษีเข้าไปในบิล">control</SettingsItem>);

    expect(markup).toContain("text-[13px]");
    expect(markup).toContain("text-[11.5px]");
    expect(markup).toContain("justify-between");
    // A hairline between rows, none above the first.
    expect(markup).toContain("border-t");
    expect(markup).toContain("first:border-t-0");
  });

  it("draws no note when the title already says it", () => {
    const markup = renderToStaticMarkup(<SettingsItem title="ละติจูด">control</SettingsItem>);

    expect(markup).not.toContain("text-[11.5px]");
  });

  it("carries its name and note for the window's search", () => {
    const markup = renderToStaticMarkup(<SettingsItem title="VAT" description="บวกภาษีเข้าไปในบิล">control</SettingsItem>);

    expect(attribute(markup, "div", "data-setting-label")).toBe("VAT");
    expect(attribute(markup, "div", "data-setting-hint")).toBe("บวกภาษีเข้าไปในบิล");
    expect(attribute(markup, "div", "data-setting-id")).toBeTruthy();
  });

  it("puts a stacked control under the text at full width", () => {
    const markup = renderToStaticMarkup(<SettingsItem title="ที่อยู่ร้าน" stack>control</SettingsItem>);

    expect(markup).toContain("flex-col");
    expect(markup).not.toContain("justify-between");
  });
});

describe("SettingsGroup", () => {
  it("names its rows with the reference's 15px heading and tags itself for jumps", () => {
    const markup = renderToStaticMarkup(<SettingsGroup id="billing" title="การคิดเงิน">rows</SettingsGroup>);

    expect(attribute(markup, "section", "data-settings-group")).toBe("billing");
    expect(attribute(markup, "section", "data-settings-group-title")).toBe("การคิดเงิน");
    expect(markup).toContain("text-[15px]");
    expect(markup).toContain("การคิดเงิน");
  });
});

describe("matchesSearch", () => {
  it("needs every word, in any case, somewhere in the texts", () => {
    expect(matchesSearch("", "anything")).toBe(true);
    expect(matchesSearch("  vat  ", "VAT", "")).toBe(true);
    expect(matchesSearch("service rate", "Service charge (%)", "the rate from 0 to 30")).toBe(true);
    expect(matchesSearch("service logo", "Service charge (%)", "the rate")).toBe(false);
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

  it("is the Dishy AI settings' text box: 32px, 16px text on a phone so iPhone does not zoom", () => {
    const classes = (attribute(renderToStaticMarkup(<SettingsField label="x" description="d" value="" onChange={noop} />), "input", "class") ?? "").split(" ");

    expect(classes).toEqual(expect.arrayContaining(["h-8", "w-44", "rounded-lg", "text-[16px]", "sm:text-[12.5px]", "focus:border-orange-300"]));
  });

  it("marks an invalid time field as invalid", () => {
    const markup = renderToStaticMarkup(<SettingsField label="เวลาเปิด" description="d" type="time" value="5:00" onChange={noop} error="เวลาเปิดต้องอยู่ในรูปแบบ HH:mm" />);

    expect(markup).toMatch(/\s(?:aria-invalid|data-invalid)="true"/);
  });

  it("draws an invalid field's edge in red", () => {
    const classes = (attribute(renderToStaticMarkup(<SettingsField label="x" description="d" value="" onChange={noop} error="e" />), "input", "class") ?? "").split(" ");

    expect(classes).toContain("border-red-300");
    expect(classes).not.toContain("border-gray-200");
  });
});

describe("SettingsSelect", () => {
  const options = [{ value: "th", label: "ไทย" }, { value: "en", label: "English" }];

  it("shows two or three choices as a segmented control named by the row", () => {
    const markup = renderToStaticMarkup(<SettingsSelect label="ภาษา" value="th" onChange={noop} options={options} />);

    expect(markup).toContain('role="radiogroup"');
    expect(markup).toMatch(/role="radio" aria-checked="true"[^>]*>ไทย</);
    expect(markup).toMatch(/role="radio" aria-checked="false"[^>]*>English</);
  });
});

describe("SettingsButton", () => {
  it("keeps its label for screen readers while it works, and cannot be pressed twice", () => {
    const markup = renderToStaticMarkup(<SettingsButton loading>บันทึก</SettingsButton>);

    expect(attribute(markup, "button", "aria-busy")).toBe("true");
    expect(markup).toMatch(/<button\b[^>]*\sdisabled=""/);
    expect(markup).toContain("บันทึก");
  });

  it("is a 32px button otherwise, the height every settings control shares", () => {
    const markup = renderToStaticMarkup(<SettingsButton>บันทึก</SettingsButton>);

    expect(attribute(markup, "button", "aria-busy")).toBeUndefined();
    expect(attribute(markup, "button", "type")).toBe("button");
    expect((attribute(markup, "button", "class") ?? "").split(" ")).toContain("h-8");
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
