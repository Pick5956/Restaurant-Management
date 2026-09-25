import type { AIActionPlan } from "@/src/types/ai";

// A write plan waiting for the owner's confirmation, kept across a page switch.
//
// The plan lived only in component state, so leaving /ai-assistant and coming
// back unmounted the confirmation card and there was no way to press either
// button. The server did not forget: it holds one pending plan at a time, so
// the next command came back with "confirm or cancel the one above" pointing at
// a card that was no longer on screen, and the only way out was to wait a
// minute for it to expire.
//
// Storage is sessionStorage, not localStorage, and it is keyed with the same
// (restaurant, user) key the chat history uses. A plan is worth at most one
// minute, belongs to the tab the owner is looking at, and must never reappear
// for a different account.

const PLAN_KEY_SUFFIX = ":pending-plan";

/**
 * How the card is standing. "pending" is still waiting for a button; the rest
 * are records of what happened, kept so the card does not vanish from the
 * thread the moment it is answered.
 */
export type StoredPlanState = "pending" | "done" | "cancelled" | "expired";

const PLAN_STATES: StoredPlanState[] = ["pending", "done", "cancelled", "expired"];

export type StoredPlan = { plan: AIActionPlan; state: StoredPlanState };

type PlanEnvelope = { plan?: unknown; state?: unknown };

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    // Private windows and blocked site data throw on access, not on read.
    return null;
  }
}

function planKey(chatKey: string): string {
  return `${chatKey}${PLAN_KEY_SUFFIX}`;
}

/**
 * planWorthKeeping reports whether a card is worth putting back on screen.
 *
 * A plan still waiting for an answer only counts while the server would still
 * accept one: past the expiry it is gone there, so restoring it would offer two
 * buttons that both fail. A plan already confirmed or cancelled is a record of
 * what happened and stays regardless of the clock — that is the whole point of
 * keeping it. Either way there has to be something in it to show.
 */
export function planWorthKeeping(stored: StoredPlan, now: number = Date.now()): boolean {
  const { plan, state } = stored;
  if (!plan.items || plan.items.length === 0) return false;
  if (state !== "pending") return true;
  const expiry = Date.parse(plan.expires_at);
  if (Number.isNaN(expiry)) return false;
  return expiry > now;
}

function sanitizePlan(value: unknown): AIActionPlan | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  for (const field of ["id", "status", "expires_at", "confirmation_token", "summary"] as const) {
    if (typeof raw[field] !== "string" || !(raw[field] as string).trim()) return null;
  }
  if (!Array.isArray(raw.items)) return null;

  const items = [];
  for (const entry of raw.items) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const item = entry as Record<string, unknown>;
    if (typeof item.title !== "string" || typeof item.change !== "string") return null;
    if (item.unit !== undefined && typeof item.unit !== "string") return null;
    const sideEffects = item.side_effects;
    if (sideEffects !== undefined && !(Array.isArray(sideEffects) && sideEffects.every((s) => typeof s === "string"))) {
      return null;
    }
    items.push({ ...item } as AIActionPlan["items"][number]);
  }

  const warnings = raw.warnings;
  if (warnings !== undefined && !(Array.isArray(warnings) && warnings.every((w) => typeof w === "string"))) {
    return null;
  }

  return { ...(raw as unknown as AIActionPlan), items };
}

/** savePendingPlan keeps the card; a stale unanswered one is dropped instead. */
export function savePendingPlan(
  chatKey: string | null,
  plan: AIActionPlan | null,
  state: StoredPlanState = "pending",
): void {
  if (!chatKey) return;
  const store = storage();
  if (!store) return;
  try {
    if (!plan || !planWorthKeeping({ plan, state })) {
      store.removeItem(planKey(chatKey));
      return;
    }
    // A card that has been answered keeps its rows but not its token: the token
    // is spent, and there is no reason to leave a one-time confirmation string
    // sitting in storage after the thing it confirms is over.
    const kept = state === "pending" ? plan : { ...plan, confirmation_token: "-" };
    const envelope: PlanEnvelope = { plan: kept, state };
    store.setItem(planKey(chatKey), JSON.stringify(envelope));
  } catch {
    // A full or unavailable store costs the owner one card, not the session.
  }
}

/** loadPendingPlan returns the stored card, with the state to reopen it in. */
export function loadPendingPlan(chatKey: string | null): StoredPlan | null {
  if (!chatKey) return null;
  const store = storage();
  if (!store) return null;
  let raw: string | null = null;
  try {
    raw = store.getItem(planKey(chatKey));
  } catch {
    return null;
  }
  if (!raw) return null;

  let stored: StoredPlan | null = null;
  try {
    const envelope = JSON.parse(raw) as PlanEnvelope;
    const plan = sanitizePlan(envelope?.plan);
    const state = PLAN_STATES.includes(envelope?.state as StoredPlanState)
      ? (envelope.state as StoredPlanState)
      : "pending";
    stored = plan ? { plan, state } : null;
  } catch {
    stored = null;
  }
  if (!stored || !planWorthKeeping(stored)) {
    clearPendingPlan(chatKey);
    return null;
  }
  return stored;
}

/** clearPendingPlan forgets the plan once it is confirmed, cancelled or stale. */
export function clearPendingPlan(chatKey: string | null): void {
  if (!chatKey) return;
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(planKey(chatKey));
  } catch {
    // Nothing to do: the plan expires on its own within the minute.
  }
}

/**
 * questionBehindPlan finds the owner's sentence that produced a plan: the
 * last user message before the answer that carries the plan's id.
 *
 * "ขอคำสั่งใหม่" puts that sentence back in the input. It used to come only
 * from memory, so after a reload the button did nothing (found 25 ก.ย. 2569)
 * — the thread survives a reload, and the sentence is in it.
 */
export function questionBehindPlan(
  messages: { role: string; content: string; planId?: string }[],
  planId: string | null | undefined,
): string {
  if (!planId) return "";
  const answerAt = messages.findIndex((message) => message.planId === planId);
  for (let index = answerAt - 1; index >= 0; index -= 1) {
    if (messages[index].role === "user") return messages[index].content.trim();
  }
  return "";
}
