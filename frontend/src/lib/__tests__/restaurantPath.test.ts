import { describe, expect, it } from "vitest";
import type { Membership } from "@/src/types/restaurant";
import {
  findMembershipForRestaurantSlug,
  isLegacyRestaurantPagePath,
  isValidRestaurantSlug,
  sanitizeRestaurantSlugInput,
  suggestRestaurantSlug,
  rebaseRestaurantPath,
  restaurantHref,
  splitRestaurantPath,
} from "../restaurantPath";

describe("restaurantHref", () => {
  it("puts a restaurant-relative page under /r/<slug>", () => {
    expect(restaurantHref("krua-pick", "/home")).toBe("/r/krua-pick/home");
    expect(restaurantHref("krua-pick", "/inventory?adjust=12")).toBe("/r/krua-pick/inventory?adjust=12");
    expect(restaurantHref("krua-pick", "/")).toBe("/r/krua-pick");
  });

  it("leaves a path that is already scoped, or not a restaurant page, alone", () => {
    expect(restaurantHref("krua-pick", "/r/other/menu")).toBe("/r/other/menu");
    expect(restaurantHref("krua-pick", "/restaurants/new")).toBe("/restaurants/new");
    expect(restaurantHref("krua-pick", "/docs/menu")).toBe("/docs/menu");
    expect(restaurantHref("krua-pick", "/menu-placeholder-v2.webp")).toBe("/menu-placeholder-v2.webp");
    expect(restaurantHref("krua-pick", "https://example.invalid/x")).toBe("https://example.invalid/x");
    expect(restaurantHref("krua-pick", "#section")).toBe("#section");
  });

  it("falls back to the bare path when there is no slug to scope with", () => {
    expect(restaurantHref(null, "/orders")).toBe("/orders");
    expect(restaurantHref("", "/orders")).toBe("/orders");
  });
});

describe("splitRestaurantPath", () => {
  it("separates the slug from the page", () => {
    expect(splitRestaurantPath("/r/krua-pick/pos/orders/42")).toEqual({ slug: "krua-pick", path: "/pos/orders/42" });
    expect(splitRestaurantPath("/r/krua-pick")).toEqual({ slug: "krua-pick", path: "/" });
    expect(splitRestaurantPath("/r/krua-pick/")).toEqual({ slug: "krua-pick", path: "/" });
    expect(splitRestaurantPath("/r/krua-pick?next=1")).toEqual({ slug: "krua-pick", path: "/?next=1" });
  });

  it("reports no slug outside a restaurant", () => {
    expect(splitRestaurantPath("/restaurants")).toEqual({ slug: null, path: "/restaurants" });
    expect(splitRestaurantPath("/r")).toEqual({ slug: null, path: "/r" });
    expect(splitRestaurantPath("/home")).toEqual({ slug: null, path: "/home" });
  });

  it("round-trips with restaurantHref", () => {
    for (const path of ["/home", "/settings/account", "/pos/orders/7?ref=A001", "/"]) {
      const { slug, path: back } = splitRestaurantPath(restaurantHref("krua-pick", path));
      expect(slug).toBe("krua-pick");
      expect(back).toBe(path);
    }
  });
});

describe("isLegacyRestaurantPagePath", () => {
  it("recognises the pages that used to live at the site root", () => {
    expect(isLegacyRestaurantPagePath("/home")).toBe(true);
    expect(isLegacyRestaurantPagePath("/pos/tables")).toBe(true);
    expect(isLegacyRestaurantPagePath("/settings/account")).toBe(true);
  });

  it("matches whole segments only", () => {
    expect(isLegacyRestaurantPagePath("/menu-placeholder-v2.webp")).toBe(false);
    expect(isLegacyRestaurantPagePath("/homework")).toBe(false);
    expect(isLegacyRestaurantPagePath("/restaurants")).toBe(false);
    expect(isLegacyRestaurantPagePath("/r/krua-pick/home")).toBe(false);
  });
});

describe("rebaseRestaurantPath", () => {
  it("moves a restaurant page onto the chosen restaurant", () => {
    expect(rebaseRestaurantPath("/home", "krua-pick")).toBe("/r/krua-pick/home");
    expect(rebaseRestaurantPath("/r/old-name/orders?date=2026-01-01", "krua-pick")).toBe("/r/krua-pick/orders?date=2026-01-01");
  });

  it("keeps a destination that is not a restaurant page", () => {
    expect(rebaseRestaurantPath("/invitations/abc", "krua-pick")).toBe("/invitations/abc");
    expect(rebaseRestaurantPath(undefined, "krua-pick")).toBeUndefined();
  });

  it("drops a bare restaurant root so the caller can pick the role's page", () => {
    expect(rebaseRestaurantPath("/r/old-name", "krua-pick")).toBeUndefined();
  });
});

// These three mirror backend/internal/restaurantslug; the cases are the same
// ones its Go tests use, so the form and the server cannot disagree.
describe("isValidRestaurantSlug", () => {
  it("accepts the URL shape the server stores", () => {
    for (const slug of ["abc", "krua-pick", "shop-24", "a1b", "a".repeat(40)]) {
      expect(isValidRestaurantSlug(slug), slug).toBe(true);
    }
  });

  it("rejects everything else", () => {
    for (const slug of ["", "ab", "a".repeat(41), "Krua", "krua pick", "krua_pick", "-krua", "krua-", "krua--pick", "ครัวปิ๊ก", "1234", "12-34", "krua.pick"]) {
      expect(isValidRestaurantSlug(slug), slug).toBe(false);
    }
  });
});

describe("sanitizeRestaurantSlugInput", () => {
  it("turns what an owner types into slug characters as they type", () => {
    expect(sanitizeRestaurantSlugInput("Krua Pick")).toBe("krua-pick");
    expect(sanitizeRestaurantSlugInput("krua_pick")).toBe("krua-pick");
    expect(sanitizeRestaurantSlugInput("ครัว pick!")).toBe("pick");
    expect(sanitizeRestaurantSlugInput("krua--pick")).toBe("krua-pick");
    expect(sanitizeRestaurantSlugInput("-krua")).toBe("krua");
  });

  it("keeps a trailing hyphen so the next word can be typed", () => {
    expect(sanitizeRestaurantSlugInput("krua-")).toBe("krua-");
  });

  it("never grows past the maximum", () => {
    expect(sanitizeRestaurantSlugInput("a".repeat(60))).toHaveLength(40);
  });
});

describe("suggestRestaurantSlug", () => {
  it("builds from the Latin part of a name, like the server does", () => {
    expect(suggestRestaurantSlug("Krua Pick")).toBe("krua-pick");
    expect(suggestRestaurantSlug("  Noodle & Co. (Siam) ")).toBe("noodle-co-siam");
    expect(suggestRestaurantSlug("ครัวปิ๊ก Kitchen 2")).toBe("kitchen-2");
    expect(suggestRestaurantSlug("Café Bangkok")).toBe("caf-bangkok");
  });

  it("has nothing to suggest without enough Latin letters", () => {
    expect(suggestRestaurantSlug("ครัวปิ๊ก")).toBe("");
    expect(suggestRestaurantSlug("24")).toBe("");
    expect(suggestRestaurantSlug("ab")).toBe("");
  });

  it("cuts a long name at a word boundary", () => {
    const slug = suggestRestaurantSlug("The Very Long Restaurant Name That Keeps Going And Going Forever");
    expect(slug.length).toBeLessThanOrEqual(32);
    expect(isValidRestaurantSlug(slug)).toBe(true);
  });
});

describe("findMembershipForRestaurantSlug", () => {
  const membership = (id: number, slug: string) => ({
    ID: id * 10,
    restaurant_id: id,
    restaurant: { ID: id, slug },
  }) as unknown as Membership;
  const memberships = [membership(3, "krua-pick"), membership(9, "noodle-bar")];

  it("finds the membership by slug", () => {
    expect(findMembershipForRestaurantSlug(memberships, "noodle-bar")?.restaurant_id).toBe(9);
  });

  it("accepts the numeric id, which no slug can look like", () => {
    expect(findMembershipForRestaurantSlug(memberships, "3")?.restaurant_id).toBe(3);
  });

  it("finds nothing for a restaurant the user is not in", () => {
    expect(findMembershipForRestaurantSlug(memberships, "someone-else")).toBeNull();
    expect(findMembershipForRestaurantSlug(memberships, "42")).toBeNull();
    expect(findMembershipForRestaurantSlug(memberships, null)).toBeNull();
  });
});
