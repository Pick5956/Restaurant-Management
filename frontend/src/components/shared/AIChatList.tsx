"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { smoothScroll } from "@/src/hooks/smoothScroll";
import { MessageSquareText, MoreHorizontal, Pencil, Plus, Search, SquarePen, Trash2, X } from "lucide-react";
import { deleteAIConversation, listAIConversations, renameAIConversation } from "@/src/lib/ai";
import { matchesThreadQuery, notifyConversationsChanged, threadGroup, useConversationsVersion, type AIThreadGroup } from "@/src/lib/aiThreads";
import WarmConfirmDialog from "@/src/components/shared/WarmConfirmDialog";
import type { AIConversationSummary } from "@/src/types/ai";

// The chat list — one component, two shapes.
//
// On a phone (and inside the floating chat) it is a sheet that slides over
// the conversation. On a wide screen it is a card hanging off the chats
// button in the top-right corner, the same way the insights panel hangs off
// the bell — search on top, "new chat" first, then the chats by day. The
// conversation keeps the whole width either way.
//
// Renaming happens in place: the title turns into a text field on the row,
// Enter keeps it, Escape drops it, clicking elsewhere keeps it.
type Variant = "sheet" | "panel";

function copy(language: "th" | "en") {
  return language === "th"
    ? {
        title: "แชท",
        newChat: "แชทใหม่",
        search: "ค้นหาแชท",
        empty: "ยังไม่มีแชท ถามอะไรสักอย่างแล้วแชทจะมาอยู่ที่นี่",
        nothingFound: "ไม่มีแชทที่ชื่อตรงกับคำค้น",
        loadError: "โหลดรายการแชทไม่สำเร็จ",
        groups: { today: "วันนี้", yesterday: "เมื่อวาน", week: "7 วันก่อน", older: "เก่ากว่านั้น" } as Record<AIThreadGroup, string>,
        questions: (n: number) => `${n} คำถาม`,
        rename: "เปลี่ยนชื่อ",
        renameTitle: "ตั้งชื่อแชทนี้",
        renameDescription: "ชื่อที่ตั้งเองจะไม่ถูกเปลี่ยนอีก",
        renameSave: "บันทึกชื่อ",
        remove: "ลบ",
        removeTitle: "ลบแชทนี้ไหม?",
        removeDescription: "แชทจะย้ายไปถังขยะ กู้คืนได้ภายใน 7 วันจากตั้งค่าผู้ช่วย",
        removeYes: "ย้ายไปถังขยะ",
        cancel: "ยกเลิก",
        more: "ตัวเลือก",
        collapse: "ซ่อนรายการแชท",
        expand: "แสดงรายการแชท",
        close: "ปิด",
        untitled: "แชทไม่มีชื่อ",
      }
    : {
        title: "Chats",
        newChat: "New chat",
        search: "Search chats",
        empty: "No chats yet. Ask something and it will appear here.",
        nothingFound: "No chat title matches",
        loadError: "Could not load chats",
        groups: { today: "Today", yesterday: "Yesterday", week: "Previous 7 days", older: "Older" } as Record<AIThreadGroup, string>,
        questions: (n: number) => `${n} question${n === 1 ? "" : "s"}`,
        rename: "Rename",
        renameTitle: "Name this chat",
        renameDescription: "A name you choose is never overwritten",
        renameSave: "Save name",
        remove: "Delete",
        removeTitle: "Delete this chat?",
        removeDescription: "It moves to the trash and can be restored within 7 days from the assistant settings",
        removeYes: "Move to trash",
        cancel: "Cancel",
        more: "Options",
        collapse: "Hide chat list",
        expand: "Show chat list",
        close: "Close",
        untitled: "Untitled chat",
      };
}

function timeLabel(iso: string, language: "th" | "en", group: AIThreadGroup): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  if (group === "today" || group === "yesterday") {
    return at.toLocaleTimeString(language === "th" ? "th-TH" : "en-GB", { hour: "2-digit", minute: "2-digit" });
  }
  return at.toLocaleDateString(language === "th" ? "th-TH" : "en-GB", { day: "numeric", month: "short" });
}

const GROUP_ORDER: AIThreadGroup[] = ["today", "yesterday", "week", "older"];

export default function AIChatList({
  language,
  activeId,
  onOpen,
  onNew,
  variant,
  onClose,
}: {
  language: "th" | "en";
  activeId: string | null;
  /** May return false (or resolve to false) to refuse; the list then stays open. */
  onOpen: (conversationId: string) => unknown;
  onNew: () => unknown;
  variant: Variant;
  /** The close control (backdrop click and Escape use it too). */
  onClose?: () => void;
}) {
  const t = copy(language);
  const version = useConversationsVersion();
  const [conversations, setConversations] = useState<AIConversationSummary[] | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [renaming, setRenaming] = useState<AIConversationSummary | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [removing, setRemoving] = useState<AIConversationSummary | null>(null);
  const [busy, setBusy] = useState(false);
  // The "⋯" menu open on one row, if any. Closes on a click anywhere else or
  // on Escape, the way a menu is expected to.
  const [menuFor, setMenuFor] = useState<string | null>(null);
  // The sheet leaves the way it came: the close request plays the exit
  // animation first and tells the parent to unmount when it is done.
  const [closing, setClosing] = useState(false);
  const requestClose = () => {
    if (closing) return;
    setClosing(true);
    window.setTimeout(() => onClose?.(), 220);
  };
  // Picking a chat (or a new one) leaves the same way as closing. The parent
  // may still refuse — a pending action preview it could not settle — and
  // then the list comes back instead of staying invisible.
  const leaveThen = (go: () => unknown) => {
    if (closing) return;
    setClosing(true);
    window.setTimeout(async () => {
      const result = await go();
      if (result === false) setClosing(false);
    }, 200);
  };
  // The panel opens with the cursor in the search box and leaves on Escape,
  // unless a rename or the delete dialog is up — that one owns Escape then.
  const searchRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (variant !== "panel") return;
    searchRef.current?.focus();
  }, [variant]);
  useEffect(() => {
    if (variant !== "panel") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !renaming && !removing) requestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  const menuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!menuFor) return;
    const onDown = (event: MouseEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuFor(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuFor(null);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuFor]);

  const load = useCallback(() => {
    let cancelled = false;
    listAIConversations()
      .then((res) => {
        if (cancelled) return;
        setConversations(res.data.conversations ?? []);
        setError("");
      })
      .catch(() => {
        if (cancelled) return;
        setError(t.loadError);
        setConversations((current) => current ?? []);
      });
    return () => {
      cancelled = true;
    };
    // The load is keyed by version: every announced change reloads once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  useEffect(() => load(), [load]);

  const grouped = useMemo(() => {
    const now = new Date();
    const buckets: Record<AIThreadGroup, AIConversationSummary[]> = { today: [], yesterday: [], week: [], older: [] };
    for (const conversation of conversations ?? []) {
      if (!matchesThreadQuery(conversation.title || t.untitled, query)) continue;
      buckets[threadGroup(conversation.updated_at, now)].push(conversation);
    }
    return buckets;
  }, [conversations, query, t.untitled]);

  const visibleCount = GROUP_ORDER.reduce((sum, group) => sum + grouped[group].length, 0);

  const commitRename = async () => {
    if (!renaming) return;
    const title = renameDraft.trim();
    // Nothing typed, or the same name: just leave the field.
    if (!title || title === (renaming.title || "")) {
      setRenaming(null);
      return;
    }
    setBusy(true);
    try {
      await renameAIConversation(renaming.id, title);
      setConversations((current) =>
        (current ?? []).map((item) => (item.id === renaming.id ? { ...item, title, title_by_owner: true } : item)),
      );
      setRenaming(null);
      notifyConversationsChanged();
    } catch {
      setError(t.loadError);
    } finally {
      setBusy(false);
    }
  };

  const commitRemove = async () => {
    if (!removing) return;
    setBusy(true);
    try {
      await deleteAIConversation(removing.id);
      setConversations((current) => (current ?? []).filter((item) => item.id !== removing.id));
      const wasActive = removing.id === activeId;
      setRemoving(null);
      notifyConversationsChanged();
      if (wasActive) onNew();
    } catch {
      setError(t.loadError);
    } finally {
      setBusy(false);
    }
  };

  const rowButton =
    "group flex w-full items-start gap-2 rounded-xl py-2 pl-2.5 pr-9 text-left transition-colors";

  const list = (
    <div ref={smoothScroll} className="ai-scroll min-h-0 flex-1 overflow-y-auto overflow-x-visible px-2 pb-3">
      {conversations === null ? (
        <p className="px-2 py-6 text-center text-[12px] text-gray-400">…</p>
      ) : visibleCount === 0 ? (
        <p className="px-3 py-8 text-center text-[12px] leading-5 text-gray-500 dark:text-gray-400">
          {query.trim() ? t.nothingFound : t.empty}
        </p>
      ) : (
        GROUP_ORDER.map((group) =>
          grouped[group].length === 0 ? null : (
            <div key={group} className="mb-2">
              <p className="px-2.5 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-gray-400 dark:text-gray-500">
                {t.groups[group]}
              </p>
              {grouped[group].map((conversation) => {
                const active = conversation.id === activeId;
                const title = conversation.title || t.untitled;
                if (renaming?.id === conversation.id) {
                  return (
                    <div key={conversation.id} className={`${rowButton} bg-white ring-2 ring-orange-400/60 dark:bg-gray-900`}>
                      <span className="min-w-0 flex-1">
                        <input
                          type="text"
                          autoFocus
                          value={renameDraft}
                          maxLength={80}
                          disabled={busy}
                          onChange={(event) => setRenameDraft(event.target.value)}
                          onFocus={(event) => event.target.select()}
                          onBlur={() => void commitRename()}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              void commitRename();
                            } else if (event.key === "Escape") {
                              event.preventDefault();
                              event.stopPropagation();
                              setRenaming(null);
                            }
                          }}
                          aria-label={t.renameTitle}
                          className="block w-full bg-transparent text-[13px] font-medium leading-5 text-gray-900 outline-none dark:text-gray-100"
                        />
                        <span className="mt-0.5 block text-[11px] leading-4 text-gray-400 dark:text-gray-500">
                          {timeLabel(conversation.updated_at, language, group)}
                        </span>
                      </span>
                    </div>
                  );
                }
                return (
                  <div key={conversation.id} className="relative">
                    <button
                      type="button"
                      onClick={() => leaveThen(() => onOpen(conversation.id))}
                      aria-current={active ? "true" : undefined}
                      className={`${rowButton} ${
                        active
                          ? "bg-orange-50 text-orange-800 dark:bg-orange-950/30 dark:text-orange-200"
                          : variant === "panel"
                            ? "text-gray-700 hover:bg-orange-50/70 dark:text-gray-200 dark:hover:bg-gray-800/70"
                            : "text-gray-700 hover:bg-white/70 dark:text-gray-200 dark:hover:bg-gray-800/70"
                      }`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium leading-5">{title}</span>
                        <span className={`mt-0.5 block text-[11px] leading-4 ${active ? "text-orange-600/80 dark:text-orange-300/70" : "text-gray-400 dark:text-gray-500"}`}>
                          {timeLabel(conversation.updated_at, language, group)}
                        </span>
                      </span>
                    </button>
                    {/* "⋯" on every row, always visible, opening a small menu.
                        Icons that appeared only on hover were never found on a
                        phone, and not found on a desktop either. */}
                    <div ref={menuFor === conversation.id ? menuRef : undefined} className="absolute right-1 top-1.5">
                      <button
                        type="button"
                        aria-label={t.more}
                        aria-haspopup="menu"
                        aria-expanded={menuFor === conversation.id}
                        onClick={(event) => {
                          event.stopPropagation();
                          setMenuFor((current) => (current === conversation.id ? null : conversation.id));
                        }}
                        className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
                          menuFor === conversation.id
                            ? "bg-white text-gray-800 shadow-sm dark:bg-gray-800 dark:text-gray-100"
                            : active
                              ? "text-orange-600/70 hover:bg-white hover:text-orange-800 dark:text-orange-300/70 dark:hover:bg-gray-800"
                              : "text-gray-400 hover:bg-white hover:text-gray-700 dark:text-gray-500 dark:hover:bg-gray-800"
                        }`}
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                      {menuFor === conversation.id && (
                        <div
                          role="menu"
                          className="ai-chatlist-pop absolute right-0 top-8 z-20 w-40 rounded-xl border border-gray-200 bg-white p-1 shadow-lg dark:border-gray-700 dark:bg-gray-900"
                        >
                          <button
                            type="button"
                            role="menuitem"
                            onClick={(event) => {
                              event.stopPropagation();
                              setMenuFor(null);
                              setRenameDraft(conversation.title || "");
                              setRenaming(conversation);
                            }}
                            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
                          >
                            <Pencil className="h-3.5 w-3.5 text-gray-400" /> {t.rename}
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={(event) => {
                              event.stopPropagation();
                              setMenuFor(null);
                              setRemoving(conversation);
                            }}
                            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
                          >
                            <Trash2 className="h-3.5 w-3.5" /> {t.remove}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ),
        )
      )}
      {error && <p className="px-3 py-2 text-[11px] text-red-500">{error}</p>}
    </div>
  );

  const searchBox = (
    <label className="relative mx-2 mb-2 block">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" aria-hidden="true" />
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t.search}
        aria-label={t.search}
        className="h-8 w-full rounded-lg border border-gray-200 bg-white/80 pl-8 pr-2 text-[12.5px] text-gray-800 outline-none placeholder:text-gray-400 focus:border-orange-300 focus:ring-2 focus:ring-orange-500/15 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
      />
    </label>
  );

  const newChatButton = (
    <button
      type="button"
      onClick={() => leaveThen(onNew)}
      className="mx-2 mb-2 inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-orange-200 bg-white/80 text-[13px] font-semibold text-orange-700 shadow-sm transition-colors hover:bg-orange-50 dark:border-orange-900/50 dark:bg-gray-900 dark:text-orange-300 dark:hover:bg-orange-950/30"
    >
      <Plus className="h-4 w-4" /> {t.newChat}
    </button>
  );

  const dialogs = (
    <>
      <WarmConfirmDialog
        open={removing !== null}
        title={t.removeTitle}
        description={removing ? `“${removing.title || t.untitled}” — ${t.removeDescription}` : t.removeDescription}
        confirmLabel={t.removeYes}
        cancelLabel={t.cancel}
        onConfirm={() => void commitRemove()}
        onCancel={() => setRemoving(null)}
        busy={busy}
      />
    </>
  );

  if (variant === "panel") {
    return (
      <div className={closing ? "ai-chatlist-panel-out" : "ai-chatlist-panel-in"}>
        {/* Clicking anywhere else closes the card, the way a popover behaves. */}
        <div className="ai-chatlist-backdrop fixed inset-0 z-30" onClick={requestClose} aria-hidden="true" />
        <div
          role="dialog"
          aria-label={t.title}
          className="ai-chatlist-card absolute right-3 top-14 z-40 flex max-h-[min(32rem,calc(100%-4.5rem))] w-[380px] origin-top-right flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl shadow-gray-950/20 dark:border-gray-800 dark:bg-gray-900"
        >
          <div className="flex items-center gap-2.5 border-b border-gray-100 px-3.5 dark:border-gray-800">
            <Search className="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t.search}
              aria-label={t.search}
              className="h-12 min-w-0 flex-1 bg-transparent text-[14px] text-gray-900 outline-none placeholder:text-gray-400 dark:text-gray-100"
            />
            <button
              type="button"
              onClick={requestClose}
              aria-label={t.close}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="px-2 pt-2">
            <button
              type="button"
              onClick={() => leaveThen(onNew)}
              className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left text-[13px] font-medium text-gray-800 transition-colors hover:bg-orange-50/70 dark:text-gray-100 dark:hover:bg-gray-800/70"
            >
              <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-orange-100 text-orange-600 dark:bg-orange-950/40 dark:text-orange-300">
                <SquarePen className="h-3.5 w-3.5" />
              </span>
              {t.newChat}
            </button>
          </div>
          {list}
          {dialogs}
        </div>
      </div>
    );
  }

  // Phones: the whole screen, above the menu tab (z-30) so the tab does not sit
  // on the title. It was absolute inside the chat's padded box, which left
  // bands of the page showing on three sides (19 ก.ย. 2569). Portalled to
  // body: the AI page's .ai-aura-bg isolates its children, so a z-index set
  // in there could never rise above the tab.
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className={`fixed inset-0 z-40 flex flex-col bg-[#faf8f2] pb-[env(safe-area-inset-bottom)] dark:bg-gray-900 ${closing ? "ai-chatlist-sheet-out" : "ai-chatlist-sheet-in"}`}>
      <div className="flex items-center justify-between px-3 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold text-gray-900 dark:text-white">
          <MessageSquareText className="h-4 w-4 text-orange-500" /> {t.title}
        </h2>
        <button
          type="button"
          onClick={requestClose}
          aria-label={t.close}
          className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-gray-200/80 bg-white/80 text-gray-600 shadow-sm dark:border-gray-800/80 dark:bg-gray-800/70 dark:text-gray-300"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {newChatButton}
      {searchBox}
      {list}
      {dialogs}
    </div>,
    document.body,
  );
}
