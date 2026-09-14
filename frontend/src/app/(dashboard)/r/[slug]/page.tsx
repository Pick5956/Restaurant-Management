"use client";

import { useEffect } from "react";
import { DashboardPageSkeleton } from "@/src/components/shared/Skeleton";
import { useRestaurantNav } from "@/src/hooks/useRestaurantNav";
import { getDefaultWorkspaceRoute } from "@/src/lib/workMode";
import { useAuth } from "@/src/providers/AuthProvider";

// /r/<slug> on its own opens the page this member's role starts on.
export default function RestaurantRootPage() {
  const { activeMembership } = useAuth();
  const { replace } = useRestaurantNav();

  useEffect(() => {
    if (activeMembership) replace(getDefaultWorkspaceRoute(activeMembership));
  }, [activeMembership, replace]);

  return <DashboardPageSkeleton />;
}
