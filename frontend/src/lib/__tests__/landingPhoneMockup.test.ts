import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (...parts: string[]) => readFileSync(join(process.cwd(), "src", ...parts), "utf8");
const landingSource = read("app", "page.tsx");
const devicesSource = read("components", "landing", "LandingDevices.tsx");

describe("landing device mockups", () => {
  it("draws its own device frames instead of a third-party phone image", () => {
    const source = landingSource + devicesSource;
    expect(source).not.toContain("PHONE_IMAGE_URL");
    expect(source).not.toContain("static.vecteezy.com");
    expect(devicesSource).toContain("export function Phone(");
    expect(landingSource).toContain("LandingDevices");
  });

  it("gives a drawn stand-in screen one image label instead of its fake UI", () => {
    expect(devicesSource).toContain('role="img"');
    expect(devicesSource).toContain("aria-label={label}");
  });
});
