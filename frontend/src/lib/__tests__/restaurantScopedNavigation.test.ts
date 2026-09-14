import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { RESTAURANT_PAGE_ROOTS } from "../restaurantPath";

// Every restaurant page lives under /r/<slug>. A bare "/menu" link or push
// from inside a restaurant used to be the whole URL; now it lands on the old
// root path and costs a proxy redirect to whichever restaurant the COOKIE
// names - which may not be the one this tab is in. These guards read the
// source, because a wrong call site is invisible to a test of the helpers.

function tsxFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return tsxFiles(path);
    return entry.isFile() && entry.name.endsWith(".tsx") ? [path] : [];
  });
}

const root = process.cwd();
const scanned = [
  ...tsxFiles(join(root, "src", "app", "(dashboard)")),
  ...tsxFiles(join(root, "src", "components", "shared")),
];
const pageRoots = RESTAURANT_PAGE_ROOTS.map((page) => page.slice(1)).join("|");
const literalPageHref = new RegExp(String.raw`href=["'` + "`" + String.raw`]/(?:${pageRoots})(?:[/?#"'` + "`" + "])");
const literalPageNavigation = new RegExp(String.raw`\.(?:push|replace)\(\s*["'` + "`" + String.raw`]/(?:${pageRoots})(?:[/?#"'` + "`" + "])");

// Components that navigate OUT of a restaurant, or resolve which restaurant a
// URL means, and so use Next's router on purpose.
const rawRouterAllowed = new Set(["src/components/shared/DashboardRestaurantGuard.tsx"]);

describe("restaurant-scoped navigation", () => {
  it("scans the dashboard and shared components", () => {
    expect(scanned.length).toBeGreaterThan(30);
  });

  it("never links to a restaurant page by its bare path", () => {
    const violations = scanned
      .filter((path) => literalPageHref.test(readFileSync(path, "utf8")))
      .map((path) => relative(root, path));
    expect(violations).toEqual([]);
  });

  it("pushes restaurant pages only through the restaurant router", () => {
    const violations = scanned.flatMap((path) => {
      const source = readFileSync(path, "utf8");
      const name = relative(root, path).replaceAll("\\", "/");
      const reasons = [
        /import\s*\{[^}]*\buseRouter\b[^}]*\}\s*from\s*["']next\/navigation["']/.test(source) && !rawRouterAllowed.has(name)
          ? "imports useRouter from next/navigation"
          : "",
        literalPageNavigation.test(source) && !source.includes("useRestaurantRouter()")
          ? "pushes a bare restaurant page path"
          : "",
      ].filter(Boolean);
      return reasons.map((reason) => `${name}: ${reason}`);
    });
    expect(violations).toEqual([]);
  });

  it("compares the current page without its /r/<slug> prefix", () => {
    const violations = scanned.flatMap((path) => {
      const source = readFileSync(path, "utf8");
      const name = relative(root, path).replaceAll("\\", "/");
      if (rawRouterAllowed.has(name) || !/usePathname\(\)/.test(source)) return [];
      const comparesToPage = new RegExp(String.raw`pathname\s*(?:===|!==|\.startsWith\()\s*["'` + "`" + String.raw`]/(?:${pageRoots})`).test(source);
      return comparesToPage && !source.includes("splitRestaurantPath") ? [`${name}: compares usePathname() to a bare page path`] : [];
    });
    expect(violations).toEqual([]);
  });

  it("pins the tab to the URL's restaurant on every resolve, before pages fetch", () => {
    // Found in a two-tab browser check: the guard only pinned the tab when the
    // URL's restaurant differed from the active one, so a tab opened on the
    // restaurant the cookie already named followed the cookie when another
    // tab switched - and showed that restaurant's stock under its own name.
    const guard = readFileSync(join(root, "src", "components", "shared", "DashboardRestaurantGuard.tsx"), "utf8");
    const pin = /useLayoutEffect\(\(\)\s*=>\s*\{\s*if \(routeRestaurantId !== null\) restaurantRepository\.bindTab\(routeRestaurantId\);\s*\},\s*\[routeRestaurantId\]\);/;
    expect(guard).toMatch(pin);
  });

  it("corrects a remembered slug that went stale after a rename", () => {
    // Also found in the browser check: after renaming, the cookie kept the old
    // slug, so the proxy sent an old /home link through the dead name to the
    // restaurant picker.
    const guard = readFileSync(join(root, "src", "components", "shared", "DashboardRestaurantGuard.tsx"), "utf8");
    expect(guard).toMatch(/restaurantRepository\.refreshRememberedSlug\(routeRestaurantId, canonicalSlug\)/);
  });
});
