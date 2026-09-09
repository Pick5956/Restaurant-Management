// Shared, session-scoped chat persistence for the AI assistant. Both the
// floating widget and the full /ai-assistant page use the same key + envelope
// so their history stays in sync. History and the server conversation ID are
// keyed per (restaurant, user) and expire together after seven days.

const CHAT_KEY_PREFIX = "restaurant_ai_chat";
const SERVER_CONVERSATION_KEY_SUFFIX = ":server-conversation";
const CHAT_HISTORY_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

type ChatEnvelope<T> = { savedAt?: number; messages?: T[] };
type ConversationEnvelope = { savedAt?: number; conversationId?: string };
type ChatClearListener = (key: string) => void;

export type ChatWriteSource = symbol;
export type ChatStorageWrite =
  | { key: string; kind: "messages"; messages: unknown[] }
  | { key: string; kind: "conversation"; conversationId: string };

type ChatWriteSubscription = {
  key: string;
  source: ChatWriteSource;
  listener: (write: ChatStorageWrite) => void;
};

const chatClearListeners = new Set<ChatClearListener>();
const chatWriteSubscriptions = new Set<ChatWriteSubscription>();
const messageFingerprints = new Map<string, string>();
const conversationFingerprints = new Map<string, string>();

function sanitizeStoredAction(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const action = value as Record<string, unknown>;
  if (typeof action.id !== "string" || !action.id.trim()) return null;
  if (typeof action.label !== "string" || !action.label.trim()) return null;
  for (const key of ["href", "prompt", "description"] as const) {
    if (action[key] !== undefined && typeof action[key] !== "string") return null;
  }
  if (
    action.requiresConfirmation !== undefined
    && typeof action.requiresConfirmation !== "boolean"
  ) return null;
  return { ...action };
}

function sanitizeStoredMessages<T>(value: unknown): T[] {
  if (!Array.isArray(value)) return [];
  const messages: T[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const message = item as Record<string, unknown>;
    if (typeof message.id !== "string" || !message.id.trim()) continue;
    if (!(["user", "assistant", "system"] as unknown[]).includes(message.role)) continue;
    if (typeof message.content !== "string" || message.content.length > 100_000) continue;

    const sanitized: Record<string, unknown> = { ...message };
    if (sanitized.createdAt !== undefined && typeof sanitized.createdAt !== "string") {
      delete sanitized.createdAt;
    }
    if (sanitized.model !== undefined && typeof sanitized.model !== "string") {
      delete sanitized.model;
    }
    if (sanitized.actions !== undefined) {
      const actions = Array.isArray(sanitized.actions)
        ? sanitized.actions.map(sanitizeStoredAction).filter(Boolean)
        : [];
      if (actions.length > 0) sanitized.actions = actions;
      else delete sanitized.actions;
    }
    messages.push(sanitized as T);
  }
  return messages;
}

function serverConversationStorageKey(key: string): string {
  return `${key}${SERVER_CONVERSATION_KEY_SUFFIX}`;
}

function validConversationId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

export function chatStorageKey(restaurantId?: number | null, userId?: number | null): string | null {
  if (restaurantId == null || userId == null) return null;
  return `${CHAT_KEY_PREFIX}:${restaurantId}:${userId}`;
}

// Load the stored message array if it exists and is still fresh; otherwise remove
// the expired entry and return null. Returns raw messages for the caller to hydrate.
export function loadStoredMessages<T = unknown>(key: string | null, maxAgeMs: number = CHAT_HISTORY_TTL_MS): T[] | null {
  if (typeof window === "undefined" || !key) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as ChatEnvelope<T>;
    if (!entry.savedAt || Date.now() - entry.savedAt > maxAgeMs) {
      localStorage.removeItem(key);
      return null;
    }
    const messages = sanitizeStoredMessages<T>(entry.messages);
    return messages.length > 0 ? messages : null;
  } catch {
    return null;
  }
}

// Persist the messages with a timestamp. A lone welcome message is not persisted.
export function saveMessages(
  key: string | null,
  messages: unknown[],
  source?: ChatWriteSource,
): void {
  if (typeof window === "undefined" || !key || messages.length === 0) return;
  const lone = messages.length === 1 ? (messages[0] as { id?: string }) : null;
  if (lone && lone.id === "welcome") return;
  let fingerprint: string;
  try {
    fingerprint = JSON.stringify(messages);
  } catch {
    return;
  }
  const previousFingerprint = messageFingerprints.get(key);
  let unchangedInStorage = false;
  let storageReadFailed = false;
  let storageWriteFailed = false;
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      try {
        const current = JSON.parse(raw) as ChatEnvelope<unknown>;
        const isFresh = Boolean(current.savedAt) && Date.now() - Number(current.savedAt) <= CHAT_HISTORY_TTL_MS;
        unchangedInStorage = isFresh && JSON.stringify(current.messages) === fingerprint;
      } catch {
        // A corrupt envelope should be repaired by the write below.
      }
    }
  } catch {
    storageReadFailed = true;
    // storage may be unavailable (private mode) — ignore
  }
  try {
    localStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), messages }));
  } catch {
    storageWriteFailed = true;
    // Keep same-window synchronization available when persistence is blocked.
  }
  const unchanged = unchangedInStorage
    || ((storageReadFailed || storageWriteFailed) && previousFingerprint === fingerprint);
  messageFingerprints.set(key, fingerprint);
  if (unchanged) return;
  notifyChatWrite({ key, kind: "messages", messages }, source);
}

export function loadStoredConversationId(key: string | null): string | null {
  if (typeof window === "undefined" || !key) return null;
  const conversationKey = serverConversationStorageKey(key);
  try {
    const raw = localStorage.getItem(conversationKey);
    if (!raw) return null;
    const entry = JSON.parse(raw) as ConversationEnvelope;
    if (
      !entry.savedAt
      || Date.now() - entry.savedAt > CHAT_HISTORY_TTL_MS
      || !validConversationId(entry.conversationId)
    ) {
      try {
        localStorage.removeItem(conversationKey);
      } catch {
        // ignore storage implementations that allow reads but reject writes
      }
      return null;
    }
    return entry.conversationId;
  } catch {
    try {
      localStorage.removeItem(conversationKey);
    } catch {
      // ignore storage implementations that are completely unavailable
    }
    return null;
  }
}

export function saveConversationId(
  key: string | null,
  conversationId: string | null | undefined,
  source?: ChatWriteSource,
): void {
  if (typeof window === "undefined" || !key || !validConversationId(conversationId)) return;
  const previousFingerprint = conversationFingerprints.get(key);
  let unchangedInStorage = false;
  let storageReadFailed = false;
  let storageWriteFailed = false;
  try {
    const raw = localStorage.getItem(serverConversationStorageKey(key));
    if (raw) {
      try {
        const current = JSON.parse(raw) as ConversationEnvelope;
        const isFresh = Boolean(current.savedAt) && Date.now() - Number(current.savedAt) <= CHAT_HISTORY_TTL_MS;
        unchangedInStorage = isFresh && current.conversationId === conversationId;
      } catch {
        // A corrupt envelope should be repaired by the write below.
      }
    }
  } catch {
    storageReadFailed = true;
    // Reads can be unavailable even while the same-window channel still works.
  }
  try {
    localStorage.setItem(
      serverConversationStorageKey(key),
      JSON.stringify({ savedAt: Date.now(), conversationId }),
    );
  } catch {
    storageWriteFailed = true;
    // Keep same-window synchronization available when persistence is blocked.
  }
  const unchanged = unchangedInStorage
    || ((storageReadFailed || storageWriteFailed) && previousFingerprint === conversationId);
  conversationFingerprints.set(key, conversationId);
  if (unchanged) return;
  notifyChatWrite({ key, kind: "conversation", conversationId }, source);
}

function notifyChatWrite(write: ChatStorageWrite, source?: ChatWriteSource): void {
  chatWriteSubscriptions.forEach((subscription) => {
    if (subscription.key === write.key && subscription.source !== source) {
      subscription.listener(write);
    }
  });
}

// localStorage's storage event is cross-document only. This in-memory channel
// keeps the full page and floating assistant synchronized in the same window.
export function subscribeToChatWrites(
  key: string | null,
  source: ChatWriteSource,
  listener: (write: ChatStorageWrite) => void,
): () => void {
  if (!key) return () => undefined;
  const subscription = { key, source, listener };
  chatWriteSubscriptions.add(subscription);
  return () => chatWriteSubscriptions.delete(subscription);
}

export function clearStoredChat(key: string | null): void {
  if (!key) return;
  messageFingerprints.delete(key);
  conversationFingerprints.delete(key);
  if (typeof window !== "undefined") {
    try {
      localStorage.removeItem(key);
      // Clearing history must also drop the server conversation ID, otherwise
      // the next question resumes the old thread the user just cleared.
      localStorage.removeItem(serverConversationStorageKey(key));
    } catch {
      // ignore
    }
  }
  // Listeners live in memory, so notify them even where storage is unavailable.
  chatClearListeners.forEach((listener) => listener(key));
}

// localStorage's storage event does not fire in the same browser window. Both
// chat surfaces are mounted together, so use a small same-window notification
// to invalidate in-flight work and reset their independent React state.
export function subscribeToChatClear(listener: ChatClearListener): () => void {
  chatClearListeners.add(listener);
  return () => chatClearListeners.delete(listener);
}

// Remove the legacy unscoped key and any expired chats from other users/sessions
// on this device (privacy hygiene on shared POS terminals).
export function purgeStaleChats(currentKey: string | null): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(CHAT_KEY_PREFIX);
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(`${CHAT_KEY_PREFIX}:`) || k === currentKey) continue;
      try {
        const other = JSON.parse(localStorage.getItem(k) || "null") as { savedAt?: number } | null;
        if (!other?.savedAt || Date.now() - other.savedAt > CHAT_HISTORY_TTL_MS) {
          localStorage.removeItem(k);
        }
      } catch {
        localStorage.removeItem(k);
      }
    }
  } catch {
    // ignore
  }
}
