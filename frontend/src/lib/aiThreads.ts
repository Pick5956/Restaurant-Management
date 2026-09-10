"use client";

import { useSyncExternalStore } from "react";
import { clearStoredChat, loadStoredMessages, saveMessages, type ChatWriteSource } from "./aiChatStorage";
import { getAnswerChips, type AIGuidedAction } from "./aiGuidedActions";
import type { AIChartData, AIConversationTurn, AIForecastResult, AINavigation, AISystemDocSource } from "../types/ai";
import type { Membership } from "../types/restaurant";

// Many chats per owner.
//
// aiChatStorage keeps ONE cached thread under one key, which was the whole
// model: one restaurant, one owner, one conversation. The chat list changes
// that to many conversations and one "active" — the chat both surfaces (the AI
// page and the floating chat) are showing right now. This module is the thin
// layer on top: which chat is active, and a small cache of recent transcripts
// keyed by conversation so switching back is instant while the server copy
// loads. The server owns the history; everything here is a convenience that
// the page renders correctly without.

const ACTIVE_SUFFIX = ":active";
const THREAD_INFIX = ":t:";
const LEGACY_CONVERSATION_SUFFIX = ":server-conversation";
const CHANGE_EVENT = "ai-thread-change";
const CONVERSATIONS_EVENT = "ai-conversations-change";
const THREAD_CACHE_LIMIT = 5;
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const NEW_THREAD = "new";

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function validConversationId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

/** The localStorage key holding a chat's cached transcript. */
export function threadKey(baseKey: string | null, conversationId: string | null): string | null {
  if (!baseKey) return null;
  return `${baseKey}${THREAD_INFIX}${conversationId && validConversationId(conversationId) ? conversationId : NEW_THREAD}`;
}

function activeKey(baseKey: string): string {
  return `${baseKey}${ACTIVE_SUFFIX}`;
}

function announce() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** The conversation both surfaces are showing, or null for a chat not yet sent. */
export function loadActiveThread(baseKey: string | null): string | null {
  const store = storage();
  if (!store || !baseKey) return null;
  try {
    const raw = store.getItem(activeKey(baseKey));
    if (!raw) return null;
    const entry = JSON.parse(raw) as { conversationId?: unknown };
    return validConversationId(entry.conversationId) ? entry.conversationId : null;
  } catch {
    return null;
  }
}

/** Make a chat the active one on this device; null means "a new, unsent chat". */
export function setActiveThread(baseKey: string | null, conversationId: string | null): void {
  const store = storage();
  if (!baseKey) return;
  try {
    if (store) {
      if (conversationId && validConversationId(conversationId)) {
        store.setItem(activeKey(baseKey), JSON.stringify({ savedAt: Date.now(), conversationId }));
      } else {
        store.removeItem(activeKey(baseKey));
      }
    }
  } catch {
    // Storage unavailable: the page keeps its in-memory choice.
  }
  announce();
}

function subscribe(onChange: () => void) {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(CHANGE_EVENT, onChange);
  // Another tab switching chats reaches this one through the native storage
  // event, which fires only across tabs — the custom event covers this tab.
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** React to the active chat changing — from this tab or another. */
export function useActiveThread(baseKey: string | null): string | null {
  return useSyncExternalStore(
    subscribe,
    () => loadActiveThread(baseKey),
    () => null,
  );
}

/**
 * How long a chat that has no server id yet is worth restoring.
 *
 * The unsent slot exists for one reason: a reload while a question is in flight
 * should not lose what is on screen. A leftover older than that is not a draft
 * any more, it is debris — and because every new chat opens on this one slot,
 * debris here is what the owner sees instead of a clean page. Seven days (the
 * TTL a real chat gets) is far too long for that; half an hour covers the reload
 * it was built for.
 */
const UNSENT_THREAD_TTL_MS = 30 * 60 * 1000;

/** Cached transcript of one chat, if this device has seen it recently. */
export function loadThreadCache<T = unknown>(baseKey: string | null, conversationId: string | null): T[] | null {
  const unsent = !conversationId || !validConversationId(conversationId);
  return loadStoredMessages<T>(threadKey(baseKey, conversationId), unsent ? UNSENT_THREAD_TTL_MS : undefined);
}

/** Cache a chat's transcript and drop the oldest caches beyond the limit. */
export function saveThreadCache(baseKey: string | null, conversationId: string | null, messages: unknown[], source?: ChatWriteSource): void {
  const key = threadKey(baseKey, conversationId);
  if (!key) return;
  saveMessages(key, messages, source);
  if (baseKey) pruneThreadCaches(baseKey);
}

/**
 * Hand a chat that has just been given a server id its cache, and empty the
 * slot it was living in before.
 *
 * A chat with no id yet caches under one shared "unsent" slot, so a reload
 * mid-question does not lose what is on screen. The moment the server answers,
 * the transcript belongs to a real conversation and that slot has to be let go:
 * it is the same slot every future new chat opens on, and a copy left behind is
 * what the next one paints instead of a clean page — the owner presses "new
 * chat" and gets an old half-finished exchange, questions with no answers under
 * them, because the leftover was written before the first answer arrived.
 *
 * The two writes live in one function so no caller can do the first and forget
 * the second.
 */
export function adoptUnsentThread(
  baseKey: string | null,
  conversationId: string,
  messages: unknown[],
  source?: ChatWriteSource,
): void {
  saveThreadCache(baseKey, conversationId, messages, source);
  clearThreadCache(baseKey, null);
}

export function clearThreadCache(baseKey: string | null, conversationId: string | null): void {
  clearStoredChat(threadKey(baseKey, conversationId));
}

/** Keep only the newest THREAD_CACHE_LIMIT transcripts; the server has the rest. */
export function pruneThreadCaches(baseKey: string, keep: number = THREAD_CACHE_LIMIT): void {
  const store = storage();
  if (!store) return;
  try {
    const prefix = `${baseKey}${THREAD_INFIX}`;
    const entries: { key: string; savedAt: number }[] = [];
    for (let i = store.length - 1; i >= 0; i -= 1) {
      const k = store.key(i);
      if (!k || !k.startsWith(prefix)) continue;
      // An unsent chat's cache is not a transcript and never counts.
      if (k === `${prefix}${NEW_THREAD}`) continue;
      try {
        const entry = JSON.parse(store.getItem(k) || "null") as { savedAt?: number } | null;
        const savedAt = Number(entry?.savedAt) || 0;
        if (!savedAt || Date.now() - savedAt > CACHE_TTL_MS) {
          store.removeItem(k);
          continue;
        }
        entries.push({ key: k, savedAt });
      } catch {
        store.removeItem(k);
      }
    }
    entries.sort((a, b) => b.savedAt - a.savedAt);
    for (const stale of entries.slice(keep)) store.removeItem(stale.key);
  } catch {
    // Nothing to prune without storage.
  }
}

/**
 * Move a pre-list installation forward once. The old single thread lived at
 * the base key with its server id beside it; it becomes the cache of that
 * conversation and the active chat, so the owner opens the app on the chat
 * they were in. Old keys are removed; a second call finds nothing to do.
 */
export function migrateLegacyThread(baseKey: string | null): string | null {
  const store = storage();
  if (!store || !baseKey) return null;
  try {
    const legacyIdRaw = store.getItem(`${baseKey}${LEGACY_CONVERSATION_SUFFIX}`);
    const legacyMessagesRaw = store.getItem(baseKey);
    if (!legacyIdRaw && !legacyMessagesRaw) return null;
    let conversationId: string | null = null;
    try {
      const entry = JSON.parse(legacyIdRaw || "null") as { conversationId?: unknown } | null;
      if (validConversationId(entry?.conversationId)) conversationId = entry!.conversationId as string;
    } catch {
      conversationId = null;
    }
    if (conversationId && legacyMessagesRaw) {
      // Same envelope shape; only the key changes.
      store.setItem(threadKey(baseKey, conversationId)!, legacyMessagesRaw);
    }
    store.removeItem(baseKey);
    store.removeItem(`${baseKey}${LEGACY_CONVERSATION_SUFFIX}`);
    if (conversationId && !loadActiveThread(baseKey)) setActiveThread(baseKey, conversationId);
    return conversationId;
  } catch {
    return null;
  }
}

// The list's refresh signal. Any surface that changes what the list shows —
// an answer that created or reordered a chat, a rename, a delete — announces
// it, and every mounted list reloads once. A counter is the store so React
// sees a new snapshot each time.
let conversationsVersion = 0;

export function notifyConversationsChanged(): void {
  conversationsVersion += 1;
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CONVERSATIONS_EVENT));
}

function subscribeConversations(onChange: () => void) {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(CONVERSATIONS_EVENT, onChange);
  return () => window.removeEventListener(CONVERSATIONS_EVENT, onChange);
}

/** Bumps whenever the chat list should be read again. */
export function useConversationsVersion(): number {
  return useSyncExternalStore(subscribeConversations, () => conversationsVersion, () => 0);
}

/** Display data a stored turn carries, as the server wrote it. */
export type AITurnDisplay = {
  chart?: AIChartData;
  forecast?: AIForecastResult;
  tools_used?: string[];
  scope_assumed?: boolean;
  doc_sources?: AISystemDocSource[];
  action_plan_id?: string;
  model?: string;
  follow_ups?: string[];
  navigate?: AINavigation;
};

/** One exchange of a reopened chat, in the shape both chat surfaces render. */
export type AIThreadMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: Date;
  model?: string;
  forecast?: AIForecastResult;
  chart?: AIChartData;
  tool?: string;
  toolsUsed?: string[];
  scopeAssumed?: boolean;
  docSources?: AISystemDocSource[];
  planId?: string;
  followUps?: string[];
  navigate?: AINavigation;
};

/**
 * Turns from the server become the messages the screen renders: a question
 * bubble and an answer bubble per turn, the answer carrying whatever display
 * data was stored with it, including the follow-ups the model wrote for it.
 */
export function turnsToMessages(turns: AIConversationTurn[]): AIThreadMessage[] {
  const messages: AIThreadMessage[] = [];
  for (const turn of turns) {
    const at = turn.created_at ? new Date(turn.created_at) : new Date();
    const display = (turn.display ?? {}) as AITurnDisplay;
    messages.push({ id: `${turn.id}-q`, role: "user", content: turn.question, createdAt: at });
    messages.push({
      id: turn.id,
      role: "assistant",
      content: turn.answer,
      createdAt: at,
      model: display.model,
      forecast: display.forecast,
      chart: display.chart,
      tool: turn.tool || undefined,
      toolsUsed: display.tools_used,
      scopeAssumed: display.scope_assumed,
      docSources: display.doc_sources,
      planId: display.action_plan_id,
      followUps: display.follow_ups,
      navigate: display.navigate,
    });
  }
  return messages;
}

/**
 * A reopened chat, ready to render: the bubbles from the server plus the
 * follow-up chips under each answer — the model's own, stored with the turn,
 * or the tool-derived fallback for a turn from before they were written.
 */
export function hydrateThreadMessages(
  turns: AIConversationTurn[],
  membership: Membership | null | undefined,
  language: "th" | "en",
): (AIThreadMessage & { actions?: AIGuidedAction[] })[] {
  const messages = turnsToMessages(turns);
  const out: (AIThreadMessage & { actions?: AIGuidedAction[] })[] = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.role !== "assistant") {
      out.push(message);
      continue;
    }
    const question = index > 0 ? messages[index - 1].content : "";
    const tools = message.toolsUsed && message.toolsUsed.length > 0 ? message.toolsUsed : message.tool;
    // Only what the writer actually put on this turn: an answer that came with
    // none had none for a reason, and inventing them on reopen would give an old
    // chat chips it never showed the first time.
    const wrote = (message.followUps && message.followUps.length > 0) || Boolean(message.navigate);
    const actions = wrote
      ? getAnswerChips(question, message.content, membership, language, tools, message.scopeAssumed, message.followUps, message.navigate)
      : [];
    out.push(actions.length > 0 ? { ...message, actions } : message);
  }
  return out;
}

/** True when the server said the conversation the screen holds no longer exists. */
export function isConversationGone(err: unknown): boolean {
  if (typeof err !== "object" || err === null || !("response" in err)) return false;
  const response = (err as { response?: { data?: { code?: string } } }).response;
  return response?.data?.code === "conversation_gone";
}

/** Group chats for the list the way a chat app does: today, yesterday, this week, older. */
export type AIThreadGroup = "today" | "yesterday" | "week" | "older";

export function threadGroup(updatedAt: string | Date, now: Date = new Date()): AIThreadGroup {
  const at = updatedAt instanceof Date ? updatedAt : new Date(updatedAt);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = 24 * 60 * 60 * 1000;
  const t = at.getTime();
  if (t >= startOfToday) return "today";
  if (t >= startOfToday - day) return "yesterday";
  if (t >= startOfToday - 6 * day) return "week";
  return "older";
}

/** Client-side title filter: the list shrinks as the owner types. */
export function matchesThreadQuery(title: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return title.toLowerCase().includes(q);
}
