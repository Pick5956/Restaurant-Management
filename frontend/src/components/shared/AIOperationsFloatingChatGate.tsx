"use client";

import { useRestaurantNav } from "@/src/hooks/useRestaurantNav";
import AIOperationsFloatingChat from "@/src/components/shared/AIOperationsFloatingChat";
import { shouldMountFloatingAssistant } from "@/src/lib/aiFloatingVisibility";
import { useAuth } from "@/src/providers/AuthProvider";

export default function AIOperationsFloatingChatGate() {
  const { pagePath } = useRestaurantNav();
  const { activeMembership } = useAuth();
  // Dishy AI is the owner's only (28 ก.ย. 2569). Staff used to get the button
  // too, and it could only say the assistant was not for them.
  if (activeMembership?.role?.name !== "owner") return null;
  if (!shouldMountFloatingAssistant(pagePath)) return null;
  return <AIOperationsFloatingChat />;
}
