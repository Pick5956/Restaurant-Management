import { apiClient } from "./apiClient";
import type { AIOutage } from "../components/shared/AIOutageNotice";
import type {
  AIActionConfirmation,
  AIAskRequest,
  AIAskResponse,
  AIActionPlanConfirmation,
  AIConversationMessage,
  AIConversationSummary,
  AIConversationTurn,
  AIInsight,
  AISnapshot,
} from "../types/ai";

// The assistant reports an outage rather than answering from the database
// behind the owner's back, so the two states it can report have to survive the
// trip through axios: a spent daily quota, which clears on its own and says
// when, and an unreachable provider, which does not.
export function readAIOutage(err: unknown): AIOutage | null {
  if (typeof err !== "object" || err === null || !("response" in err)) return null;
  const response = (err as {
    response?: { data?: { error?: string; code?: string; retry_after_seconds?: number } };
  }).response;
  const code = response?.data?.code;
  if (code !== "ai_quota_exceeded" && code !== "ai_provider_unavailable") return null;

  const seconds = response?.data?.retry_after_seconds;
  return {
    kind: code === "ai_quota_exceeded" ? "quota" : "provider",
    message: response?.data?.error?.trim() || "",
    retryAfterSeconds: typeof seconds === "number" && seconds > 0 ? seconds : undefined,
  };
}

export function normalizeAIAnswer(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const answer = value.trim();
  return answer || null;
}

export const askOperationsAI = (
  question: string,
  history: AIConversationMessage[] = [],
  conversationId?: string | null,
) => {
  const request: AIAskRequest = { question, history };
  const normalizedConversationId = conversationId?.trim();
  if (normalizedConversationId) request.conversation_id = normalizedConversationId;
  return apiClient.post<AIAskResponse>("/api/v1/ai/operations/ask", request);
};

// The chat list. Deleting moves a chat to the trash, where it can be restored
// for seven days; "purge" is the trash's own, permanent, delete.
const conversationPath = (conversationId: string) =>
  `/api/v1/ai/operations/conversations/${encodeURIComponent(conversationId)}`;

export const listAIConversations = (trashed = false, limit = 0) =>
  apiClient.get<{ conversations: AIConversationSummary[] }>("/api/v1/ai/operations/conversations", {
    params: { ...(trashed ? { trashed: 1 } : {}), ...(limit > 0 ? { limit } : {}) },
  });

export const getAIConversationTurns = (conversationId: string, beforeSequence = 0, limit = 0) =>
  apiClient.get<{ turns: AIConversationTurn[] }>(`${conversationPath(conversationId)}/turns`, {
    params: { ...(beforeSequence > 0 ? { before: beforeSequence } : {}), ...(limit > 0 ? { limit } : {}) },
  });

export const renameAIConversation = (conversationId: string, title: string) =>
  apiClient.patch<void>(conversationPath(conversationId), { title });

/** Move one chat to the trash. */
export const deleteAIConversation = (conversationId: string) =>
  apiClient.delete<void>(conversationPath(conversationId));

export const restoreAIConversation = (conversationId: string) =>
  apiClient.post<void>(`${conversationPath(conversationId)}/restore`);

/** Delete one chat for good — from the trash only. */
export const purgeAIConversation = (conversationId: string) =>
  apiClient.delete<void>(`${conversationPath(conversationId)}/permanent`);

/** Empty the trash for good. */
export const purgeAllTrashedAIConversations = () =>
  apiClient.post<{ deleted: number }>("/api/v1/ai/operations/conversations/purge");

export const confirmAIAction = (previewId: string, confirmationToken: string) =>
  apiClient.post<AIActionConfirmation>(
    `/api/v1/ai/operations/actions/${encodeURIComponent(previewId)}/confirm`,
    { confirmation_token: confirmationToken },
  );

export const cancelAIAction = (previewId: string) =>
  apiClient.delete<void>(`/api/v1/ai/operations/actions/${encodeURIComponent(previewId)}`);

export const confirmAIActionPlan = (planId: string, confirmationToken: string) =>
  apiClient.post<AIActionPlanConfirmation>(
    `/api/v1/ai/operations/plans/${encodeURIComponent(planId)}/confirm`,
    { confirmation_token: confirmationToken },
  );

export const cancelAIActionPlan = (planId: string) =>
  apiClient.delete<void>(`/api/v1/ai/operations/plans/${encodeURIComponent(planId)}`);

export const getOperationsSnapshot = () =>
  apiClient.get<AISnapshot>("/api/v1/ai/operations/snapshot");

export const getProactiveInsights = () =>
  apiClient.get<{ insights: AIInsight[] }>("/api/v1/ai/operations/insights");

// The eight kinds of change the assistant can prepare, in the order the
// settings screen lists them. Keys match entity.AIActionType* on the backend.
export const AI_ACTION_TYPES = [
  "set_menu_availability",
  "set_menu_price",
  "create_menu_item",
  "adjust_ingredient_stock",
  "set_ingredient_min_stock",
  "set_ingredient_cost",
  "create_ingredient",
  "create_expense",
] as const;
export type AIActionType = (typeof AI_ACTION_TYPES)[number];

// The proactive bell's kinds. sales_drop and sales_up are one switch on the
// settings screen; the screen writes both.
export const AI_INSIGHT_KINDS = ["ingredient_low", "dead_stock", "sales_drop", "sales_up", "plowhorse"] as const;
export type AIInsightKind = (typeof AI_INSIGHT_KINDS)[number];

export type AISettingsView = {
  actions_enabled: boolean;
  feature_available: boolean;
  action_types: Record<AIActionType, boolean>;
  insight_kinds: Record<AIInsightKind, boolean>;
  owner_title: string;
};

// One change from the settings screen: every field optional, the backend keeps
// what is not sent.
export type AISettingsPatch = {
  actions_enabled?: boolean;
  action_types?: Partial<Record<AIActionType, boolean>>;
  insight_kinds?: Partial<Record<AIInsightKind, boolean>>;
  owner_title?: string;
};

export const getAISettings = () =>
  apiClient.get<AISettingsView>("/api/v1/ai/operations/settings");

export const updateAISettings = (patch: AISettingsPatch) =>
  apiClient.put<AISettingsView>("/api/v1/ai/operations/settings", patch);

export const deleteAllAIConversations = () =>
  apiClient.delete<{ deleted: number }>("/api/v1/ai/operations/conversations");

