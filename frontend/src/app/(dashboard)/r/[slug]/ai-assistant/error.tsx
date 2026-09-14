"use client";

import AIAssistantErrorState from "@/src/components/shared/AIAssistantErrorState";
import { deleteAIConversation } from "@/src/lib/ai";
import {
  chatStorageKey,
  clearStoredChat,
  loadStoredConversationId,
} from "@/src/lib/aiChatStorage";
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

  const startNewChat = () => {
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
      onRetry={reset}
      onStartNewChat={startNewChat}
    />
  );
}
