"use client";

import { useRestaurantNav } from "@/src/hooks/useRestaurantNav";
import AIOperationsFloatingChat from "@/src/components/shared/AIOperationsFloatingChat";
import { shouldMountFloatingAssistant } from "@/src/lib/aiFloatingVisibility";

export default function AIOperationsFloatingChatGate() {
  const { pagePath } = useRestaurantNav();
  if (!shouldMountFloatingAssistant(pagePath)) return null;
  return <AIOperationsFloatingChat />;
}
