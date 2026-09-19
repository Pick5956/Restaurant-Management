"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bell, Check, ChevronLeft, ChevronRight, Loader2, RotateCcw, Settings2, SlidersHorizontal, Trash2, Wand2, X } from "lucide-react";
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
  { id: "ingredient_low", kinds: ["ingredient_low"], th: ["วัตถุดิบใกล้หมด", "เมื่อเหลือต่ำกว่าขั้นต่ำที่ตั้งไว้ของแต่ละตัว"], en: ["Ingredient running low", "When stock falls under the minimum you set"] },
  { id: "dead_stock", kinds: ["dead_stock"], th: ["ของค้างสต๊อก", "วัตถุดิบที่มีในคลังแต่ไม่ได้ใช้เลยใน 30 วัน"], en: ["Dead stock", "Ingredients on the shelf that nothing used in 30 days"] },
  { id: "sales_change", kinds: ["sales_drop", "sales_up"], th: ["ยอดขายเปลี่ยนผิดปกติ", "7 วันล่าสุดขึ้นหรือลงชัดเจนเมื่อเทียบกับ 7 วันก่อนหน้า"], en: ["Unusual sales change", "The last 7 days clearly up or down against the 7 before"] },
  { id: "plowhorse", kinds: ["plowhorse"], th: ["เมนูขายดีแต่กำไรน้อย", "จานที่สั่งบ่อยแต่ทำเงินให้ร้านน้อย ควรดูต้นทุนหรือราคา"], en: ["Popular but low-margin menu", "Ordered often, earns little — worth a look at cost or price"] },
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
        settings: "ตั้งค่าผู้ช่วย",
        close: "ปิด",
        back: "กลับ",
        saved: "บันทึกแล้ว",
        saving: "กำลังบันทึก",
        loadError: "โหลดการตั้งค่าไม่สำเร็จ",
        saveError: "บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง",
        sections: {
          general: { name: "ทั่วไป", blurb: "ชื่อที่เรียกคุณ · คำถามแนะนำ · ประวัติแชท" },
          actions: { name: "สิ่งที่ทำแทนคุณได้", blurb: "เลือกได้ทีละอย่างว่าให้แก้อะไรได้บ้าง" },
          notifications: { name: "การแจ้งเตือน", blurb: "ของใกล้หมด · ของค้าง · ยอดขายผิดปกติ" },
        },
        groupAnswers: "การตอบ",
        titleLabel: "ชื่อที่ผู้ช่วยใช้เรียกคุณ",
        titleHint: "ใช้ตอนทักทายและในคำตอบ เว้นว่างไว้ = “คุณผู้จัดการ”",
        titlePlaceholder: "คุณผู้จัดการ",
        followUps: "คำถามแนะนำใต้คำตอบ",
        followUpsHint: "เสนอคำถามต่อยอด 2–3 ข้อหลังแต่ละคำตอบ (เฉพาะเครื่องนี้)",
        groupHistory: "ประวัติแชท",
        memoryNote: "แชทเก็บไว้จนกว่าคุณจะลบ ผู้ช่วยจำเรื่องที่คุยในแต่ละแชทแยกกัน · ที่ลบไปอยู่ในถังขยะ 7 วันก่อนหายถาวร",
        clearAll: "ย้ายทุกแชทลงถังขยะ",
        clearAllHint: "รายการแชทจะว่าง กู้คืนทีละแชทได้จากถังขยะภายใน 7 วัน",
        clearButton: "ล้างรายการ…",
        clearConfirm: "ย้ายทั้งหมดลงถังขยะ",
        clearCancel: "ไม่ย้าย",
        cleared: "ย้ายแล้ว",
        trash: "ถังขยะ",
        trashHint: "แชทที่ลบไว้ กู้คืนได้ภายใน 7 วัน หลังจากนั้นระบบลบถาวรให้เอง",
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
        masterHint: "ปิดสวิตช์นี้ = ผู้ช่วยดูข้อมูลได้อย่างเดียว รายการข้างล่างจะไม่มีผล",
        unavailable: "ตอนนี้ความสามารถนี้ถูกปิดจากระบบส่วนกลาง เปิดสวิตช์ไว้ได้ แต่จะยังไม่มีผลจนกว่าระบบจะเปิดให้",
        groupMenu: "เมนู",
        groupIngredients: "วัตถุดิบ",
        groupMoney: "การเงิน",
        confirmNote: "ทุกคำสั่งจะถูกเตรียมเป็นรายการให้ดูก่อน อยู่ได้ 1 นาที ถ้าไม่กดยืนยันจะถูกยกเลิกเอง · กดยืนยันได้เฉพาะเจ้าของร้าน",
        groupStock: "วัตถุดิบ",
        groupSales: "ยอดขายและเมนู",
        bellNote: "การแจ้งเตือนขึ้นที่กระดิ่งมุมขวาบนตอนเปิดแอป ยังไม่มีการส่งออกไปนอกแอป",
      }
    : {
        settings: "Assistant settings",
        close: "Close",
        back: "Back",
        saved: "Saved",
        saving: "Saving",
        loadError: "Could not load settings",
        saveError: "Could not save, try again",
        sections: {
          general: { name: "General", blurb: "What it calls you · suggestions · chat history" },
          actions: { name: "What it can do for you", blurb: "Choose, one by one, what it may change" },
          notifications: { name: "Notifications", blurb: "Low stock · dead stock · unusual sales" },
        },
        groupAnswers: "Answers",
        titleLabel: "What the assistant calls you",
        titleHint: "Used in greetings and answers. Leave empty for “Manager”",
        titlePlaceholder: "Manager",
        followUps: "Follow-up suggestions under answers",
        followUpsHint: "Offer 2–3 next questions after each answer (this device only)",
        groupHistory: "Chat history",
        memoryNote: "Chats are kept until you delete them; the assistant remembers each chat on its own. Deleted chats wait in the trash for 7 days.",
        clearAll: "Move every chat to the trash",
        clearAllHint: "The chat list empties. Each chat can be restored from the trash within 7 days.",
        clearButton: "Clear list…",
        clearConfirm: "Move all to trash",
        clearCancel: "Keep",
        cleared: "Moved",
        trash: "Trash",
        trashHint: "Deleted chats can be restored within 7 days; after that they are removed for good.",
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
        masterHint: "Off = the assistant only reads. Nothing below applies.",
        unavailable: "This capability is currently off system-wide. You can leave the switch on, but it takes effect only once the system enables it.",
        groupMenu: "Menu",
        groupIngredients: "Ingredients",
        groupMoney: "Money",
        confirmNote: "Every command is prepared as a list for you to check first. It lasts 1 minute and cancels itself if not confirmed · only the owner can confirm",
        groupStock: "Ingredients",
        groupSales: "Sales and menu",
        bellNote: "Notifications appear on the bell at the top right when the app is open. Nothing is sent outside the app yet.",
      };
}

function Switch({ on, onChange, disabled, label }: { on: boolean; onChange: (next: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      // A flat track and a plain white knob (19 ก.ย. 2569: the owner asked for
      // an ordinary switch, not the raised 3D one). The knob keeps the same 2px
      // inset on both ends: 44px track, 20px knob, 20px travel.
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50 ${
        on ? "bg-orange-500" : "bg-gray-300 dark:bg-gray-600"
      }`}
    >
      <span
        // Pinned 2px from the top and the left; "on" slides it by the free
        // width (44 − 20 − 2×2 = 20px) so the right inset is the same 2px.
        className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ease-out ${
          on ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}

function Row({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-gray-100 py-3 first:border-t-0 dark:border-gray-800">
      <div className="min-w-0">
        <p className="text-[13px] font-medium leading-[18px] text-gray-800 dark:text-gray-100">{label}</p>
        {hint ? <p className="mt-0.5 text-[11.5px] leading-4 text-gray-500 dark:text-gray-400">{hint}</p> : null}
      </div>
      {children}
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-400 dark:text-gray-500">{title}</p>
      <div className="flex flex-col">{children}</div>
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-[10px] bg-gray-50 px-3 py-2.5 text-[11.5px] leading-[17px] text-gray-500 dark:bg-gray-900/60 dark:text-gray-400">{children}</p>
  );
}

const SECTION_ICONS: Record<SectionKey, typeof Wand2> = { general: SlidersHorizontal, actions: Wand2, notifications: Bell };
const SECTION_ORDER: SectionKey[] = ["general", "actions", "notifications"];

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
    setLoading(true);
    setConfirmClear(false);
    setClearedCount(null);
    setMobileOpen(false);
    setTrashOpen(false);
    setTrash(null);
    setTrashError("");
    setConfirmPurgeAll(false);
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
            <Row label={t.titleLabel} hint={t.titleHint}>
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
                className="h-8 w-44 shrink-0 rounded-lg border border-gray-200 bg-white px-3 text-[12.5px] text-gray-800 outline-none placeholder:text-gray-400 focus:border-orange-300 focus:ring-2 focus:ring-orange-500/15 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
              />
            </Row>
            <Row label={t.followUps} hint={t.followUpsHint}>
              <Switch on={followUps} onChange={setFollowUps} label={t.followUps} />
            </Row>
          </Group>
          <Group title={t.groupHistory}>
            <Row label={t.clearAll} hint={confirmClear ? undefined : t.clearAllHint}>
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
            <Row label={t.trash} hint={t.trashHint}>
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
          <Note>{t.memoryNote}</Note>
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
          <div className="flex items-center justify-between gap-4 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3.5 dark:border-orange-900/50 dark:bg-orange-950/25">
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
                  <Row key={row.type} label={label}>
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
      <Row key={row.id} label={label} hint={hint}>
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
    <div className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-black/50 p-0 sm:p-4" onClick={onClose}>
      <div
        className="flex h-full w-full overflow-hidden bg-white shadow-xl dark:bg-gray-950 sm:h-[560px] sm:max-h-[85vh] sm:max-w-3xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Desktop sidebar */}
        <aside className="hidden w-52 shrink-0 flex-col gap-0.5 border-r border-gray-200 bg-gray-50 p-3 dark:border-gray-800 dark:bg-gray-900/50 sm:flex">
          <p className="mb-2 flex items-center gap-1.5 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
            <Settings2 className="h-3.5 w-3.5" /> {t.settings}
          </p>
          {sectionNav}
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Phone: the section list, until a section is opened */}
          {!mobileOpen && (
            <div className="flex min-h-0 flex-1 flex-col sm:hidden">
              <header className="flex items-center justify-between border-b border-gray-200 px-4 pb-3 pt-[max(1rem,env(safe-area-inset-top))] dark:border-gray-800">
                <h2 className="text-[17px] font-semibold text-gray-900 dark:text-white">{t.settings}</h2>
                <button onClick={onClose} aria-label={t.close} className="rounded-md p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800">
                  <X className="h-5 w-5" />
                </button>
              </header>
              <div className="min-h-0 flex-1 overflow-y-auto bg-gray-50 p-4 dark:bg-gray-950">
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
              </div>
            </div>
          )}

          {/* The section itself: always on desktop, after a tap on a phone */}
          <div className={`${mobileOpen ? "flex" : "hidden"} min-h-0 flex-1 flex-col sm:flex`}>
            <header className="flex items-center justify-between gap-3 border-b border-gray-200 px-4 pb-3 pt-[max(1rem,env(safe-area-inset-top))] dark:border-gray-800 sm:px-6 sm:pt-4">
              <div className="flex min-w-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => setMobileOpen(false)}
                  aria-label={t.back}
                  className="-ml-1 rounded-md p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 sm:hidden"
                >
                  <ChevronLeft className="h-5 w-5" />
                </button>
                <div className="min-w-0">
                  <h2 className="flex items-center gap-2 text-base font-semibold text-gray-900 dark:text-white">
                    <SectionIcon className="h-4 w-4 text-orange-500 sm:hidden" />
                    {t.sections[activeSection].name}
                  </h2>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {saveBadge}
                <button onClick={onClose} aria-label={t.close} className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800">
                  <X className="h-5 w-5" />
                </button>
              </div>
            </header>

            <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 pb-6 pt-4 sm:px-6">
              {loading ? (
                <div className="flex justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                </div>
              ) : error ? (
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
