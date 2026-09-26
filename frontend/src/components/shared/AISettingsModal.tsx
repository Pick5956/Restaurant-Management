"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bell, Check, ChevronLeft, ChevronRight, Loader2, RotateCcw, Search, SlidersHorizontal, Trash2, Wand2, X } from "lucide-react";
import {
  AI_ACTION_TYPES,
  deleteAllAIConversations,
  getAISettings,
  listAIConversations,
  purgeAIConversation,
  purgeAllTrashedAIConversations,
  restoreAIConversation,
  updateAISettings,
  type AIActionType,
  type AIInsightKind,
  type AISettingsPatch,
  type AISettingsView,
} from "@/src/lib/ai";
import type { AIConversationSummary } from "@/src/types/ai";
import { cacheOwnerTitle, useFollowUpsSetting } from "@/src/lib/aiPrefs";
import { notifyConversationsChanged } from "@/src/lib/aiThreads";
import { FLASH_CLASSES, Group, Note, Row, Switch } from "@/src/components/shared/settingsModalKit";

// The assistant's settings, in sections.
//
// This began as one switch in a dialog with a one-item sidebar, and its copy
// named things the way the code does ("การลงมือทำ"). It is now three sections
// the way Claude's and ChatGPT's settings are laid out — what the assistant
// calls you, what it may change, what it tells you about — with every row a
// short name and one real example sentence. Switches save the moment they are
// flipped; there is no Save button to forget.
//
// Everything on screen has something real behind it. Rows that would have been
// switches for features that do not exist yet were cut rather than shown dead.

type SectionKey = "general" | "actions" | "notifications";

// The bell's five kinds are four rows: a sales drop and a sales rise are one
// thing to the owner ("ยอดขายเปลี่ยนผิดปกติ").
type InsightRow = { id: string; kinds: AIInsightKind[]; th: [string, string]; en: [string, string] };
const INSIGHT_ROWS: InsightRow[] = [
  { id: "ingredient_low", kinds: ["ingredient_low"], th: ["วัตถุดิบใกล้หมด", "ต่ำกว่าขั้นต่ำที่ตั้งไว้"], en: ["Ingredient running low", "Under the minimum you set"] },
  { id: "dead_stock", kinds: ["dead_stock"], th: ["ของค้างสต๊อก", "ไม่ได้ใช้เลยใน 30 วัน"], en: ["Dead stock", "Unused for 30 days"] },
  { id: "sales_change", kinds: ["sales_drop", "sales_up"], th: ["ยอดขายเปลี่ยนผิดปกติ", "7 วันล่าสุด เทียบ 7 วันก่อน"], en: ["Unusual sales change", "Last 7 days against the 7 before"] },
  { id: "plowhorse", kinds: ["plowhorse"], th: ["เมนูขายดีแต่กำไรน้อย", "สั่งบ่อยแต่ทำเงินน้อย"], en: ["Popular but low-margin menu", "Ordered often, earns little"] },
];

type ActionRow = { type: AIActionType; group: "menu" | "ingredients" | "money"; th: [string, string]; en: [string, string] };
const ACTION_ROWS: ActionRow[] = [
  { type: "set_menu_availability", group: "menu", th: ["เปิด–ปิดขายเมนู", "“ปิดขายต้มยำกุ้งวันนี้”"], en: ["Open or close a menu item", "“Close Tom Yum Kung for today”"] },
  { type: "set_menu_price", group: "menu", th: ["เปลี่ยนราคาเมนู", "“ขึ้นราคาผัดไทยเป็น 95 บาท”"], en: ["Change a menu price", "“Raise Pad Thai to 95 baht”"] },
  { type: "create_menu_item", group: "menu", th: ["เพิ่มเมนูใหม่", "“เพิ่มเมนูข้าวผัดปู ราคา 120 หมวดข้าว”"], en: ["Add a new menu item", "“Add crab fried rice, 120 baht, in Rice”"] },
  { type: "adjust_ingredient_stock", group: "ingredients", th: ["ปรับจำนวนสต๊อก", "“รับหมูสับเข้ามา 5 กิโล”"], en: ["Adjust stock", "“Received 5 kg of minced pork”"] },
  { type: "set_ingredient_min_stock", group: "ingredients", th: ["ตั้งสต๊อกขั้นต่ำ", "“ตั้งขั้นต่ำกะเพราไว้ 2 กิโล”"], en: ["Set a minimum stock", "“Set holy basil minimum to 2 kg”"] },
  { type: "set_ingredient_cost", group: "ingredients", th: ["ตั้งต้นทุนต่อหน่วย", "“ไข่ไก่ตอนนี้ฟองละ 4.50”"], en: ["Set a unit cost", "“Eggs are 4.50 each now”"] },
  { type: "create_ingredient", group: "ingredients", th: ["เพิ่มวัตถุดิบใหม่", "“เพิ่มวัตถุดิบ เห็ดออรินจิ หน่วยเป็นกิโล”"], en: ["Add a new ingredient", "“Add king oyster mushroom, in kg”"] },
  { type: "create_expense", group: "money", th: ["บันทึกรายจ่าย", "“จ่ายค่าแก๊สไป 1,200” หรือถ่ายรูปใบเสร็จส่งให้"], en: ["Record an expense", "“Paid 1,200 for gas”, or send a receipt photo"] },
];

function copy(language: "th" | "en") {
  return language === "th"
    ? {
        settings: "ตั้งค่า Dishy AI",
        close: "ปิด",
        back: "กลับ",
        saved: "บันทึกแล้ว",
        saving: "กำลังบันทึก",
        loadError: "โหลดการตั้งค่าไม่สำเร็จ",
        saveError: "บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง",
        sections: {
          general: { name: "ทั่วไป", blurb: "ชื่อที่เรียกคุณ · คำถามแนะนำ · ประวัติแชท" },
          actions: { name: "สิ่งที่ทำแทนคุณได้", blurb: "เลือกว่าแก้อะไรได้บ้าง" },
          notifications: { name: "การแจ้งเตือน", blurb: "ของใกล้หมด · ของค้าง · ยอดขายผิดปกติ" },
        },
        groupAnswers: "การตอบ",
        titleLabel: "ชื่อที่ผู้ช่วยใช้เรียกคุณ",
        titleHint: "เว้นว่าง = “คุณผู้จัดการ”",
        titlePlaceholder: "คุณผู้จัดการ",
        followUps: "คำถามแนะนำใต้คำตอบ",
        followUpsHint: "2–3 ข้อหลังแต่ละคำตอบ · เฉพาะเครื่องนี้",
        groupHistory: "ประวัติแชท",
        clearAll: "ย้ายทุกแชทลงถังขยะ",
        clearAllHint: "กู้คืนได้ใน 7 วัน",
        clearButton: "ล้างรายการ…",
        clearConfirm: "ย้ายทั้งหมดลงถังขยะ",
        clearCancel: "ไม่ย้าย",
        cleared: "ย้ายแล้ว",
        trash: "ถังขยะ",
        trashHint: "เก็บ 7 วัน แล้วลบถาวร",
        trashOpen: "ดูถังขยะ",
        trashClose: "ซ่อนถังขยะ",
        trashEmpty: "ถังขยะว่าง",
        trashLoadError: "โหลดถังขยะไม่สำเร็จ",
        restore: "กู้คืน",
        purge: "ลบถาวร",
        purgeAll: "ลบถาวรทั้งหมด",
        purgeAllConfirm: "ลบถาวรทุกแชทในถังขยะ",
        purgeAllCancel: "ยังก่อน",
        purgeIn: (days: number) => (days <= 0 ? "จะถูกลบถาวรวันนี้" : `จะถูกลบถาวรในอีก ${days} วัน`),
        untitled: "แชทไม่มีชื่อ",
        master: "ให้ผู้ช่วยแก้ข้อมูลร้านได้",
        masterHint: "ปิด = ดูข้อมูลได้อย่างเดียว",
        unavailable: "ระบบกลางปิดความสามารถนี้อยู่ ยังใช้ไม่ได้",
        groupMenu: "เมนู",
        groupIngredients: "วัตถุดิบ",
        groupMoney: "การเงิน",
        confirmNote: "ทุกคำสั่งรอเจ้าของร้านกดยืนยันภายใน 1 นาที",
        groupStock: "วัตถุดิบ",
        groupSales: "ยอดขายและเมนู",
        bellNote: "ขึ้นที่กระดิ่งมุมขวาบน เฉพาะตอนเปิดแอป",
        search: "ค้นหาการตั้งค่า",
        searchEmpty: (q: string) => `ไม่พบการตั้งค่าที่ตรงกับ “${q}”`,
      }
    : {
        settings: "Dishy AI settings",
        close: "Close",
        back: "Back",
        saved: "Saved",
        saving: "Saving",
        loadError: "Could not load settings",
        saveError: "Could not save, try again",
        sections: {
          general: { name: "General", blurb: "What it calls you · suggestions · chat history" },
          actions: { name: "What it can do for you", blurb: "Choose what it may change" },
          notifications: { name: "Notifications", blurb: "Low stock · dead stock · unusual sales" },
        },
        groupAnswers: "Answers",
        titleLabel: "What the assistant calls you",
        titleHint: "Empty = “Manager”",
        titlePlaceholder: "Manager",
        followUps: "Follow-up suggestions under answers",
        followUpsHint: "2–3 after each answer · this device only",
        groupHistory: "Chat history",
        clearAll: "Move every chat to the trash",
        clearAllHint: "Restorable for 7 days",
        clearButton: "Clear list…",
        clearConfirm: "Move all to trash",
        clearCancel: "Keep",
        cleared: "Moved",
        trash: "Trash",
        trashHint: "Kept 7 days, then deleted",
        trashOpen: "Show trash",
        trashClose: "Hide trash",
        trashEmpty: "The trash is empty",
        trashLoadError: "Could not load the trash",
        restore: "Restore",
        purge: "Delete now",
        purgeAll: "Delete all now",
        purgeAllConfirm: "Delete every chat in the trash",
        purgeAllCancel: "Not yet",
        purgeIn: (days: number) => (days <= 0 ? "removed for good today" : `removed for good in ${days} day${days === 1 ? "" : "s"}`),
        untitled: "Untitled chat",
        master: "Let the assistant change shop data",
        masterHint: "Off = read only",
        unavailable: "Turned off system-wide for now",
        groupMenu: "Menu",
        groupIngredients: "Ingredients",
        groupMoney: "Money",
        confirmNote: "Every command waits 1 minute for the owner to confirm",
        groupStock: "Ingredients",
        groupSales: "Sales and menu",
        bellNote: "On the bell, top right, while the app is open",
        search: "Search settings",
        searchEmpty: (q: string) => `No settings match “${q}”`,
      };
}

const SECTION_ICONS: Record<SectionKey, typeof Wand2> = { general: SlidersHorizontal, actions: Wand2, notifications: Bell };
const SECTION_ORDER: SectionKey[] = ["general", "actions", "notifications"];

type SearchEntry = { id: string; section: SectionKey; label: string; hint: string };

/** Every setting on every section, for the search box (26 ก.ย. 2569). */
function searchIndex(t: ReturnType<typeof copy>, language: "th" | "en"): SearchEntry[] {
  const pick = (pair: { th: [string, string]; en: [string, string] }) => (language === "th" ? pair.th : pair.en);
  return [
    { id: "owner_title", section: "general", label: t.titleLabel, hint: `${t.titleHint} ${t.groupAnswers}` },
    { id: "follow_ups", section: "general", label: t.followUps, hint: `${t.followUpsHint} ${t.groupAnswers}` },
    { id: "clear_all", section: "general", label: t.clearAll, hint: `${t.clearAllHint} ${t.groupHistory}` },
    { id: "trash", section: "general", label: t.trash, hint: `${t.trashHint} ${t.groupHistory}` },
    { id: "master", section: "actions", label: t.master, hint: t.masterHint },
    ...ACTION_ROWS.map((row) => {
      const [label, example] = pick(row);
      const group = row.group === "menu" ? t.groupMenu : row.group === "ingredients" ? t.groupIngredients : t.groupMoney;
      return { id: row.type, section: "actions" as const, label, hint: `${group} ${example}` };
    }),
    ...INSIGHT_ROWS.map((row) => {
      const [label, hint] = pick(row);
      return { id: row.id, section: "notifications" as const, label, hint };
    }),
  ];
}

/** Every word typed must appear somewhere in the setting's name, note or section. */
function matchesSearch(entry: SearchEntry, sectionName: string, query: string) {
  const haystack = `${entry.label} ${entry.hint} ${sectionName}`.toLowerCase();
  return query.toLowerCase().split(/\s+/).filter(Boolean).every((word) => haystack.includes(word));
}

export default function AISettingsModal({
  open,
  onClose,
  language,
  onConversationsCleared,
}: {
  open: boolean;
  onClose: () => void;
  language: "th" | "en";
  /** Called after the owner clears every conversation, so the open chat resets too. */
  onConversationsCleared?: () => void;
}) {
  const t = copy(language);

  // Leaving plays the exit first, then tells the parent to unmount — the same
  // way the chat list closes (19 ก.ย. 2569: it had snapped open and shut).
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    if (open) setClosing(false);
  }, [open]);
  const requestClose = () => {
    if (closing) return;
    setClosing(true);
    window.setTimeout(() => {
      onClose();
      // Cleared here, not on the next open: the component stays mounted while
      // shut, so a flag left set made the next open paint one frame of the
      // exit animation (card on screen, then fading) before the entrance
      // replaced it — the blink when the settings opened.
      setClosing(false);
    }, 200);
  };

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [view, setView] = useState<AISettingsView | null>(null);
  // "saving" and "saved" are shown by the header for a moment after each change.
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const savedTimer = useRef<number | null>(null);

  // Desktop shows the sidebar and one section; a phone shows the section list
  // first and drills in. One piece of state serves both: on desktop it is
  // always a section, on a phone null means "the list".
  const [section, setSection] = useState<SectionKey | null>("actions");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [query, setQuery] = useState("");
  // The setting a search result opened, to scroll to and light once it renders.
  const [jumpTo, setJumpTo] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const [followUps, setFollowUps] = useFollowUpsSetting();
  const [titleDraft, setTitleDraft] = useState("");
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearedCount, setClearedCount] = useState<number | null>(null);
  // The trash: read when opened, kept in step with every restore or purge.
  const [trashOpen, setTrashOpen] = useState(false);
  const [trash, setTrash] = useState<AIConversationSummary[] | null>(null);
  const [trashError, setTrashError] = useState("");
  const [trashBusyId, setTrashBusyId] = useState<string | null>(null);
  const [confirmPurgeAll, setConfirmPurgeAll] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError("");
    // A spinner only when there is nothing to show yet. On later opens the
    // settings from last time stay on screen while they refresh, instead of
    // flashing old settings → spinner → settings.
    setLoading((current) => current || view === null);
    setConfirmClear(false);
    setClearedCount(null);
    setMobileOpen(false);
    setTrashOpen(false);
    setTrash(null);
    setTrashError("");
    setConfirmPurgeAll(false);
    setQuery("");
    getAISettings()
      .then((res) => {
        setView(res.data);
        setTitleDraft(res.data.owner_title === t.titlePlaceholder ? "" : res.data.owner_title);
        cacheOwnerTitle(res.data.owner_title === t.titlePlaceholder ? "" : res.data.owner_title);
      })
      .catch(() => setError(t.loadError))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => () => {
    if (savedTimer.current) window.clearTimeout(savedTimer.current);
  }, []);

  // After a search result switches section, bring its row into view and light
  // it. A frame later, so the section it is in has rendered.
  useEffect(() => {
    if (!jumpTo) return;
    const frame = requestAnimationFrame(() => {
      const row = cardRef.current?.querySelector<HTMLElement>(`[data-setting-id="${jumpTo}"]`);
      setJumpTo(null);
      if (!row) return;
      row.scrollIntoView({ block: "center", behavior: "smooth" });
      row.classList.add(...FLASH_CLASSES);
      // Its own timer, not this effect's cleanup: clearing jumpTo re-runs the
      // effect, and a cleanup that cancelled this left the row lit for good.
      window.setTimeout(() => row.classList.remove(...FLASH_CLASSES), 1600);
    });
    return () => cancelAnimationFrame(frame);
  }, [jumpTo, section, mobileOpen, view]);

  if (!open || typeof document === "undefined") return null;

  // Every switch saves on its own. The screen updates first and the request
  // follows; on failure the previous view comes back and the header says so.
  const apply = async (patch: AISettingsPatch, optimistic: (current: AISettingsView) => AISettingsView) => {
    if (!view) return;
    const previous = view;
    setView(optimistic(view));
    setSaveState("saving");
    try {
      const res = await updateAISettings(patch);
      setView(res.data);
      if (patch.owner_title !== undefined) {
        cacheOwnerTitle(res.data.owner_title === t.titlePlaceholder ? "" : res.data.owner_title);
      }
      setSaveState("saved");
      if (savedTimer.current) window.clearTimeout(savedTimer.current);
      savedTimer.current = window.setTimeout(() => setSaveState("idle"), 1600);
    } catch {
      setView(previous);
      setSaveState("error");
    }
  };

  const commitTitle = () => {
    if (!view) return;
    const next = titleDraft.trim();
    const current = view.owner_title === t.titlePlaceholder ? "" : view.owner_title;
    if (next === current) return;
    void apply({ owner_title: next }, (v) => ({ ...v, owner_title: next || t.titlePlaceholder }));
  };

  const loadTrash = async () => {
    try {
      const res = await listAIConversations(true);
      setTrash(res.data.conversations ?? []);
      setTrashError("");
    } catch {
      setTrash((current) => current ?? []);
      setTrashError(t.trashLoadError);
    }
  };

  const openTrash = () => {
    setTrashOpen((open) => !open);
    if (trash === null) void loadTrash();
  };

  const clearAll = async () => {
    setClearing(true);
    try {
      const res = await deleteAllAIConversations();
      setClearedCount(res.data.deleted);
      setConfirmClear(false);
      notifyConversationsChanged();
      if (trashOpen) void loadTrash();
      onConversationsCleared?.();
    } catch {
      setSaveState("error");
    } finally {
      setClearing(false);
    }
  };

  const restoreOne = async (conversation: AIConversationSummary) => {
    setTrashBusyId(conversation.id);
    try {
      await restoreAIConversation(conversation.id);
      setTrash((current) => (current ?? []).filter((item) => item.id !== conversation.id));
      notifyConversationsChanged();
    } catch {
      setTrashError(t.trashLoadError);
    } finally {
      setTrashBusyId(null);
    }
  };

  const purgeOne = async (conversation: AIConversationSummary) => {
    setTrashBusyId(conversation.id);
    try {
      await purgeAIConversation(conversation.id);
      setTrash((current) => (current ?? []).filter((item) => item.id !== conversation.id));
    } catch {
      setTrashError(t.trashLoadError);
    } finally {
      setTrashBusyId(null);
    }
  };

  const purgeAll = async () => {
    setTrashBusyId("*");
    try {
      await purgeAllTrashedAIConversations();
      setTrash([]);
      setConfirmPurgeAll(false);
    } catch {
      setTrashError(t.trashLoadError);
    } finally {
      setTrashBusyId(null);
    }
  };

  // Days left before the sweep removes a trashed chat for good.
  const daysUntilPurge = (trashedAt?: string | null) => {
    if (!trashedAt) return 7;
    const elapsed = (Date.now() - new Date(trashedAt).getTime()) / (24 * 60 * 60 * 1000);
    return Math.max(0, Math.ceil(7 - elapsed));
  };

  const actionsOn = Boolean(view?.actions_enabled);
  const activeSection: SectionKey = section ?? "actions";
  const SectionIcon = SECTION_ICONS[activeSection];

  const renderSection = () => {
    if (!view) return null;
    if (activeSection === "general") {
      return (
        <>
          <Group title={t.groupAnswers}>
            <Row id="owner_title" label={t.titleLabel} hint={t.titleHint}>
              <input
                type="text"
                value={titleDraft}
                maxLength={40}
                placeholder={t.titlePlaceholder}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={commitTitle}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                }}
                className="h-8 w-44 shrink-0 rounded-lg border border-gray-200 bg-white px-3 text-[16px] text-gray-800 sm:text-[12.5px] outline-none placeholder:text-gray-400 focus:border-orange-300 focus:ring-2 focus:ring-orange-500/15 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
              />
            </Row>
            <Row id="follow_ups" label={t.followUps} hint={t.followUpsHint}>
              <Switch on={followUps} onChange={setFollowUps} label={t.followUps} />
            </Row>
          </Group>
          <Group title={t.groupHistory}>
            <Row id="clear_all" label={t.clearAll} hint={confirmClear ? undefined : t.clearAllHint}>
              {clearedCount !== null ? (
                <span className="inline-flex items-center gap-1 text-[12px] font-medium text-emerald-600 dark:text-emerald-400">
                  <Check className="h-3.5 w-3.5" /> {t.cleared}
                </span>
              ) : confirmClear ? (
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setConfirmClear(false)}
                    disabled={clearing}
                    className="h-8 rounded-lg px-3 text-[12.5px] font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                  >
                    {t.clearCancel}
                  </button>
                  <button
                    type="button"
                    onClick={clearAll}
                    disabled={clearing}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-red-600 px-3 text-[12.5px] font-semibold text-white hover:bg-red-700 disabled:opacity-60"
                  >
                    {clearing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    {t.clearConfirm}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmClear(true)}
                  className="h-8 shrink-0 rounded-lg border border-red-200 bg-white px-3 text-[12.5px] font-medium text-red-600 hover:bg-red-50 dark:border-red-900/50 dark:bg-gray-900 dark:text-red-400 dark:hover:bg-red-950/30"
                >
                  {t.clearButton}
                </button>
              )}
            </Row>
            <Row id="trash" label={t.trash} hint={t.trashHint}>
              <button
                type="button"
                onClick={openTrash}
                className="h-8 shrink-0 rounded-lg border border-gray-200 bg-white px-3 text-[12.5px] font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800"
              >
                {trashOpen ? t.trashClose : t.trashOpen}
                {trash && trash.length > 0 ? ` (${trash.length})` : ""}
              </button>
            </Row>
          </Group>
          {trashOpen && (
            <div className="flex shrink-0 flex-col overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
              {trash === null ? (
                <p className="px-4 py-5 text-center text-[12px] text-gray-400">…</p>
              ) : trash.length === 0 ? (
                <p className="px-4 py-5 text-center text-[12px] text-gray-500 dark:text-gray-400">{t.trashEmpty}</p>
              ) : (
                <>
                  {trash.map((conversation) => (
                    <div
                      key={conversation.id}
                      className="flex items-center justify-between gap-3 border-t border-gray-100 px-3 py-2.5 first:border-t-0 dark:border-gray-800"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-medium text-gray-800 dark:text-gray-100">{conversation.title || t.untitled}</p>
                        <p className="mt-0.5 text-[11.5px] text-gray-500 dark:text-gray-400">{t.purgeIn(daysUntilPurge(conversation.trashed_at))}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => void restoreOne(conversation)}
                          disabled={trashBusyId !== null}
                          aria-label={t.restore}
                          title={t.restore}
                          className="inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-[12px] font-medium text-orange-700 hover:bg-orange-50 disabled:opacity-50 dark:text-orange-300 dark:hover:bg-orange-950/30"
                        >
                          <RotateCcw className="h-3.5 w-3.5" /> {t.restore}
                        </button>
                        <button
                          type="button"
                          onClick={() => void purgeOne(conversation)}
                          disabled={trashBusyId !== null}
                          aria-label={t.purge}
                          title={t.purge}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-950/30"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                  <div className="flex items-center justify-end gap-1.5 border-t border-gray-100 bg-gray-50 px-3 py-2 dark:border-gray-800 dark:bg-gray-900/60">
                    {confirmPurgeAll ? (
                      <>
                        <button
                          type="button"
                          onClick={() => setConfirmPurgeAll(false)}
                          disabled={trashBusyId !== null}
                          className="h-8 rounded-lg px-3 text-[12.5px] font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                        >
                          {t.purgeAllCancel}
                        </button>
                        <button
                          type="button"
                          onClick={() => void purgeAll()}
                          disabled={trashBusyId !== null}
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-red-600 px-3 text-[12.5px] font-semibold text-white hover:bg-red-700 disabled:opacity-60"
                        >
                          {trashBusyId === "*" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                          {t.purgeAllConfirm}
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmPurgeAll(true)}
                        disabled={trashBusyId !== null}
                        className="h-8 rounded-lg border border-red-200 bg-white px-3 text-[12.5px] font-medium text-red-600 hover:bg-red-50 dark:border-red-900/50 dark:bg-gray-900 dark:text-red-400 dark:hover:bg-red-950/30"
                      >
                        {t.purgeAll}
                      </button>
                    )}
                  </div>
                </>
              )}
              {trashError && <p className="px-3 py-2 text-[11px] text-red-500">{trashError}</p>}
            </div>
          )}
        </>
      );
    }
    if (activeSection === "actions") {
      const groups: { key: ActionRow["group"]; title: string }[] = [
        { key: "menu", title: t.groupMenu },
        { key: "ingredients", title: t.groupIngredients },
        { key: "money", title: t.groupMoney },
      ];
      return (
        <>
          <div data-setting-id="master" className="flex items-center justify-between gap-4 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3.5 dark:border-orange-900/50 dark:bg-orange-950/25">
            <div className="min-w-0">
              <p className="text-[13px] font-medium leading-[18px] text-orange-900 dark:text-orange-200">{t.master}</p>
              <p className="mt-0.5 text-[11.5px] leading-4 text-orange-700 dark:text-orange-300/80">{t.masterHint}</p>
            </div>
            <Switch
              on={actionsOn}
              label={t.master}
              onChange={(next) => apply({ actions_enabled: next }, (v) => ({ ...v, actions_enabled: next }))}
            />
          </div>
          {!view.feature_available && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
              {t.unavailable}
            </p>
          )}
          {groups.map((group) => (
            <Group key={group.key} title={group.title}>
              {ACTION_ROWS.filter((row) => row.group === group.key).map((row) => {
                // The name alone: the example line under each one ("เช่น …") was
                // taken out on 19 ก.ย. 2569 at the owner's request.
                const [label] = language === "th" ? row.th : row.en;
                return (
                  <Row key={row.type} id={row.type} label={label}>
                    <Switch
                      on={view.action_types[row.type] !== false}
                      disabled={!actionsOn}
                      label={label}
                      onChange={(next) =>
                        apply({ action_types: { [row.type]: next } }, (v) => ({ ...v, action_types: { ...v.action_types, [row.type]: next } }))
                      }
                    />
                  </Row>
                );
              })}
            </Group>
          ))}
          <Note>{t.confirmNote}</Note>
        </>
      );
    }
    return (
      <>
        <Group title={t.groupStock}>
          {INSIGHT_ROWS.filter((row) => row.id === "ingredient_low" || row.id === "dead_stock").map((row) => renderInsightRow(row))}
        </Group>
        <Group title={t.groupSales}>
          {INSIGHT_ROWS.filter((row) => row.id === "sales_change" || row.id === "plowhorse").map((row) => renderInsightRow(row))}
        </Group>
        <Note>{t.bellNote}</Note>
      </>
    );
  };

  const renderInsightRow = (row: InsightRow) => {
    if (!view) return null;
    const [label, hint] = language === "th" ? row.th : row.en;
    const on = row.kinds.every((kind) => view.insight_kinds[kind] !== false);
    return (
      <Row key={row.id} id={row.id} label={label} hint={hint}>
        <Switch
          on={on}
          label={label}
          onChange={(next) => {
            const patch: Partial<Record<AIInsightKind, boolean>> = {};
            for (const kind of row.kinds) patch[kind] = next;
            void apply({ insight_kinds: patch }, (v) => ({ ...v, insight_kinds: { ...v.insight_kinds, ...patch } }));
          }}
        />
      </Row>
    );
  };

  const saveBadge =
    saveState === "saving" ? (
      <span className="inline-flex items-center gap-1 text-[11px] text-gray-400"><Loader2 className="h-3 w-3 animate-spin" /> {t.saving}</span>
    ) : saveState === "saved" ? (
      <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400"><Check className="h-3 w-3" /> {t.saved}</span>
    ) : saveState === "error" ? (
      <span className="text-[11px] text-red-500">{t.saveError}</span>
    ) : null;

  const trimmedQuery = query.trim();
  const results = trimmedQuery
    ? searchIndex(t, language).filter((entry) => matchesSearch(entry, t.sections[entry.section].name, trimmedQuery))
    : [];
  const openResult = (entry: SearchEntry) => {
    setSection(entry.section);
    setMobileOpen(true);
    setQuery("");
    setJumpTo(entry.id);
  };
  const searchBox = (
    <div role="search" className="relative">
      <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && results[0]) openResult(results[0]);
          if (e.key === "Escape" && query) {
            e.stopPropagation();
            setQuery("");
          }
        }}
        placeholder={t.search}
        aria-label={t.search}
        className="h-9 w-full rounded-lg border border-gray-200 bg-white pl-8 pr-2.5 text-[16px] text-gray-800 outline-none placeholder:text-gray-400 focus:border-orange-300 focus:ring-2 focus:ring-orange-500/15 sm:text-[13px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 [&::-webkit-search-cancel-button]:hidden"
      />
    </div>
  );
  // What the search found, each with the section it lives in. Pressing Enter
  // opens the first.
  const searchResults = (
    <div className="flex flex-col gap-0.5">
      {results.length === 0 ? (
        <p className="px-2.5 py-3 text-[12px] leading-5 text-gray-500 dark:text-gray-400">{t.searchEmpty(trimmedQuery)}</p>
      ) : (
        results.map((entry) => {
          const Icon = SECTION_ICONS[entry.section];
          return (
            <button
              key={entry.id}
              type="button"
              onClick={() => openResult(entry)}
              className="flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              <Icon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
              <span className="min-w-0">
                <span className="block text-[13px] font-medium leading-[18px] text-gray-800 dark:text-gray-100">{entry.label}</span>
                <span className="block text-[11.5px] leading-4 text-gray-500 dark:text-gray-400">{t.sections[entry.section].name}</span>
              </span>
            </button>
          );
        })
      )}
    </div>
  );

  const sectionNav = (
    <>
      {SECTION_ORDER.map((key) => {
        const Icon = SECTION_ICONS[key];
        const active = key === activeSection;
        return (
          <button
            key={key}
            type="button"
            onClick={() => setSection(key)}
            className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium transition-colors ${
              active
                ? "bg-orange-50 text-orange-700 dark:bg-orange-950/30 dark:text-orange-300"
                : "text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
            }`}
          >
            <Icon className="h-4 w-4 shrink-0" /> {t.sections[key].name}
          </button>
        );
      })}
    </>
  );

  // Portalled to <body>. The AI page's root isolates its stacking context (for
  // the aura layers), so a dialog rendered inside it can never rise above the
  // phone's top bar no matter its z-index — on a phone the header with the
  // back button sat under that bar and the sheet could not be left.
  return createPortal(
    <div
      className={`${closing ? "ai-settings-out" : "ai-settings-in"} fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-0 sm:p-4`}
      onClick={requestClose}
    >
      <div aria-hidden="true" className="ai-settings-backdrop absolute inset-0 bg-black/50" />
      <div
        role="dialog"
        aria-modal="true"
        // No title on screen (the owner cut it, 26 ก.ย. 2569) - the section
        // names say where you are - so the window's name is given here.
        aria-label={t.settings}
        ref={cardRef}
        className="ai-settings-card relative flex h-full w-full overflow-hidden bg-white shadow-xl dark:bg-gray-950 sm:h-[560px] sm:max-h-[85vh] sm:max-w-3xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Desktop sidebar */}
        <aside className="hidden w-52 shrink-0 flex-col gap-0.5 border-r border-gray-200 bg-gray-50 p-3 pt-4 dark:border-gray-800 dark:bg-gray-900/50 sm:flex">
          <div className="mb-2">{searchBox}</div>
          {trimmedQuery ? searchResults : sectionNav}
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Phone: the section list, until a section is opened */}
          {!mobileOpen && (
            <div className="flex min-h-0 flex-1 flex-col sm:hidden">
              <header className="flex items-center justify-end border-b border-gray-200 px-4 pb-3 pt-[max(1rem,env(safe-area-inset-top))] dark:border-gray-800">
                <button onClick={requestClose} aria-label={t.close} className="flex h-9 w-9 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
                  <X className="h-5 w-5" />
                </button>
              </header>
              <div className="min-h-0 flex-1 overflow-y-auto bg-gray-50 p-4 dark:bg-gray-950">
                <div className="mb-3">{searchBox}</div>
                {trimmedQuery ? (
                  <div className="overflow-hidden rounded-[14px] border border-gray-200 bg-white p-1 dark:border-gray-800 dark:bg-gray-900">{searchResults}</div>
                ) : (
                <div className="flex flex-col overflow-hidden rounded-[14px] border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
                  {SECTION_ORDER.map((key) => {
                    const Icon = SECTION_ICONS[key];
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => {
                          setSection(key);
                          setMobileOpen(true);
                        }}
                        className="flex min-h-16 items-center gap-3.5 border-t border-gray-100 px-4 py-3 text-left first:border-t-0 active:bg-gray-50 dark:border-gray-800 dark:active:bg-gray-800"
                      >
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-orange-50 text-orange-700 dark:bg-orange-950/30 dark:text-orange-300">
                          <Icon className="h-[18px] w-[18px]" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[15px] font-medium leading-5 text-gray-800 dark:text-gray-100">{t.sections[key].name}</span>
                          <span className="mt-0.5 block text-[12px] leading-4 text-gray-500 dark:text-gray-400">{t.sections[key].blurb}</span>
                        </span>
                        <ChevronRight className="h-[18px] w-[18px] shrink-0 text-gray-300 dark:text-gray-600" />
                      </button>
                    );
                  })}
                </div>
                )}
              </div>
            </div>
          )}

          {/* The section itself: always on desktop, after a tap on a phone */}
          <div className={`${mobileOpen ? "flex" : "hidden"} relative min-h-0 flex-1 flex-col sm:flex`}>
            {/* No section title (the owner cut every title, 26 ก.ย. 2569): the
                highlighted entry in the list already says which section this
                is. A phone keeps the bar for its back button. A computer has a
                plain band across the top holding the close control, as in
                Claude's settings: the section scrolls up under it and fades
                out at its lower edge instead of running into the corner. */}
            <header className="flex items-center justify-between gap-3 border-b border-gray-200 px-4 pb-3 pt-[max(1rem,env(safe-area-inset-top))] dark:border-gray-800 sm:absolute sm:inset-x-0 sm:top-0 sm:z-10 sm:h-14 sm:justify-end sm:border-0 sm:bg-white sm:px-4 sm:py-0 sm:dark:bg-gray-950 sm:after:pointer-events-none sm:after:absolute sm:after:inset-x-0 sm:after:top-full sm:after:h-5 sm:after:bg-gradient-to-b sm:after:from-white sm:after:to-transparent sm:after:content-[''] sm:dark:after:from-gray-950">
              <div className="flex min-w-0 items-center gap-2 sm:hidden">
                <button
                  type="button"
                  onClick={() => setMobileOpen(false)}
                  aria-label={`${t.back} · ${t.sections[activeSection].name}`}
                  className="-ml-1 flex items-center gap-1.5 rounded-md p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
                >
                  <ChevronLeft className="h-5 w-5" />
                  <SectionIcon className="h-4 w-4 text-orange-500" />
                </button>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {saveBadge}
                <button onClick={requestClose} aria-label={t.close} className="flex h-9 w-9 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800">
                  <X className="h-5 w-5" />
                </button>
              </div>
            </header>

            <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 pb-6 pt-4 sm:mt-14 sm:px-6 sm:pt-3">
              {/* Nothing loaded yet: the spinner from the very first frame (the
                  request starts in an effect, a frame after the sheet appears).
                  Once there is a view it stays up through later refreshes. */}
              {!view ? (
                error ? (
                  <p className="text-sm text-red-500">{error}</p>
                ) : (
                  <div className="flex justify-center py-12">
                    <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                  </div>
                )
              ) : error && !loading ? (
                <p className="text-sm text-red-500">{error}</p>
              ) : (
                renderSection()
              )}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
