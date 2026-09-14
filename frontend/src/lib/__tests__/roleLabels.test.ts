import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { roleLabel } from "../roleLabels";

const waiterRole = {
  ID: 4,
  name: "waiter",
  display_name: "Waiter",
  permissions: "[]",
  is_system: true,
};

describe("restaurant-scoped role labels", () => {
  it("prefers a restaurant display-name override in every language", () => {
    const role = { ...waiterRole, display_name_override: "ทีมหน้าร้าน" };

    expect(roleLabel(role, "th")).toBe("ทีมหน้าร้าน");
    expect(roleLabel(role, "en")).toBe("ทีมหน้าร้าน");
  });

  it("keeps untouched system roles localized instead of showing the seeded English display name", () => {
    expect(roleLabel(waiterRole, "th")).toBe("พนักงานเสิร์ฟ");
    expect(roleLabel(waiterRole, "en")).toBe("Waiter");
  });

  it("uses the display name for restaurant-created roles", () => {
    expect(roleLabel({
      ...waiterRole,
      name: "custom_9_shift_lead",
      display_name: "หัวหน้ากะ",
      is_system: false,
    }, "th")).toBe("หัวหน้ากะ");
  });

  it("uses the shared resolver on staff, restaurant selection, and public invitation surfaces", () => {
    const staffConfig = readFileSync(fileURLToPath(new URL("../../app/(dashboard)/r/[slug]/staff/staffPageConfig.ts", import.meta.url)), "utf8");
    const restaurantSelector = readFileSync(fileURLToPath(new URL("../../app/restaurants/page.tsx", import.meta.url)), "utf8");
    const publicInvitation = readFileSync(fileURLToPath(new URL("../../app/invitations/[token]/page.tsx", import.meta.url)), "utf8");

    expect(staffConfig).toContain('from "@/src/lib/roleLabels"');
    expect(restaurantSelector).toContain('from "@/src/lib/roleLabels"');
    expect(publicInvitation).toContain('from "@/src/lib/roleLabels"');
  });

  it("edits manageable role names from the dialog heading instead of a custom-role-only form card", () => {
    const staffPage = readFileSync(fileURLToPath(new URL("../../app/(dashboard)/r/[slug]/staff/page.tsx", import.meta.url)), "utf8");

    expect(staffPage).toContain("aria-label={copy.editRoleName}");
    expect(staffPage).toContain("const renameRole = async");
    expect(staffPage).not.toContain("const renameCustomRole = async");
    expect(staffPage).not.toContain('permissionTarget.type === "role" && isCustomRole(permissionTarget.role) && (');
  });

  it("keeps rename feedback visible and announced beside the inline editor", () => {
    const staffPage = readFileSync(fileURLToPath(new URL("../../app/(dashboard)/r/[slug]/staff/page.tsx", import.meta.url)), "utf8");

    expect(staffPage).toContain("roleRenameError");
    expect(staffPage).toContain('aria-live="polite"');
    expect(staffPage).toContain("aria-describedby={roleRenameError ? roleRenameErrorId : undefined}");
  });

  it("uses 44px role-name and dialog-close touch targets", () => {
    const staffPage = readFileSync(fileURLToPath(new URL("../../app/(dashboard)/r/[slug]/staff/page.tsx", import.meta.url)), "utf8");

    expect(staffPage.match(/h-11 w-11/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
  });

  it("refreshes shared memberships after renaming the active role", () => {
    const staffPage = readFileSync(fileURLToPath(new URL("../../app/(dashboard)/r/[slug]/staff/page.tsx", import.meta.url)), "utf8");

    expect(staffPage).toContain("shouldRefreshMembershipsAfterRoleRename(activeMembership, nextRole.ID)");
    expect(staffPage).toContain("void refreshMemberships()");
  });
});
