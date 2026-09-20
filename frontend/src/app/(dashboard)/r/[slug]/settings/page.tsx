"use client";

import { useAuth } from "@/src/providers/AuthProvider";
import { can } from "@/src/lib/rbac";
import AccountSettingsPage from "./account/page";
import DisplaySettingsPage from "./display/page";
import RestaurantSettingsPage from "./restaurant/page";

/**
 * "View all": every category's rows one after another, in the order of the
 * category list. Each block is tagged so the list can mark the one on screen.
 * A category the account may not open is left out rather than shown refused.
 */
export default function SettingsViewAllPage() {
  const { activeMembership } = useAuth();
  return (
    <>
      <div data-settings-category="account" className="scroll-mt-24">
        <AccountSettingsPage />
      </div>
      <div data-settings-category="display" className="scroll-mt-24">
        <DisplaySettingsPage />
      </div>
      {can(activeMembership, "manage_restaurant_settings") ? (
        <div data-settings-category="restaurant" className="scroll-mt-24">
          <RestaurantSettingsPage />
        </div>
      ) : null}
    </>
  );
}
