import { fetch as expoFetch } from 'expo/fetch';

import { ApiError, apiRequest, apiUrl } from './client';
import {
  buildAIActionCancellationPath,
  buildAIActionConfirmationPath,
  buildAIActionConfirmationRequest,
  buildAIAskRequest,
  buildAIConversationDeletePath,
} from '@/src/lib/ai-contract';
import { parseSSE } from '@/src/lib/ai-chat';
import { getActiveRestaurantId, getToken, getTokenType } from '@/src/storage/session-store';
import type {
  AIActionConfirmation,
  AIActionPlanConfirmation,
  AIAskResponse,
  AIConversationMessage,
  AIConversationSummary,
  AIConversationTurn,
  AIInsight,
  AIReceiptDraft,
  AISettingsPatch,
  AISettingsView,
  AISnapshot,
} from '@/src/types/ai';

export const askOperationsAI = (
  question: string,
  history: AIConversationMessage[] = [],
  conversationId?: string | null,
) => apiRequest<AIAskResponse>('/api/v1/ai/operations/ask', {
  method: 'POST',
  body: JSON.stringify(buildAIAskRequest(question, history, conversationId)),
});

export type AskStreamOptions = {
  /** The answer so far, cleaned; called each time more of it arrives. */
  onDraft?: (text: string) => void;
  signal?: AbortSignal;
};

async function authHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};
  const token = await getToken();
  const tokenType = await getTokenType();
  if (token) headers.Authorization = `${tokenType} ${token}`;
  const restaurantId = await getActiveRestaurantId();
  if (restaurantId) headers['X-Restaurant-ID'] = String(restaurantId);
  return headers;
}

/**
 * Asks over `?stream=true` and reads server-sent events: `draft` carries the
 * answer so far while the model writes, `answer` the finished response (the
 * same shape the plain call returns), `error` what the plain call would have
 * failed with — thrown as the same ApiError so the outage and gone-conversation
 * checks work unchanged. If the stream cannot be opened at all, the plain call
 * answers instead, so streaming can never fail a question that would have worked.
 */
export async function askOperationsAIStream(
  question: string,
  history: AIConversationMessage[] = [],
  conversationId?: string | null,
  options: AskStreamOptions = {},
): Promise<AIAskResponse> {
  const url = `${apiUrl}/api/v1/ai/operations/ask?stream=true`;
  const body = JSON.stringify(buildAIAskRequest(question, history, conversationId));
  let response: Awaited<ReturnType<typeof expoFetch>>;
  try {
    response = await expoFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', ...(await authHeaders()) },
      body,
      signal: options.signal,
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    return askOperationsAI(question, history, conversationId);
  }
  if (!response.ok) {
    const raw = await response.text().catch(() => '');
    let message = `Request failed (${response.status})`;
    try {
      const parsed = JSON.parse(raw) as { error?: string };
      if (parsed?.error) message = parsed.error;
    } catch {
      // Not JSON: the status is all there is.
    }
    throw new ApiError(message, response.status, url, raw);
  }
  const contentType = response.headers.get('content-type') ?? '';
  if (!response.body || !contentType.includes('text/event-stream')) {
    return (await response.json()) as AIAskResponse;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let rest = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    rest += decoder.decode(value, { stream: true });
    const parsed = parseSSE(rest);
    rest = parsed.rest;
    for (const event of parsed.events) {
      if (event.event === 'draft') {
        try {
          const text = (JSON.parse(event.data) as { text?: unknown }).text;
          if (typeof text === 'string') options.onDraft?.(text);
        } catch {
          // A draft that did not parse is only a draft; the answer still comes.
        }
      } else if (event.event === 'answer') {
        return JSON.parse(event.data) as AIAskResponse;
      } else if (event.event === 'error') {
        const parsedBody = JSON.parse(event.data) as { status?: number; error?: string };
        const status = typeof parsedBody.status === 'number' ? parsedBody.status : 500;
        throw new ApiError(parsedBody.error || `Request failed (${status})`, status, url, event.data);
      }
    }
  }
  throw new Error('AI stream ended without an answer');
}

// The chat list. Deleting moves a chat to the trash, where it can be restored
// for seven days from the web's settings screen.
const conversationPath = (conversationId: string) => buildAIConversationDeletePath(conversationId);

export const listAIConversations = (limit = 0) => apiRequest<{ conversations: AIConversationSummary[] }>(
  `/api/v1/ai/operations/conversations${limit > 0 ? `?limit=${limit}` : ''}`,
);

/** The trash: chats deleted in the last seven days, newest first. */
export const listTrashedAIConversations = () => apiRequest<{ conversations: AIConversationSummary[] }>(
  '/api/v1/ai/operations/conversations?trashed=1',
);

export const restoreAIConversation = (conversationId: string) => apiRequest<void>(
  `${conversationPath(conversationId)}/restore`,
  { method: 'POST' },
);

/** Delete one chat for good — from the trash only. */
export const purgeAIConversation = (conversationId: string) => apiRequest<void>(
  `${conversationPath(conversationId)}/permanent`,
  { method: 'DELETE' },
);

export const purgeAllTrashedAIConversations = () => apiRequest<{ deleted: number }>(
  '/api/v1/ai/operations/conversations/purge',
  { method: 'POST' },
);

export const getAIConversationTurns = (conversationId: string) => apiRequest<{ turns: AIConversationTurn[] }>(
  `${conversationPath(conversationId)}/turns`,
);

export const renameAIConversation = (conversationId: string, title: string) => apiRequest<void>(
  conversationPath(conversationId),
  { method: 'PATCH', body: JSON.stringify({ title }) },
);

export const deleteAIConversation = (conversationId: string) => apiRequest<void>(
  conversationPath(conversationId),
  { method: 'DELETE' },
);

export const confirmAIAction = (previewId: string, confirmationToken: string) => (
  apiRequest<AIActionConfirmation>(buildAIActionConfirmationPath(previewId), {
    method: 'POST',
    body: JSON.stringify(buildAIActionConfirmationRequest(confirmationToken)),
  })
);

export const cancelAIAction = (previewId: string) => apiRequest<void>(
  buildAIActionCancellationPath(previewId),
  { method: 'DELETE' },
);

export const confirmAIActionPlan = (planId: string, confirmationToken: string) => (
  apiRequest<AIActionPlanConfirmation>(`/api/v1/ai/operations/plans/${encodeURIComponent(planId)}/confirm`, {
    method: 'POST',
    body: JSON.stringify({ confirmation_token: confirmationToken }),
  })
);

export const cancelAIActionPlan = (planId: string) => apiRequest<void>(
  `/api/v1/ai/operations/plans/${encodeURIComponent(planId)}`,
  { method: 'DELETE' },
);

export const getOperationsSnapshot = () => apiRequest<AISnapshot>('/api/v1/ai/operations/snapshot');

export const getProactiveInsights = () => apiRequest<{ insights: AIInsight[] }>('/api/v1/ai/operations/insights');

export const getAISettings = () => apiRequest<AISettingsView>('/api/v1/ai/operations/settings');

export const updateAISettings = (patch: AISettingsPatch) => apiRequest<AISettingsView>(
  '/api/v1/ai/operations/settings',
  { method: 'PUT', body: JSON.stringify(patch) },
);

export const extractReceipt = (imageBase64: string, mimeType: string) => apiRequest<{ draft: AIReceiptDraft }>(
  '/api/v1/ai/operations/receipt',
  { method: 'POST', body: JSON.stringify({ image: imageBase64, mime_type: mimeType }) },
);

