"use client";

import AIAssistantErrorState from "@/src/components/shared/AIAssistantErrorState";
import { cancelAIActionPlan, deleteAIConversation } from "@/src/lib/ai";
import {
  chatStorageKey,
  clearStoredChat,
  loadStoredConversationId,
} from "@/src/lib/aiChatStorage";
import { loadPendingPlan, savePendingPlan } from "@/src/lib/aiPendingPlan";
import { threadKey, useActiveThread } from "@/src/lib/aiThreads";
import { useAuth } from "@/src/providers/AuthProvider";
import { useLanguage } from "@/src/providers/LanguageProvider";

type AIAssistantErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function AIAssistantError({ reset }: AIAssistantErrorProps) {
  const { activeMembership, user } = useAuth();
  const { language } = useLanguage();
  const storageKey = chatStorageKey(activeMembership?.restaurant_id, user?.ID);
  const activeThread = useActiveThread(storageKey);

  // A crash takes the confirm card with it, but not the plan: the server
  // still holds it, and refuses every next command with "กดยืนยันหรือยกเลิกใน
  // กล่องข้างบน" over a box that is no longer there (25 ก.ย. 2569 — the
  // new-ingredient card crashed, and the owner's retyped command was refused).
  // Leaving this screen either way cancels it and keeps the card as cancelled,
  // so the chat reopens saying so instead of mounting the card that crashed.
  const dropPendingPlan = () => {
    const key = threadKey(storageKey, activeThread);
    const stored = loadPendingPlan(key);
    if (!stored || stored.state !== "pending") return;
    void cancelAIActionPlan(stored.plan.id).catch(() => undefined);
    savePendingPlan(key, stored.plan, "cancelled");
  };

  const retry = () => {
    dropPendingPlan();
    reset();
  };

  const startNewChat = () => {
    dropPendingPlan();
    const conversationId = loadStoredConversationId(storageKey);
    clearStoredChat(storageKey);
    if (conversationId) {
      void deleteAIConversation(conversationId).catch(() => undefined);
    }
    reset();
  };

  return (
    <AIAssistantErrorState
      language={language}
      onRetry={retry}
      onStartNewChat={startNewChat}
    />
  );
}
