"use client";

import React, { useCallback, useMemo, useState, useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowUp,
  X,
  SquarePen,
  MessageSquareText,
  ChevronDown,
  Maximize2,
  Minimize2
} from "lucide-react";
import AIFollowUpList from "@/src/components/shared/AIFollowUpList";
import { useFollowUpsEnabled, useWelcome } from "@/src/lib/aiPrefs";
import SiriOrb from "@/src/components/ui/siri-orb";
import ForecastChart from "@/src/components/shared/ForecastChart";
import AIChart from "@/src/components/shared/AIChart";
import { ORB_DEFAULT_PALETTE, orbPaletteForSurface, parseCssRgb, type OrbPalette } from "@/src/lib/orbPalette";

// The draggable orb: its size (h-14), how far a press may travel and still be
// a tap, and where its resting place is remembered on this device.
const ORB_SIZE = 56;
const ORB_DRAG_THRESHOLD = 6;
const ORB_SPOT_KEY = "ai_orb_spot";
type OrbSpot = { side: "left" | "right"; top: number };
import AIInputTools from "@/src/components/shared/AIInputTools";
import { askOperationsAIStream } from "@/src/lib/aiStream";
import { cancelAIAction, cancelAIActionPlan, confirmAIAction, confirmAIActionPlan, getAIConversationTurns, normalizeAIAnswer, readAIOutage } from "@/src/lib/ai";
import {
  formatAIActionPreviewAnswer,
  formatAIActionConfirmationMessage,
  getAIActionCancellationErrorMessage,
  getAIActionErrorMessage,
  isTerminalAIActionCancellationError,
} from "@/src/lib/aiActionPreview";
import { getUnclearRequestActions, resolveClarificationRequest } from "@/src/lib/aiClarification";
import { getAnswerChips, getGuidedActions, type AIGuidedAction } from "@/src/lib/aiGuidedActions";
import { useAutoGrowTextarea } from "@/src/lib/chatComposer";
import { loadPendingPlan, savePendingPlan, type StoredPlanState } from "@/src/lib/aiPendingPlan";
import { resolveNavigationRequest } from "@/src/lib/aiNavigation";
import {
  chatStorageKey,
  purgeStaleChats,
  subscribeToChatClear,
  subscribeToChatWrites,
} from "@/src/lib/aiChatStorage";
import {
  hydrateThreadMessages,
  isConversationGone,
  loadThreadCache,
  migrateLegacyThread,
  notifyConversationsChanged,
  adoptUnsentThread,
  saveThreadCache,
  setActiveThread,
  threadKey,
  useActiveThread,
} from "@/src/lib/aiThreads";
import AIChatList from "@/src/components/shared/AIChatList";
import { createRequestGeneration } from "@/src/lib/requestGeneration";
import { useAuth } from "@/src/providers/AuthProvider";
import { useLanguage } from "@/src/providers/LanguageProvider";
import { useTheme } from "@/src/providers/ThemeProvider";
import type { AIActionPlan, AIActionPreview, AIAskResponse, AIChartData, AIConversationMessage, AIForecastResult } from "@/src/types/ai";
import AIActionPreviewCard from "@/src/components/shared/AIActionPreviewCard";
import InlineDbConfirmBar from "@/src/components/shared/InlineDbConfirmBar";
import AIOutageNotice, { type AIOutage } from "@/src/components/shared/AIOutageNotice";
import SafeAIResponseContent from "@/src/components/shared/SafeAIResponseContent";

type Message = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: Date;
  actions?: AIGuidedAction[];
  // The pictures an answer came with, drawn under it the same way the AI
  // page draws them. The floating chat used to drop both on the floor.
  forecast?: AIForecastResult;
  chart?: AIChartData;
  // ใบยืนยันเป็นของคำตอบใบใดใบหนึ่ง ไม่ใช่ของทั้งบทสนทนา · เก็บ id ไว้กับ
  // ข้อความที่สร้างมัน กล่องจะได้อยู่ใต้คำตอบนั้นแทนที่จะไหลไปท้ายสายเสมอ
  planId?: string;
  previewId?: string;
};

type StoredMessage = Omit<Message, "createdAt"> & {
  createdAt?: string;
};

function buildCopy(language: "th" | "en") {
  return language === "th"
    ? {
        title: "ผู้ช่วยวิเคราะห์ร้าน AI",
        subtitle: "ถามจากยอดขายและคลังวัตถุดิบล่าสุดของร้าน",
        welcome: "สวัสดีคุณผู้จัดการ",
        askPlaceholder: "พิมพ์คำถามของคุณที่นี่...",
        send: "ส่ง",
        thinking: "กำลังวิเคราะห์...",
        model: "โมเดล",
        toggleStatsTooltip: "เปิด/ปิด แผงควบคุมสถิติข้างเคียง",
        quickQuestions: [
          "สรุปร้าน",
          "เมนูขายดี",
          "วัตถุดิบใกล้หมด",
          "มูลค่าสต๊อก",
        ],
      }
    : {
        title: "AI Operations Assistant",
        subtitle: "Analyzing sales and real-time inventory levels",
        welcome: "Hello, manager.",
        askPlaceholder: "Type your question here...",
        send: "Send",
        thinking: "Analyzing...",
        model: "Model",
        toggleStatsTooltip: "Toggle side statistics panel",
        quickQuestions: [
          "Summarize today's restaurant situation.",
          "What ingredients should we prepare tomorrow?",
          "Which menu items sell well and affect stock the most?",
          "Are there stockout or overbuying risks?",
        ],
      };
}

export default function AIOperationsFloatingChat() {
  const { activeMembership, user } = useAuth();
  const { language } = useLanguage();
  const { showAIAssistant } = useTheme();
  const router = useRouter();
  const pathname = usePathname();
  const copy = useMemo(() => buildCopy(language), [language]);
  const welcomeText = useWelcome(language);
  const followUpsOn = useFollowUpsEnabled();
  const labels = useMemo(() => language === "th"
    ? {
        openAssistant: "เปิดผู้ช่วย AI",
        closeAssistant: "ปิดผู้ช่วย AI",
        clearChat: "เริ่มแชทใหม่",
        chats: "รายการแชท",
        chatGone: "แชทนี้ถูกลบไปแล้ว เปิดแชทใหม่ให้แล้วครับ",
        clearChatTitle: "เริ่มแชทใหม่ไหม?",
        clearChatConfirm: "บทสนทนานี้จะถูกลบทั้งหมด และผู้ช่วยจะจำเรื่องที่คุยกันไว้ไม่ได้อีก",
        clearChatYes: "ลบแล้วเริ่มใหม่",
        clearChatNo: "ไม่ลบ",
        scrollToLatest: "ไปที่ข้อความล่าสุด",
      }
    : {
        openAssistant: "Open AI assistant",
        closeAssistant: "Close AI assistant",
        clearChat: "New chat",
        chats: "Chats",
        chatGone: "That chat was deleted. Starting a new one.",
        clearChatTitle: "Start a new chat?",
        clearChatConfirm: "This conversation will be deleted, and the assistant will not remember any of it.",
        clearChatYes: "Delete and start over",
        clearChatNo: "Keep it",
        scrollToLatest: "Jump to the latest message",
      }, [language]);

  const [isOpen, setIsOpen] = useState(false);

  // The orb can be dragged anywhere and, once let go, settles against the
  // nearest side of the screen — the way a Messenger chat head behaves. Where
  // it settled is remembered on this device. A press that never travelled
  // more than a few pixels is a tap and opens the chat as before.
  const [orbSpot, setOrbSpot] = useState<OrbSpot | null>(null);
  const [orbDrag, setOrbDrag] = useState<{ x: number; y: number } | null>(null);
  const [viewport, setViewport] = useState<{ w: number; h: number } | null>(null);
  const orbPressRef = useRef<{ pointerId: number; startX: number; startY: number; offsetX: number; offsetY: number; moved: boolean } | null>(null);
  const orbSkipClickRef = useRef(false);
  const orbRef = useRef<HTMLButtonElement | null>(null);
  // The orb takes its colours from the surface it settled on (see orbPalette).
  const [orbPalette, setOrbPalette] = useState<OrbPalette>(ORB_DEFAULT_PALETTE);
  const sampleOrbSurface = useCallback(() => {
    const orb = orbRef.current;
    if (!orb || typeof document.elementsFromPoint !== "function") return;
    const rect = orb.getBoundingClientRect();
    const stack = document.elementsFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    for (const element of stack) {
      if (orb.contains(element)) continue;
      const rgb = parseCssRgb(getComputedStyle(element).backgroundColor);
      if (!rgb || rgb.a < 0.5) continue;
      setOrbPalette(orbPaletteForSurface(rgb));
      return;
    }
    setOrbPalette(ORB_DEFAULT_PALETTE);
  }, []);
  useEffect(() => {
    const measure = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    measure();
    window.addEventListener("resize", measure);
    try {
      const raw = window.localStorage.getItem(ORB_SPOT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<OrbSpot>;
        if ((parsed.side === "left" || parsed.side === "right") && typeof parsed.top === "number") {
          setOrbSpot({ side: parsed.side, top: parsed.top });
        }
      }
    } catch {
      // No storage: the orb starts in its corner.
    }
    return () => window.removeEventListener("resize", measure);
  }, []);
  useEffect(() => {
    if (orbDrag || isOpen) return;
    // After the snap transition (200ms) so the sample is taken where it landed.
    const timer = window.setTimeout(sampleOrbSurface, 260);
    return () => window.clearTimeout(timer);
  }, [orbSpot, viewport, pathname, isOpen, orbDrag, sampleOrbSurface]);
  const orbMargin = viewport && viewport.w >= 640 ? 24 : 16;
  const clampOrbTop = (top: number) => {
    if (!viewport) return top;
    return Math.min(Math.max(top, orbMargin), viewport.h - ORB_SIZE - orbMargin);
  };
  const onOrbPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    orbPressRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onOrbPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const press = orbPressRef.current;
    if (!press || press.pointerId !== event.pointerId) return;
    if (!press.moved) {
      if (Math.hypot(event.clientX - press.startX, event.clientY - press.startY) < ORB_DRAG_THRESHOLD) return;
      press.moved = true;
    }
    setOrbDrag({ x: event.clientX - press.offsetX, y: event.clientY - press.offsetY });
  };
  const onOrbPointerUp = (event: React.PointerEvent<HTMLButtonElement>) => {
    const press = orbPressRef.current;
    if (!press || press.pointerId !== event.pointerId) return;
    orbPressRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!press.moved) return; // a tap: the click that follows opens the chat
    orbSkipClickRef.current = true;
    const x = event.clientX - press.offsetX;
    const width = viewport?.w ?? window.innerWidth;
    const spot: OrbSpot = {
      side: x + ORB_SIZE / 2 < width / 2 ? "left" : "right",
      top: clampOrbTop(event.clientY - press.offsetY),
    };
    setOrbDrag(null);
    setOrbSpot(spot);
    try {
      window.localStorage.setItem(ORB_SPOT_KEY, JSON.stringify(spot));
    } catch {
      // Not remembered, still moved.
    }
  };
  const onOrbClick = () => {
    if (orbSkipClickRef.current) {
      orbSkipClickRef.current = false;
      return;
    }
    setIsOpen(true);
  };
  // Where the orb sits right now: under the finger while dragging, at its
  // remembered spot otherwise, or (before anything is known) in its corner.
  const orbStyle: React.CSSProperties | undefined = orbDrag
    ? { left: orbDrag.x, top: orbDrag.y, right: "auto", bottom: "auto" }
    : orbSpot && viewport
      ? {
          left: orbSpot.side === "left" ? orbMargin : viewport.w - ORB_SIZE - orbMargin,
          top: clampOrbTop(orbSpot.top),
          right: "auto",
          bottom: "auto",
        }
      : undefined;
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  // The answer so far while it is being written — shown in place of the
  // "thinking" line, replaced by the finished message when it arrives.
  const [draft, setDraft] = useState<string | null>(null);
  const [outage, setOutage] = useState<AIOutage | null>(null);
  const [lastQuestion, setLastQuestion] = useState("");
  const [pendingActionPreview, setPendingActionPreview] = useState<AIActionPreview | null>(null);
  // Multi-item action plans (stock, menu, expense commands). This surface used to
  // ignore them entirely: the answer said "press confirm" and no confirm bar was
  // ever drawn, so a command typed here could never be carried out. It did not
  // show while phones were redirected to the full page, and became reachable the
  // moment the floating chat started opening as a sheet on mobile.
  const [pendingActionPlan, setPendingActionPlan] = useState<AIActionPlan | null>(null);
  // How the card ended, if it has. Kept beside the plan so closing the widget or
  // leaving the page brings the same card back, saying what happened.
  const [planCardState, setPlanCardState] = useState<StoredPlanState>("pending");
  const [actionConfirming, setActionConfirming] = useState(false);
  const [actionCancelling, setActionCancelling] = useState(false);
  const [actionPreviewError, setActionPreviewError] = useState("");
  const [hydratedStorageKey, setHydratedStorageKey] = useState<string | null>();
  const [conversationRequests] = useState(createRequestGeneration);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  // Whether the thread is scrolled to its end. The jump button only earns its
  // place when it is not: shown always, it covers a message to offer a trip to
  // where the reader already is.
  const [atLatest, setAtLatest] = useState(true);
  // Clearing deletes the conversation on the server as well, and there is no
  // undo, so the button asks first. It used to wipe the thread on one stray tap.
  const chatDialogRef = useRef<HTMLDivElement>(null);
  const composer = useAutoGrowTextarea(input);
  const inputRef = composer.ref;
  const chatReturnFocusRef = useRef<HTMLElement | null>(null);
  const chatWriteSourceRef = useRef(Symbol("ai-floating-chat"));

  const canAskAI = activeMembership?.role?.name === "owner";

  // Per-(restaurant, user) storage key, shared with the full /ai-assistant page.
  const storageKey = useMemo(
    () => chatStorageKey(activeMembership?.restaurant_id, user?.ID),
    [user, activeMembership],
  );
  // The same active chat as the AI page, read from the same place.
  const activeThread = useActiveThread(storageKey);
  const threadStorageKey = useMemo(() => threadKey(storageKey, activeThread), [storageKey, activeThread]);
  const skipServerLoadRef = useRef<string | null>(null);
  const [listOpen, setListOpen] = useState(false);
  // Switching chats leaves the current one behind, and a preview waiting on
  // it must be settled first — the server holds one at a time.
  const openThread = async (conversationId: string | null) => {
    if (pendingActionPreview && !(await discardPendingActionPreview())) return;
    setListOpen(false);
    setActiveThread(storageKey, conversationId);
  };

  // Load shared history for the current (restaurant, user) with TTL + cleanup.
  useEffect(() => {
    conversationRequests.invalidate();
    // Drop the previous key's server conversation and pending action right away:
    // a send between this render and the deferred load must not reuse them.
    setConversationId(null);
    setPendingActionPreview(null);
    setPendingActionPlan(null);
    setPlanCardState("pending");
    setActionConfirming(false);
    setActionCancelling(false);
    setActionPreviewError("");
    let cancelled = false;
    const loadTimer = window.setTimeout(() => {
      if (migrateLegacyThread(storageKey) && !activeThread) return;
      purgeStaleChats(storageKey);
      setConversationId(activeThread);
      const stored = loadThreadCache<StoredMessage>(storageKey, activeThread);
      setMessages(stored && stored.length > 0
        ? stored.map((m) => ({ ...m, createdAt: m.createdAt ? new Date(m.createdAt) : new Date() }))
        : [{ id: "welcome", role: "assistant", content: welcomeText, createdAt: new Date() }]);
      // The server owns the transcript; the cache only paints first.
      if (activeThread && skipServerLoadRef.current !== activeThread) {
        getAIConversationTurns(activeThread)
          .then((res) => {
            if (cancelled) return;
            const hydrated = hydrateThreadMessages(res.data.turns ?? [], activeMembership, language);
            if (hydrated.length > 0) setMessages(hydrated);
          })
          .catch((err: unknown) => {
            if (cancelled) return;
            if (isConversationGone(err)) setActiveThread(storageKey, null);
          });
      }
      skipServerLoadRef.current = null;
      // The server holds one pending plan at a time and it survives a page
      // switch; the card that goes with it has to survive too, or the owner is
      // told to answer a card that is no longer anywhere on screen.
      const storedPlan = loadPendingPlan(threadStorageKey);
      setPendingActionPlan(storedPlan?.plan ?? null);
      setPlanCardState(storedPlan?.state ?? "pending");
      setLoading(false);
      setHydratedStorageKey(threadStorageKey);
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(loadTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationRequests, storageKey, threadStorageKey, activeThread, welcomeText]);

  // Persist to the shared key; a lone welcome message is not persisted.
  useEffect(() => {
    if (hydratedStorageKey !== threadStorageKey) return;
    saveThreadCache(storageKey, activeThread, messages, chatWriteSourceRef.current);
  }, [hydratedStorageKey, messages, storageKey, activeThread, threadStorageKey]);

  // Only after hydration: before it the plan is deliberately null, and saving
  // that would erase the very card we are about to restore.
  useEffect(() => {
    if (hydratedStorageKey !== threadStorageKey) return;
    savePendingPlan(threadStorageKey, pendingActionPlan, planCardState);
  }, [hydratedStorageKey, pendingActionPlan, planCardState, threadStorageKey]);

  useEffect(() => subscribeToChatWrites(threadStorageKey, chatWriteSourceRef.current, (write) => {
    if (write.kind === "conversation") {
      setConversationId(write.conversationId);
      return;
    }
    const stored = write.messages as StoredMessage[];
    setMessages(stored.map((message) => ({
      ...message,
      createdAt: message.createdAt ? new Date(message.createdAt) : new Date(),
    })));
  }), [threadStorageKey]);

  // Scroll to bottom when messages change
  useEffect(() => {
    if (messagesEndRef.current) {
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      messagesEndRef.current.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "end" });
    }
  }, [messages, loading, draft]);

  useEffect(() => {
    if (!isOpen) return;
    chatReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setIsOpen(false);
    };

    document.addEventListener("keydown", closeOnEscape);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", closeOnEscape);
      chatReturnFocusRef.current?.focus();
      chatReturnFocusRef.current = null;
    };
  }, [isOpen]);

  const conversationHistory = (): AIConversationMessage[] =>
    messages
      .filter((message): message is Message & { role: "user" | "assistant" } => message.role !== "system")
      .slice(-6)
      .map((message) => ({ id: message.id, role: message.role, content: message.content }));

  const resetConversation = useCallback(() => {
    conversationRequests.invalidate();
    setLoading(false);
    // Also reached when the other chat surface clears: that surface's history is
    // gone, so this one must drop the shared server thread and any pending action.
    setConversationId(null);
    setPendingActionPreview(null);
    setPendingActionPlan(null);
    setPlanCardState("pending");
    setActionConfirming(false);
    setActionCancelling(false);
    setActionPreviewError("");
    setMessages([{ id: "welcome", role: "assistant", content: welcomeText, createdAt: new Date() }]);
  }, [conversationRequests, welcomeText]);

  useEffect(() => subscribeToChatClear((clearedKey) => {
    if (clearedKey === threadStorageKey) resetConversation();
  }), [resetConversation, threadStorageKey]);

  // Start a fresh chat: drop the stored history and reset to the welcome message.
  // How far from the bottom still counts as "at the latest". A couple of lines of
  // slack, so the button does not flash on the half-pixel drift a smooth scroll
  // leaves behind.
  const scrollSlack = 48;

  const handleThreadScroll = () => {
    const area = scrollAreaRef.current;
    if (!area) return;
    setAtLatest(area.scrollHeight - area.scrollTop - area.clientHeight <= scrollSlack);
  };

  const jumpToLatest = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  };

  const handleAction = (action: AIGuidedAction) => {
    if (action.prompt) {
      handleSend(action.prompt);
      return;
    }
    if (!action.href) return;
    if (!action.requiresConfirmation) {
      router.push(action.href);
      return;
    }
    setMessages((previous) => [
      ...previous,
      {
        id: `confirm-${previous.length}`,
        role: "assistant",
        content: action.description ?? (language === "th" ? "กรุณาตรวจสอบก่อนดำเนินการต่อครับ" : "Please review before continuing."),
        createdAt: new Date(),
        actions: [
          {
            ...action,
            label: language === "th" ? `ยืนยัน: ${action.label}` : `Confirm: ${action.label}`,
            requiresConfirmation: false,
          },
        ],
      },
    ]);
  };

  const handleSend = async (textToSend = input) => {
    const trimmed = textToSend.trim();
    if (!trimmed || loading || actionConfirming || actionCancelling) return;
    if (pendingActionPreview && !(await discardPendingActionPreview())) return;

    setInput("");
    setPendingActionPreview(null);
    // The pending plan deliberately survives a new question. Clearing it here hid
    // the confirm bar while the server still held the plan, and the server answers
    // the next command with "there is still something waiting — confirm or cancel
    // it above" over a box that is no longer on screen. The owner could then
    // neither confirm nor cancel, and had to wait out the expiry. The bar carries
    // its own countdown and terminal states, so leaving it up is safe.
    setActionPreviewError("");
    
    setMessages((previous) => [
      ...previous,
      { id: `user-${previous.length}`, role: "user", content: trimmed, createdAt: new Date() },
    ]);

    const navigation = resolveNavigationRequest(trimmed, activeMembership, language, pathname);
    if (navigation) {
      setMessages((previous) => [
        ...previous,
        {
          id: `nav-${previous.length}`,
          role: "assistant",
          content: navigation.message,
          createdAt: new Date(),
          actions: navigation.kind === "suggest"
            ? navigation.options.map((option) => ({ id: option.href, ...option }))
            : undefined,
        },
      ]);
      if (navigation.kind === "navigate" && !navigation.alreadyThere) {
        router.push(navigation.href);
      }
      return;
    }

    const clarification = resolveClarificationRequest(trimmed, activeMembership, language);
    if (clarification) {
      setMessages((previous) => [
        ...previous,
        {
          id: `clarify-${previous.length}`,
          role: "assistant",
          content: clarification.message,
          createdAt: new Date(),
          actions: clarification.actions,
        },
      ]);
      return;
    }

    if (!canAskAI) {
      setMessages((previous) => [
        ...previous,
        {
          id: `permission-${previous.length}`,
          role: "assistant",
          content: language === "th"
            ? "ผมช่วยพาไปหน้าเมนูที่คุณเข้าถึงได้ครับ ส่วนผู้ช่วย AI สำหรับข้อมูลร้านเปิดให้เจ้าของร้านเท่านั้น"
            : "I can guide you to pages you can access. The restaurant AI assistant is available to the owner only.",
          createdAt: new Date(),
        },
      ]);
      return;
    }

    const requestGeneration = conversationRequests.begin();
    // Kept for the outage card's retry button, and cleared here so a card from a
    // previous failure does not sit under a question that has since succeeded.
    setLastQuestion(trimmed);
    setOutage(null);
    setLoading(true);

    try {
      const response = await askOperationsAIStream(trimmed, conversationHistory(), conversationId, {
        onDraft: (text) => {
          if (conversationRequests.isCurrent(requestGeneration)) setDraft(text);
        },
      });
      // The chat was cleared or switched restaurants while this was in flight —
      // drop the answer instead of appending it to a conversation it never joined.
      if (!conversationRequests.isCurrent(requestGeneration)) return;
      const data: AIAskResponse = response.data;
      const answer = normalizeAIAnswer(data?.answer);
      if (!answer) throw new Error("AI response did not contain a valid answer");
      const newThreadId = data.conversation_id && data.conversation_id !== conversationId ? data.conversation_id : null;
      if (data.conversation_id) setConversationId(data.conversation_id);
      
      const assistantMsg: Message = {
        id: data.turn_id ? `${data.turn_id}-assistant` : `ai-${Date.now()}`,
        role: "assistant",
        content: formatAIActionPreviewAnswer(answer, data.action_preview, language),
        createdAt: new Date(),
        // The model's own follow-ups win whatever the intent; the fixed lists
        // are the fallback for a reply that came without them.
        actions: (data.follow_ups && data.follow_ups.length > 0) || data.navigate
          ? getAnswerChips(trimmed, answer, activeMembership, language, data.tools_used ?? data.tool, data.scope_assumed, data.follow_ups, data.navigate)
          : data.intent === "unclear"
            ? getUnclearRequestActions(activeMembership, language)
            : [],
        forecast: data.forecast,
        chart: data.chart,
        planId: data.action_plan?.id,
        previewId: data.action_preview?.id,
      };
      
      setMessages(prev => {
        const next = [...prev, assistantMsg];
        if (newThreadId) adoptUnsentThread(storageKey, newThreadId, next, chatWriteSourceRef.current);
        return next;
      });
      if (newThreadId) {
        skipServerLoadRef.current = newThreadId;
        setActiveThread(storageKey, newThreadId);
      }
      notifyConversationsChanged();

      if (data.action_preview) {
        setPendingActionPreview(data.action_preview);
      }

      if (data.action_plan) {
        setPendingActionPlan(data.action_plan);
        setPlanCardState("pending");
      }
          } catch (err: unknown) {
      if (!conversationRequests.isCurrent(requestGeneration)) return;
      if (isConversationGone(err)) {
        setActiveThread(storageKey, null);
        setMessages(prev => [...prev, { id: `gone-${Date.now()}`, role: "assistant", content: labels.chatGone, createdAt: new Date() }]);
        return;
      }
      console.error(err);
      // An outage is reported by the backend as a code, not as English words in
      // the message. This used to sniff the message for "429"/"quota"/"exhausted"
      // and the message arrives in Thai, so a quota outage never matched: the
      // owner saw a bare error line with no wait and no retry, while the full AI
      // page showed a proper card for the same failure.
      const reportedOutage = readAIOutage(err);
      if (reportedOutage) {
        setOutage(reportedOutage);
        return;
      }
      const errorMessage =
        typeof err === "object" && err !== null && "response" in err
          ? (err as { response?: { data?: { error?: string } } }).response?.data?.error
          : "";

      setMessages((previous) => [
        ...previous,
        {
          id: `err-${previous.length}`,
          role: "system",
          content: errorMessage || copy.thinking.replace("กำลังวิเคราะห์...", "เกิดข้อผิดพลาดในการเชื่อมต่อกรุณาลองใหม่อีกครั้ง"),
          createdAt: new Date(),
        },
      ]);
    } finally {
      if (conversationRequests.isCurrent(requestGeneration)) setDraft(null);
      setLoading(false);
    }
  };

  // Plan confirm/cancel mirror the full AI page: the outcome is reported per item,
  // so a batch that partly failed says so instead of reading as a clean success.
  const handlePlanConfirm = async () => {
    const plan = pendingActionPlan;
    if (!plan) return;
    const response = await confirmAIActionPlan(plan.id, plan.confirmation_token);
    setMessages((previous) => [
      ...previous,
      {
        id: `plan-${response.data.plan_id}`,
        role: "assistant",
        content: response.data.message,
        createdAt: new Date(),
      },
    ]);
    // HTTP 200 with nothing changed: the failure lives in the body, so it has to
    // be raised or the bar paints green over a plan that did nothing.
    if (response.data.succeeded === 0 && response.data.failed > 0) {
      throw new Error(response.data.message);
    }
  };

  const handlePlanCancel = () => {
    const plan = pendingActionPlan;
    if (!plan) return;
    cancelAIActionPlan(plan.id).catch(() => undefined);
  };

  const handleConfirmActionPreview = async () => {
    const preview = pendingActionPreview;
    if (!preview || actionConfirming || actionCancelling) return;

    const requestGeneration = conversationRequests.begin();
    setActionConfirming(true);
    setActionPreviewError("");
    try {
      const response = await confirmAIAction(preview.id, preview.confirmation_token);
      if (!conversationRequests.isCurrent(requestGeneration)) return;
      setPendingActionPreview((current) => current?.id === preview.id ? null : current);
      setMessages((previous) => [
        ...previous,
        {
          id: `action-${response.data.action_id}`,
          role: "assistant",
          content: formatAIActionConfirmationMessage(response.data, language),
          createdAt: new Date(),
        },
      ]);
    } catch (actionError: unknown) {
      if (!conversationRequests.isCurrent(requestGeneration)) return;
      setActionPreviewError(getAIActionErrorMessage(actionError, language));
    } finally {
      if (conversationRequests.isCurrent(requestGeneration)) setActionConfirming(false);
    }
  };

  async function discardPendingActionPreview(): Promise<boolean> {
    const preview = pendingActionPreview;
    if (!preview) return true;
    if (actionConfirming || actionCancelling) return false;

    const requestGeneration = conversationRequests.begin();
    setActionCancelling(true);
    setActionPreviewError("");
    try {
      await cancelAIAction(preview.id);
      if (!conversationRequests.isCurrent(requestGeneration)) return false;
      setPendingActionPreview((current) => current?.id === preview.id ? null : current);
      return true;
    } catch (cancellationError: unknown) {
      if (!conversationRequests.isCurrent(requestGeneration)) return false;
      if (isTerminalAIActionCancellationError(cancellationError)) {
        setPendingActionPreview((current) => current?.id === preview.id ? null : current);
        return true;
      }
      setActionPreviewError(getAIActionCancellationErrorMessage(language));
      return false;
    } finally {
      if (conversationRequests.isCurrent(requestGeneration)) setActionCancelling(false);
    }
  }

  async function handleCancelActionPreview() {
    await discardPendingActionPreview();
  }

  // Hide the floating widget on the dedicated AI assistant page to avoid two
  // chat surfaces at once (they share the same history).
  if (!activeMembership || !showAIAssistant || pathname === "/ai-assistant") return null;


  // A confirmation card belongs under the answer that proposed it, not at the
  // end of the thread. See the same block on the AI assistant page — both
  // surfaces used to render these after messages.map, so the card always sat
  // last and slid down under whatever question came next.
  //
  // The fallback matters: with no owning message the card renders at the end as
  // before, because the server still refuses every other command until it is
  // confirmed or cancelled, and a card nobody can see is a deadlock.
  const planCard =
    pendingActionPlan && pendingActionPlan.items.length > 0 ? (
      <InlineDbConfirmBar
        key={pendingActionPlan.id}
        summary={pendingActionPlan.summary}
        items={pendingActionPlan.items.map((planItem) => ({
          title: planItem.title,
          change: planItem.change,
          unit: planItem.unit,
          sideEffects: planItem.side_effects,
        }))}
        warnings={pendingActionPlan.warnings}
        detail={language === "th"
          ? `แก้ข้อมูลจริง ${pendingActionPlan.items.length} รายการ`
          : `changes ${pendingActionPlan.items.length} record(s)`}
        expiresAt={pendingActionPlan.expires_at}
        onConfirm={handlePlanConfirm}
        onCancel={handlePlanCancel}
        initialState={planCardState}
        onResolved={(resolved) => {
          if (resolved !== "confirming") setPlanCardState(resolved);
        }}
        language={language}
      />
    ) : null;

  const previewCard = pendingActionPreview ? (
    <AIActionPreviewCard
      preview={pendingActionPreview}
      language={language}
      confirming={actionConfirming}
      cancelling={actionCancelling}
      error={actionPreviewError}
      onConfirm={handleConfirmActionPreview}
      onCancel={handleCancelActionPreview}
    />
  ) : null;

  // Only the welcome line is in the thread, so nothing has been asked yet.
  const isEmptyThread = messages.length <= 1 && !loading;
  const planAnchorId = pendingActionPlan
    ? messages.find((message) => message.planId === pendingActionPlan.id)?.id ?? null
    : null;
  const previewAnchorId = pendingActionPreview
    ? messages.find((message) => message.previewId === pendingActionPreview.id)?.id ?? null
    : null;

  return (
    <>
      {/* Local motion keeps the floating assistant responsive without page-level choreography. */}
      <style>{`
        @keyframes messageSlideUp {
          0% { transform: translateY(8px); opacity: 0; }
          100% { transform: translateY(0) scale(1); opacity: 1; }
        }
        .animate-message-slide {
          animation: messageSlideUp 180ms cubic-bezier(0.2, 0, 0, 1) both;
        }
        .focus-glow:focus {
          border-color: rgb(249 115 22);
          box-shadow: 0 0 0 2px rgba(249, 115, 22, 0.15);
        }
        /* Phone sheet only: the message list dissolves into the canvas under the
           floating controls instead of ending at a hard edge. From sm up the panel
           has a real header bar, so no fade there. */
        @media (max-width: 639px) {
          .ai-sheet-fade {
            -webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 3.25rem);
            mask-image: linear-gradient(to bottom, transparent 0, #000 3.25rem);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .animate-message-slide {
            animation: none !important;
          }
        }
      `}</style>

      {/* Chat Window Panel.
          Phone: a bottom sheet that slides up in place (Meta-style) — tap the orb
          and the chat rises over the current page, no navigation. It sits flush to
          the bottom and leaves a peek of the page at the top. Slide is a transform
          so it reads as motion, not a fade.
          sm+: the docked bottom-right card, unchanged — sm:translate-y-0 cancels the
          sheet transform and it fades with opacity as before. */}
      <div
        className={`fixed inset-x-0 bottom-0 z-[var(--z-chat)] flex h-[88dvh] items-stretch transition-transform duration-300 ease-out ${
          isOpen ? "translate-y-0" : "translate-y-full"
        } ${isOpen ? "pointer-events-auto" : "pointer-events-none"} sm:inset-auto sm:bottom-6 sm:right-6 sm:h-[min(680px,calc(100dvh-3rem))] sm:w-[380px] sm:translate-y-0 sm:transition-opacity md:w-[400px] ${
          isOpen ? "sm:opacity-100" : "sm:opacity-0"
        }`}
      >
        {/* Main Chat Overlay Box */}
        <div className="relative isolate flex h-full w-full shrink-0 rounded-md">
          <div
            ref={chatDialogRef}
            role="dialog"
            aria-modal="false"
            aria-labelledby="ai-operations-chat-title"
            className="relative z-10 flex h-full w-full flex-col overflow-hidden rounded-t-2xl rounded-b-none border border-gray-200 bg-[#faf8f2] shadow-xl shadow-gray-950/10 transition-shadow duration-200 dark:border-gray-800 dark:bg-gray-950 dark:shadow-black/30 sm:rounded-2xl sm:bg-white"
          >
          {/* No header bar at any width. The phone had one treatment and the desktop
              another — a titled, bordered bar — and the owner preferred the phone's:
              the panel is small enough that a bar naming what you just opened spends
              a row of it saying nothing. The controls float over the canvas instead,
              and the ones that only make sense on a wider screen keep their own
              width gates rather than living in a separate header. */}
          <div className="absolute right-3 top-3 z-20 flex items-center gap-2">
            <button
              type="button"
              aria-label={labels.chats}
              onClick={(e) => {
                e.stopPropagation();
                setListOpen(true);
              }}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-gray-200/80 bg-white/80 text-gray-600 shadow-sm backdrop-blur transition-all active:scale-95 hover:text-gray-900 dark:border-gray-800/80 dark:bg-gray-900/70 dark:text-gray-300 dark:hover:text-white"
            >
              <MessageSquareText className="h-3.5 w-3.5" />
            </button>
            {messages.length > 1 && (
              <button
                type="button"
                aria-label={labels.clearChat}
                disabled={loading || actionConfirming || actionCancelling}
                onClick={(e) => {
                  e.stopPropagation();
                  openThread(null);
                }}
                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-gray-200/80 bg-white/80 text-gray-600 shadow-sm backdrop-blur transition-all active:scale-95 disabled:opacity-50 dark:border-gray-800/80 dark:bg-gray-900/70 dark:text-gray-300"
              >
                <SquarePen className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              type="button"
              aria-label={labels.closeAssistant}
              onClick={(e) => {
                e.stopPropagation();
                setIsOpen(false);
              }}
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-gray-200/80 bg-white/80 text-gray-600 shadow-sm backdrop-blur transition-all active:scale-95 dark:border-gray-800/80 dark:bg-gray-900/70 dark:text-gray-300"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {listOpen && (
            <AIChatList
              variant="sheet"
              language={language}
              activeId={activeThread}
              onOpen={openThread}
              onNew={() => openThread(null)}
              onClose={() => setListOpen(false)}
            />
          )}
          {/* Chat Messages Body with custom scrollbar and entry animation.
              Phone: extra top padding clears the floating controls, and the same
              top fade as the AI page lets content dissolve instead of being cut. */}
          <div
            ref={scrollAreaRef}
            onScroll={handleThreadScroll}
            className="ai-sheet-fade flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-3 pb-4 pt-14 space-y-4 scrollbar-thin sm:px-4 sm:pt-4"
          >
            {/* Nothing asked yet: the orb, one line, and the questions — the
                same opening as the full AI page. This used to be a chat bubble
                introducing the assistant, with the suggestions in a separate
                drawer below it that pushed the input off a phone screen. Two
                surfaces, two first impressions, for the same assistant. */}
            {isEmptyThread ? (
              <div className="flex h-full flex-col items-center justify-center gap-4 px-2 pb-6 text-center">
                <SiriOrb
                  size="112px"
                  className="shrink-0 drop-shadow-[0_15px_50px_rgba(249,115,22,0.4)]"
                />
                <h2 className="shrink-0 text-base font-semibold text-gray-950 dark:text-white">
                  {welcomeText}
                </h2>
                <div className="flex flex-wrap justify-center gap-2">
                  {copy.quickQuestions.map((question) => (
                    <button
                      key={question}
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        handleSend(question);
                      }}
                      className="min-h-9 rounded-full border border-gray-200 bg-white/70 px-3.5 py-1.5 text-[12px] font-medium text-gray-700 shadow-sm backdrop-blur transition-all hover:-translate-y-0.5 hover:border-orange-300 hover:text-orange-700 hover:shadow-md hover:shadow-orange-500/10 dark:border-gray-800 dark:bg-gray-900/40 dark:text-gray-300 dark:hover:border-orange-800 dark:hover:text-orange-300"
                    >
                      {question}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
            messages.map((msg) => {
              if (msg.role === "system") {
                return (
                  <div key={msg.id} className="w-full text-center py-2 text-xs text-red-500 dark:text-red-400 font-medium animate-message-slide">
                    {msg.content}
                  </div>
                );
              }

              if (msg.role === "user") {
                return (
                  <div key={msg.id} className="ml-auto flex max-w-[96%] items-end justify-end gap-2.5 animate-message-slide sm:max-w-[90%]">
                    <div className="max-w-full break-words rounded-2xl rounded-br-md bg-gradient-to-br from-orange-500 to-amber-500 px-4 py-2.5 text-xs leading-relaxed text-white shadow-sm shadow-orange-500/25 sm:text-[13px]">
                      {msg.content}
                    </div>
                  </div>
                );
              }

              // Assistant/AI message
              return (
                <React.Fragment key={msg.id}>
                <div className="flex max-w-full items-start gap-2.5 animate-message-slide sm:max-w-[90%]">
                  <SiriOrb size="30px" className="mt-0.5 shrink-0" animationDuration={8} />
                  <div className="min-w-0 break-words rounded-2xl rounded-tl-md border border-gray-200/70 bg-white px-4 py-2.5 text-xs leading-relaxed text-gray-800 shadow-sm dark:border-gray-700/60 dark:bg-gray-800/80 dark:text-gray-100 sm:text-[13px]">
                    <SafeAIResponseContent content={msg.content} compact language={language} />
                    {msg.forecast && msg.forecast.forecast.length > 0 && (
                      <ForecastChart data={msg.forecast} language={language} />
                    )}
                    {msg.chart && msg.chart.categories.length > 0 && (
                      <AIChart data={msg.chart} language={language} />
                    )}
                  </div>
                </div>
                {followUpsOn && msg.actions && msg.actions.length > 0 && (
                  <AIFollowUpList
                    items={msg.actions}
                    messageId={msg.id}
                    language={language}
                    onSelect={handleAction}
                    className="-mt-3"
                  />
                )}
                {planAnchorId === msg.id && planCard}
                {previewAnchorId === msg.id && previewCard}
                </React.Fragment>
              );
            })
            )}

            {loading && draft && (
              <div className="flex max-w-full items-start gap-2.5 sm:max-w-[90%]">
                <SiriOrb size="30px" className="mt-0.5 shrink-0" animationDuration={8} />
                <div
                  className="min-w-0 break-words rounded-2xl rounded-tl-md border border-gray-200/70 bg-white px-4 py-2.5 text-xs leading-relaxed text-gray-800 shadow-sm dark:border-gray-700/60 dark:bg-gray-800/80 dark:text-gray-100 sm:text-[13px]"
                  aria-live="polite"
                >
                  <SafeAIResponseContent content={draft} compact language={language} />
                  <span className="ai-stream-caret" aria-hidden="true" />
                </div>
              </div>
            )}
            {loading && !draft && (
              <div className="flex items-center gap-2.5 animate-message-slide">
                <SiriOrb size="30px" className="shrink-0" animationDuration={8} />
                <div
                  role="status"
                  aria-label={copy.thinking}
                  className="flex items-center rounded-2xl rounded-tl-md border border-gray-200/70 bg-white px-4 py-2.5 dark:border-gray-700/60 dark:bg-gray-800/80"
                >
                  <span className="ai-shimmer-text text-xs font-medium sm:text-[13px]">{copy.thinking}</span>
                </div>
              </div>
            )}
            {outage && (
              <AIOutageNotice
                language={language}
                outage={outage}
                retrying={loading}
                onRetry={() => {
                  const question = lastQuestion;
                  setOutage(null);
                  if (question) void handleSend(question);
                }}
              />
            )}
            {/* fallback: ไม่เจอข้อความเจ้าของใบ จึงวางท้ายสายเหมือนเดิม
                ดีกว่าไม่แสดงเลย เพราะเซิร์ฟเวอร์ยังกันคำสั่งอื่นอยู่ */}
            {planAnchorId === null && planCard}
            {previewAnchorId === null && previewCard}
            <div ref={messagesEndRef} />
          </div>

          {/* Asked before the thread is deleted, not after. The server copy goes
              too and there is no undo, so a stray tap on a small screen used to
              cost the whole conversation.

              A modal rather than an inline card: the inline version lived at the
              bottom of the message column, so on a phone the question could be
              scrolled away from while the thread it was about to delete stayed on
              screen. This one cannot be scrolled past or missed. */}

          {/* A way back to the newest message once the reader has scrolled up.
              It sits just above the input and only appears when there is
              somewhere to go, so it never covers a message the reader is on. */}
          {!atLatest && messages.length > 1 && (
            <div className="pointer-events-none relative z-20 h-0">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  jumpToLatest();
                }}
                aria-label={labels.scrollToLatest}
                title={labels.scrollToLatest}
                className="pointer-events-auto absolute -top-11 left-1/2 inline-flex h-9 w-9 -translate-x-1/2 items-center justify-center rounded-full border border-gray-200/80 bg-white/90 text-gray-600 shadow-md backdrop-blur transition-all hover:-translate-y-0.5 hover:text-orange-600 active:scale-95 dark:border-gray-700/80 dark:bg-gray-900/90 dark:text-gray-300 dark:hover:text-orange-300"
              >
                <ChevronDown className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* Input Form Footer */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
            onClick={(e) => e.stopPropagation()}
            /* Phone: the pill floats on the canvas with no bar or divider above it,
               matching the full AI page. sm+ keeps the bordered footer. */
            className="bg-transparent px-3 pb-3 pt-1 dark:bg-transparent sm:rounded-b-2xl sm:border-t sm:border-gray-200 sm:bg-white sm:p-3.5 sm:dark:border-gray-800 sm:dark:bg-gray-950"
          >
            <div className="flex flex-col gap-1 rounded-[1.5rem] border border-gray-200 bg-white p-1.5 shadow-sm transition focus-within:border-orange-300 dark:border-gray-800 dark:bg-gray-900">
              {/* A textarea, not an input: an input cannot wrap, so a long
                  question scrolled sideways out of sight while it was being
                  typed. Enter still sends; Shift+Enter starts a new line. */}
              <textarea
                ref={inputRef}
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void handleSend();
                  }
                }}
                placeholder={copy.askPlaceholder}
                disabled={loading || actionConfirming || actionCancelling}
                aria-label={copy.askPlaceholder}
                className="min-h-9 w-full resize-none bg-transparent px-2 py-1.5 text-sm font-medium !text-gray-950 placeholder-gray-400 outline-none dark:!text-gray-50 dark:placeholder-gray-500"
              />
              <div className="flex items-center gap-1">
              <AIInputTools
                tools={["scan"]}
                language={language}
                disabled={loading || actionConfirming || actionCancelling}
                onInsertText={(text) => setInput((v) => (v.trim() ? `${v.trim()} ${text}` : text))}
              />
              <div className="flex-1" />
              {composer.canExpand && (
                <button
                  type="button"
                  onClick={() => composer.setExpanded((open) => !open)}
                  aria-label={composer.expanded
                    ? (language === "th" ? "ย่อช่องพิมพ์" : "Shrink the box")
                    : (language === "th" ? "ขยายช่องพิมพ์" : "Expand the box")}
                  aria-expanded={composer.expanded}
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-gray-500 transition-all hover:bg-gray-100 hover:text-gray-900 active:scale-95 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-white"
                >
                  {composer.expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                </button>
              )}
              <AIInputTools
                tools={["voice"]}
                language={language}
                disabled={loading || actionConfirming || actionCancelling}
                onInsertText={(text) => setInput((v) => (v.trim() ? `${v.trim()} ${text}` : text))}
              />
              <button
                type="submit"
                aria-label={copy.send}
                disabled={loading || actionConfirming || actionCancelling || !input.trim()}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-orange-500 to-amber-500 text-white shadow-sm shadow-orange-500/30 transition-all hover:brightness-105 hover:shadow-md hover:shadow-orange-500/40 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ArrowUp className="h-[18px] w-[18px]" strokeWidth={2.75} />
              </button>
              </div>
            </div>
          </form>
          </div>
        </div>
      </div>

      {/* Floating Circular Trigger Button — fades out as the droplet expands over it.
          Tapping it opens the chat in place everywhere: a bottom sheet on a phone,
          the docked card on a larger screen. It no longer navigates away. */}
      <button
        type="button"
        aria-label={labels.openAssistant}
        onClick={onOrbClick}
        onPointerDown={onOrbPointerDown}
        onPointerMove={onOrbPointerMove}
        onPointerUp={onOrbPointerUp}
        onPointerCancel={onOrbPointerUp}
        ref={orbRef}
        style={orbStyle}
        className={`fixed bottom-4 right-4 z-[var(--z-chat)] flex h-14 w-14 touch-none select-none items-center justify-center overflow-hidden rounded-full shadow-xl shadow-orange-500/30 transform-gpu ease-out sm:bottom-6 sm:right-6 ${
          orbDrag
            ? "cursor-grabbing scale-105 shadow-2xl shadow-orange-500/40 transition-none"
            : "cursor-grab transition-[opacity,transform,box-shadow,left,top] duration-200 hover:-translate-y-0.5 hover:shadow-2xl hover:shadow-orange-500/40 active:scale-[0.98]"
        } ${orbPalette.ring ? "ring-2 ring-white/80" : ""} ${
          isOpen
            ? "opacity-0 scale-95 pointer-events-none"
            : "opacity-100 pointer-events-auto"
        }`}
      >
        <SiriOrb size="66px" className="shrink-0" animationDuration={8} colors={orbPalette.colors} />
      </button>
    </>
  );
}
