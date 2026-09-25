import { authRepository } from "../app/repositories/authRepository";
import { restaurantRepository } from "../app/repositories/restaurantRepository";
import { apiUrl } from "./apiClient";
import { askOperationsAI } from "./ai";
import type { AIAskRequest, AIAskResponse, AIConversationMessage } from "../types/ai";

// Asking the assistant over a stream.
//
// The plain call returns the answer when it is finished. This one opens
// `?stream=true` and reads server-sent events instead: `draft` events carry the
// answer so far while the model writes, `answer` carries the finished response
// (the same shape the plain call returns), and `error` carries what the plain
// call would have failed with. The caller shows the drafts and then treats the
// result exactly as it would the plain call's — including errors, which are
// thrown in the same `{ response: { status, data } }` shape axios uses, so the
// outage notice and the gone-conversation check keep working unchanged.
//
// If the stream cannot be opened at all (no fetch body, an old server that
// answers with JSON, a network failure before the first byte) it falls back to
// the plain call, so streaming can never make a question fail that would have
// succeeded.

export type SSEEvent = { event: string; data: string };

/**
 * Splits what has arrived so far into complete events and the unfinished
 * tail. Understands the wire format gin writes ("event:name\ndata:payload")
 * with or without a space after the colon, multi-line data, and comments.
 */
export function parseSSE(buffer: string): { events: SSEEvent[]; rest: string } {
  const events: SSEEvent[] = [];
  let rest = buffer.replace(/\r\n/g, "\n");
  let at: number;
  while ((at = rest.indexOf("\n\n")) >= 0) {
    const block = rest.slice(0, at);
    rest = rest.slice(at + 2);
    let event = "message";
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith(":")) continue;
      const colon = line.indexOf(":");
      const field = colon < 0 ? line : line.slice(0, colon);
      let value = colon < 0 ? "" : line.slice(colon + 1);
      if (value.startsWith(" ")) value = value.slice(1);
      if (field === "event") event = value;
      else if (field === "data") data.push(value);
    }
    if (data.length > 0) events.push({ event, data: data.join("\n") });
  }
  return { events, rest };
}

type StreamHttpError = Error & { response: { status: number; data: unknown } };

function streamHttpError(status: number, data: unknown): StreamHttpError {
  const message =
    typeof data === "object" && data !== null && "error" in data && typeof (data as { error?: unknown }).error === "string"
      ? (data as { error: string }).error
      : `AI request failed (${status})`;
  const error = new Error(message) as StreamHttpError;
  error.response = { status, data };
  return error;
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const token = authRepository.getToken();
  const tokenType = authRepository.getTokenType();
  if (token && tokenType) headers.Authorization = `${tokenType} ${token}`;
  const restaurantId = restaurantRepository.getActiveId();
  if (restaurantId) headers["X-Restaurant-ID"] = String(restaurantId);
  return headers;
}

export type AskStreamOptions = {
  /** The answer so far, cleaned; called each time more of it arrives. */
  onDraft?: (text: string) => void;
  signal?: AbortSignal;
};

export async function askOperationsAIStream(
  question: string,
  history: AIConversationMessage[] = [],
  conversationId?: string | null,
  options: AskStreamOptions = {},
): Promise<{ data: AIAskResponse }> {
  const request: AIAskRequest = { question, history, ingredient_card: true };
  const normalizedConversationId = conversationId?.trim();
  if (normalizedConversationId) request.conversation_id = normalizedConversationId;

  let response: Response;
  try {
    response = await fetch(`${apiUrl}/api/v1/ai/operations/ask?stream=true`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream", ...authHeaders() },
      body: JSON.stringify(request),
      signal: options.signal,
    });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    // Could not even open the stream: the plain call answers the way it always has.
    return askOperationsAI(question, history, conversationId);
  }
  if (!response.ok) {
    let data: unknown = null;
    try {
      data = await response.json();
    } catch {
      // No body, or not JSON: the status is all there is.
    }
    throw streamHttpError(response.status, data);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!response.body || !contentType.includes("text/event-stream")) {
    // A server that answered with plain JSON: use it as such.
    return { data: (await response.json()) as AIAskResponse };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let rest = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    rest += decoder.decode(value, { stream: true });
    const parsed = parseSSE(rest);
    rest = parsed.rest;
    for (const event of parsed.events) {
      if (event.event === "draft") {
        try {
          const text = (JSON.parse(event.data) as { text?: unknown }).text;
          if (typeof text === "string") options.onDraft?.(text);
        } catch {
          // A draft that did not parse is only a draft; the answer still comes.
        }
      } else if (event.event === "answer") {
        return { data: JSON.parse(event.data) as AIAskResponse };
      } else if (event.event === "error") {
        const body = JSON.parse(event.data) as { status?: number } & Record<string, unknown>;
        throw streamHttpError(typeof body.status === "number" ? body.status : 500, body);
      }
    }
  }
  throw new Error("AI stream ended without an answer");
}
