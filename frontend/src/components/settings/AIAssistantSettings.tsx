"use client";

import { useEffect, useId, useState } from "react";
import { Check, CircleX, RotateCcw, Sparkles, Trash2 } from "lucide-react";
import {
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
import { notifyAllConversationsCleared, notifyConversationsChanged } from "@/src/lib/aiThreads";
import { useLanguage } from "@/src/providers/LanguageProvider";
import { useToast } from "@/src/components/shared/FeedbackProvider";
import { Note, Switch } from "@/src/components/shared/settingsModalKit";
import { SettingsButton, SettingsGroup, SettingsItem, SettingsSkeleton, SettingsSwitch } from "./SettingsPrimitives";
import { MobileInput, MobileLabel, MobileSection, MobileSwitchTile, MobileToggle, useSettingsPhone } from "./SettingsMobileKit";
import { FOCUS_RING } from "./SettingsPrimitives";

// Dishy AI's settings as one section of the app's settings (27 ก.ย. 2569): the
// owner asked for them to live here, under the account menu, instead of in a
// window of their own behind a gear on the AI page. The rows are the ones that
// window had - what it calls you, follow-up questions, chat history, what it
// may change, what it tells you about - drawn with this window's rows, so the
// search finds them like any other setting. Every change saves at once.

// The bell's five kinds are four rows: a sales drop and a sales rise are one
// thing to the owner ("ยอดขายเปลี่ยนผิดปกติ").
// `short` is the name on the phone's pill (th, en), where the full one does not fit.
type InsightRow = { id: string; kinds: AIInsightKind[]; th: [string, string]; en: [string, string]; short: [string, string] };
const INSIGHT_ROWS: InsightRow[] = [
  { id: "ingredient_low", kinds: ["ingredient_low"], th: ["วัตถุดิบใกล้หมด", "ต่ำกว่าขั้นต่ำที่ตั้งไว้"], en: ["Ingredient running low", "Under the minimum you set"], short: ["ของใกล้หมด", "Low stock"] },
  { id: "dead_stock", kinds: ["dead_stock"], th: ["ของค้างสต๊อก", "ไม่ได้ใช้เลยใน 30 วัน"], en: ["Dead stock", "Unused for 30 days"], short: ["ของค้าง", "Dead stock"] },
  { id: "sales_change", kinds: ["sales_drop", "sales_up"], th: ["ยอดขายเปลี่ยนผิดปกติ", "7 วันล่าสุด เทียบ 7 วันก่อน"], en: ["Unusual sales change", "Last 7 days against the 7 before"], short: ["ยอดขายผิดปกติ", "Sales change"] },
  { id: "plowhorse", kinds: ["plowhorse"], th: ["เมนูขายดีแต่กำไรน้อย", "สั่งบ่อยแต่ทำเงินน้อย"], en: ["Popular but low-margin menu", "Ordered often, earns little"], short: ["ขายดีกำไรน้อย", "Low-margin hit"] },
];

// The example sentence is the row's note: the search finds "ราคา 120" too.
type ActionGroup = "menu" | "ingredients" | "money";
type ActionRow = { type: AIActionType; group: ActionGroup; th: [string, string]; en: [string, string]; short: [string, string] };
const ACTION_ROWS: ActionRow[] = [
  { type: "set_menu_availability", group: "menu", th: ["เปิด–ปิดขายเมนู", "“ปิดขายต้มยำกุ้งวันนี้”"], en: ["Open or close a menu item", "“Close Tom Yum Kung for today”"], short: ["เปิด–ปิดขาย", "Open/close"] },
  { type: "set_menu_price", group: "menu", th: ["เปลี่ยนราคาเมนู", "“ขึ้นราคาผัดไทยเป็น 95 บาท”"], en: ["Change a menu price", "“Raise Pad Thai to 95 baht”"], short: ["เปลี่ยนราคา", "Price"] },
  { type: "create_menu_item", group: "menu", th: ["เพิ่มเมนูใหม่", "“เพิ่มเมนูข้าวผัดปู ราคา 120 หมวดข้าว”"], en: ["Add a new menu item", "“Add crab fried rice, 120 baht, in Rice”"], short: ["เพิ่มเมนู", "New menu"] },
  { type: "adjust_ingredient_stock", group: "ingredients", th: ["ปรับจำนวนสต๊อก", "“รับหมูสับเข้ามา 5 กิโล”"], en: ["Adjust stock", "“Received 5 kg of minced pork”"], short: ["ปรับสต๊อก", "Stock"] },
  { type: "set_ingredient_min_stock", group: "ingredients", th: ["ตั้งสต๊อกขั้นต่ำ", "“ตั้งขั้นต่ำกะเพราไว้ 2 กิโล”"], en: ["Set a minimum stock", "“Set holy basil minimum to 2 kg”"], short: ["ขั้นต่ำ", "Minimum"] },
  { type: "set_ingredient_cost", group: "ingredients", th: ["ตั้งต้นทุนต่อหน่วย", "“ไข่ไก่ตอนนี้ฟองละ 4.50”"], en: ["Set a unit cost", "“Eggs are 4.50 each now”"], short: ["ต้นทุน", "Unit cost"] },
  { type: "create_ingredient", group: "ingredients", th: ["เพิ่มวัตถุดิบใหม่", "“เพิ่มวัตถุดิบ เห็ดออรินจิ หน่วยเป็นกิโล”"], en: ["Add a new ingredient", "“Add king oyster mushroom, in kg”"], short: ["เพิ่มวัตถุดิบ", "New ingredient"] },
  { type: "create_expense", group: "money", th: ["บันทึกรายจ่าย", "“จ่ายค่าแก๊สไป 1,200” หรือถ่ายรูปใบเสร็จส่งให้"], en: ["Record an expense", "“Paid 1,200 for gas”, or send a receipt photo"], short: ["บันทึกรายจ่าย", "Expense"] },
];

function copy(language: "th" | "en") {
  return language === "th"
    ? {
        section: "Dishy AI",
        summary: "ชื่อที่เรียกคุณ · สิทธิ์ของผู้ช่วย · การแจ้งเตือน · ประวัติแชท",
        loading: "กำลังโหลดการตั้งค่า Dishy AI",
        loadError: "โหลดการตั้งค่า Dishy AI ไม่สำเร็จ",
        saveError: "บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง",
        groupAnswers: "การตอบ",
        titleLabel: "ชื่อที่ผู้ช่วยใช้เรียกคุณ",
        titleHint: "เว้นว่าง = “คุณผู้จัดการ”",
        titlePlaceholder: "คุณผู้จัดการ",
        followUps: "คำถามแนะนำใต้คำตอบ",
        followUpsHint: "2–3 ข้อหลังแต่ละคำตอบ · เฉพาะเครื่องนี้",
        groupPermissions: "สิทธิ์ของผู้ช่วย",
        master: "ให้ผู้ช่วยแก้ข้อมูลร้านได้",
        masterHint: "ปิด = ดูข้อมูลได้อย่างเดียว",
        unavailable: "ระบบกลางปิดความสามารถนี้อยู่ ยังใช้ไม่ได้",
        confirmNote: "ทุกคำสั่งรอเจ้าของร้านกดยืนยันภายใน 1 นาที",
        groupNotifications: "การแจ้งเตือน",
        bellNote: "ขึ้นที่กระดิ่งมุมขวาบนของหน้า Dishy AI เฉพาะตอนเปิดแอป",
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
        phoneSummary: "ตั้งค่าผู้ช่วยของร้าน",
        pillHint: "แตะเม็ดเพื่อเปิด–ปิดทีละอย่าง",
        groupMenu: "เมนู",
        groupIngredients: "วัตถุดิบ",
        groupMoney: "การเงิน",
        groupBell: "แจ้งเตือนที่กระดิ่ง",
        on: "เปิด",
        off: "ปิด",
      }
    : {
        section: "Dishy AI",
        summary: "What it calls you · permissions · notifications · chat history",
        loading: "Loading Dishy AI settings",
        loadError: "Could not load Dishy AI settings",
        saveError: "Could not save, try again",
        groupAnswers: "Answers",
        titleLabel: "What the assistant calls you",
        titleHint: "Empty = “Manager”",
        titlePlaceholder: "Manager",
        followUps: "Follow-up suggestions under answers",
        followUpsHint: "2–3 after each answer · this device only",
        groupPermissions: "Assistant permissions",
        master: "Let the assistant change shop data",
        masterHint: "Off = read only",
        unavailable: "Turned off system-wide for now",
        confirmNote: "Every command waits 1 minute for the owner to confirm",
        groupNotifications: "Notifications",
        bellNote: "On the bell at the top right of Dishy AI, while the app is open",
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
        phoneSummary: "Your shop's assistant",
        pillHint: "Tap a pill to turn it on or off",
        groupMenu: "Menu",
        groupIngredients: "Ingredients",
        groupMoney: "Money",
        groupBell: "On the bell",
        on: "on",
        off: "off",
      };
}

// Days left before the sweep removes a trashed chat for good.
function daysUntilPurge(trashedAt?: string | null) {
  if (!trashedAt) return 7;
  const elapsed = (Date.now() - new Date(trashedAt).getTime()) / (24 * 60 * 60 * 1000);
  return Math.max(0, Math.ceil(7 - elapsed));
}

export default function AIAssistantSettings() {
  const { language } = useLanguage();
  const t = copy(language);
  const phone = useSettingsPhone();
  const { showToast } = useToast();
  const titleId = useId();

  const [view, setView] = useState<AISettingsView | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
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

  // The window mounts its sections when it opens, so this reads fresh settings
  // every time it is opened.
  useEffect(() => {
    let active = true;
    getAISettings()
      .then((res) => {
        if (!active) return;
        const title = res.data.owner_title === t.titlePlaceholder ? "" : res.data.owner_title;
        setView(res.data);
        setTitleDraft(title);
        cacheOwnerTitle(title);
      })
      .catch(() => {
        if (active) setLoadFailed(true);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Every switch saves on its own: the screen changes first, the request
  // follows, and on failure the previous view comes back with a toast.
  const apply = async (patch: AISettingsPatch, optimistic: (current: AISettingsView) => AISettingsView) => {
    if (!view) return;
    const previous = view;
    setView(optimistic(view));
    try {
      const res = await updateAISettings(patch);
      setView(res.data);
      if (patch.owner_title !== undefined) {
        cacheOwnerTitle(res.data.owner_title === t.titlePlaceholder ? "" : res.data.owner_title);
      }
    } catch {
      setView(previous);
      showToast({ title: t.saveError, tone: "error" });
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

  const toggleTrash = () => {
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
      // The chat open on the AI page or the floating chat just went to the
      // trash too; they start a fresh one when they hear this.
      notifyAllConversationsCleared();
      if (trashOpen) void loadTrash();
    } catch {
      showToast({ title: t.saveError, tone: "error" });
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

  const pick = (pair: { th: [string, string]; en: [string, string] }) => (language === "th" ? pair.th : pair.en);
  const actionsOn = Boolean(view?.actions_enabled);

  // The trash, open under its row: restore or delete each chat, or all.
  const trashList = (
    <div className="mb-1 flex flex-col overflow-hidden rounded-xl border border-gray-200 dark:border-gray-800">
      {trash === null ? (
        <p className="px-4 py-5 text-center text-[12px] text-gray-400">…</p>
      ) : trash.length === 0 ? (
        <p className="px-4 py-5 text-center text-[12px] text-gray-500 dark:text-gray-400">{t.trashEmpty}</p>
      ) : (
        <>
          {trash.map((conversation) => (
            <div key={conversation.id} className="flex items-center justify-between gap-3 border-t border-gray-100 px-3 py-2.5 first:border-t-0 dark:border-gray-800">
              <div className="min-w-0">
                <p className="truncate text-[13px] font-medium text-gray-800 dark:text-gray-100">{conversation.title || t.untitled}</p>
                <p className="mt-0.5 text-[11.5px] text-gray-500 dark:text-gray-400">{t.purgeIn(daysUntilPurge(conversation.trashed_at))}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => void restoreOne(conversation)}
                  disabled={trashBusyId !== null}
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
                <SettingsButton onClick={() => setConfirmPurgeAll(false)} disabled={trashBusyId !== null}>{t.purgeAllCancel}</SettingsButton>
                <SettingsButton variant="danger" onClick={() => void purgeAll()} loading={trashBusyId === "*"}>{t.purgeAllConfirm}</SettingsButton>
              </>
            ) : (
              <SettingsButton variant="danger-secondary" onClick={() => setConfirmPurgeAll(true)} disabled={trashBusyId !== null}>
                {t.purgeAll}
              </SettingsButton>
            )}
          </div>
        </>
      )}
      {trashError ? <p className="px-3 py-2 text-[11px] text-red-500">{trashError}</p> : null}
    </div>
  );

  const body = !view ? (
    loadFailed ? (
      <p className="text-[12.5px] text-red-600 dark:text-red-400">{t.loadError}</p>
    ) : (
      <SettingsSkeleton label={t.loading} rows={3} />
    )
  ) : (
    <>
      <SettingsGroup id="ai_answers" title={t.groupAnswers}>
        <SettingsItem title={t.titleLabel} description={t.titleHint} htmlFor={titleId}>
          <input
            id={titleId}
            type="text"
            value={titleDraft}
            maxLength={40}
            placeholder={t.titlePlaceholder}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            // 16px on a phone, or iPhone zooms in when it is tapped.
            className="h-8 w-44 rounded-lg border border-gray-200 bg-white px-3 text-[16px] text-gray-800 outline-none placeholder:text-gray-400 focus:border-orange-300 focus:ring-2 focus:ring-orange-500/15 sm:text-[12.5px] dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
          />
        </SettingsItem>
        <SettingsSwitch label={t.followUps} description={t.followUpsHint} checked={followUps} onChange={setFollowUps} />
      </SettingsGroup>

      <SettingsGroup id="ai_permissions" title={t.groupPermissions}>
        {/* The master switch stands apart from the rows it governs. */}
        <div className="my-1 flex items-center justify-between gap-4 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3.5 dark:border-orange-900/50 dark:bg-orange-950/25">
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
        {!view.feature_available ? (
          <p className="my-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">
            {t.unavailable}
          </p>
        ) : null}
        {ACTION_ROWS.map((row) => {
          const [label, example] = pick(row);
          return (
            <SettingsSwitch
              key={row.type}
              label={label}
              description={example}
              checked={view.action_types[row.type] !== false}
              disabled={!actionsOn}
              onChange={(next) =>
                apply({ action_types: { [row.type]: next } }, (v) => ({ ...v, action_types: { ...v.action_types, [row.type]: next } }))
              }
            />
          );
        })}
        <div className="mt-2">
          <Note>{t.confirmNote}</Note>
        </div>
      </SettingsGroup>

      <SettingsGroup id="ai_notifications" title={t.groupNotifications}>
        {INSIGHT_ROWS.map((row) => {
          const [label, hint] = pick(row);
          const on = row.kinds.every((kind) => view.insight_kinds[kind] !== false);
          return (
            <SettingsSwitch
              key={row.id}
              label={label}
              description={hint}
              checked={on}
              onChange={(next) => {
                const patch: Partial<Record<AIInsightKind, boolean>> = {};
                for (const kind of row.kinds) patch[kind] = next;
                void apply({ insight_kinds: patch }, (v) => ({ ...v, insight_kinds: { ...v.insight_kinds, ...patch } }));
              }}
            />
          );
        })}
        <div className="mt-2">
          <Note>{t.bellNote}</Note>
        </div>
      </SettingsGroup>

      <SettingsGroup id="ai_history" title={t.groupHistory}>
        <SettingsItem title={t.clearAll} description={confirmClear ? undefined : t.clearAllHint}>
          {clearedCount !== null ? (
            <span className="inline-flex items-center gap-1 text-[12px] font-medium text-emerald-600 dark:text-emerald-400">
              <Check className="h-3.5 w-3.5" /> {t.cleared}
            </span>
          ) : confirmClear ? (
            <div className="flex items-center gap-1.5">
              <SettingsButton onClick={() => setConfirmClear(false)} disabled={clearing}>{t.clearCancel}</SettingsButton>
              <SettingsButton variant="danger" onClick={clearAll} loading={clearing}>
                <span className="inline-flex items-center gap-1.5"><Trash2 className="h-3.5 w-3.5" /> {t.clearConfirm}</span>
              </SettingsButton>
            </div>
          ) : (
            <SettingsButton variant="danger-secondary" onClick={() => setConfirmClear(true)}>{t.clearButton}</SettingsButton>
          )}
        </SettingsItem>
        <SettingsItem title={t.trash} description={t.trashHint}>
          <SettingsButton onClick={toggleTrash}>
            {trashOpen ? t.trashClose : t.trashOpen}
            {trash && trash.length > 0 ? ` (${trash.length})` : ""}
          </SettingsButton>
        </SettingsItem>
        {trashOpen ? trashList : null}
      </SettingsGroup>
    </>
  );

  // A phone: one card on the long page, with a chip of its own (design C,
  // chosen 27 ก.ย. 2569). What it may change and what it tells you about are
  // pills - ✓ and orange when on - grouped the way the computer's rows are,
  // so the whole of it fits in about a screen and a half.
  if (phone) {
    const pill = (key: string, label: string, full: string, on: boolean, onToggle: () => void, disabled = false) => (
      <button
        key={key}
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={full}
        disabled={disabled}
        onClick={onToggle}
        className={`ui-press inline-flex min-h-[36px] items-center gap-1.5 rounded-full border px-3.5 text-[13.5px] transition disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING} ${
          on
            ? "border-(--inv-action) bg-(--inv-action-soft) font-semibold text-(--inv-action)"
            : "border-(--inv-hairline) bg-(--inv-surface) text-(--inv-muted)"
        }`}
      >
        {on ? <Check aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={3} /> : <CircleX aria-hidden="true" className="h-3.5 w-3.5" />}
        {label}
      </button>
    );
    const groupLabel = (text: string) => <p className="mb-1.5 ml-0.5 mt-3 text-[12.5px] font-semibold text-(--inv-muted)">{text}</p>;
    const groups: { key: ActionGroup; title: string }[] = [
      { key: "menu", title: t.groupMenu },
      { key: "ingredients", title: t.groupIngredients },
      { key: "money", title: t.groupMoney },
    ];
    const button = "ui-press flex min-h-[44px] items-center justify-center gap-1.5 rounded-[14px] border text-[14px] font-semibold disabled:opacity-60";
    return (
      <MobileSection
        id="ai"
        title={t.section}
        summary={t.phoneSummary}
        icon={Sparkles}
        tone="bg-(--inv-action-soft) text-(--inv-action)"
        keywords={[
          t.summary, t.titleLabel, t.followUps, t.groupPermissions, t.master, t.groupNotifications, t.clearAll, t.trash,
          ...ACTION_ROWS.map((row) => pick(row).join(" ")),
          ...INSIGHT_ROWS.map((row) => pick(row).join(" ")),
        ].join(" ")}
      >
        {!view ? (
          loadFailed ? <p className="text-[12.5px] text-red-600 dark:text-red-400">{t.loadError}</p> : <SettingsSkeleton label={t.loading} rows={3} />
        ) : (
          <>
            <MobileInput
              label={t.titleLabel}
              value={titleDraft}
              placeholder={t.titlePlaceholder}
              onChange={setTitleDraft}
              onCommit={commitTitle}
              autoComplete="off"
            />
            <p className="-mt-2 mb-3 ml-0.5 text-[12px] text-(--inv-muted)">{t.titleHint}</p>

            {/* The master switch, in the brand's soft orange: off turns every pill below off. */}
            <div className="rounded-2xl border border-orange-200 bg-(--inv-action-soft) px-3.5 py-3 dark:border-orange-900/50">
              <div className="flex items-center gap-3">
                <p className="min-w-0 flex-1 text-[15px] font-semibold text-orange-900 dark:text-orange-200">{t.master}</p>
                <MobileToggle checked={actionsOn} label={t.master} onChange={(next) => apply({ actions_enabled: next }, (v) => ({ ...v, actions_enabled: next }))} />
              </div>
              <p className="mt-1 text-[12.5px] leading-[18px] text-orange-700 dark:text-orange-300/80">{t.masterHint} · {t.pillHint}</p>
            </div>
            {!view.feature_available ? (
              <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300">{t.unavailable}</p>
            ) : null}
            {groups.map((group) => (
              <div key={group.key}>
                {groupLabel(group.title)}
                <div className="flex flex-wrap gap-2">
                  {ACTION_ROWS.filter((row) => row.group === group.key).map((row) => {
                    const on = view.action_types[row.type] !== false;
                    return pill(row.type, language === "th" ? row.short[0] : row.short[1], pick(row)[0], on, () =>
                      apply({ action_types: { [row.type]: !on } }, (v) => ({ ...v, action_types: { ...v.action_types, [row.type]: !on } })),
                    !actionsOn);
                  })}
                </div>
              </div>
            ))}

            {groupLabel(t.groupBell)}
            <div className="mb-3 flex flex-wrap gap-2">
              {INSIGHT_ROWS.map((row) => {
                const on = row.kinds.every((kind) => view.insight_kinds[kind] !== false);
                return pill(row.id, language === "th" ? row.short[0] : row.short[1], pick(row)[0], on, () => {
                  const patch: Partial<Record<AIInsightKind, boolean>> = {};
                  for (const kind of row.kinds) patch[kind] = !on;
                  void apply({ insight_kinds: patch }, (v) => ({ ...v, insight_kinds: { ...v.insight_kinds, ...patch } }));
                });
              })}
            </div>

            <MobileSwitchTile title={t.followUps} hint={t.followUpsHint} checked={followUps} onChange={setFollowUps} />

            <MobileLabel>{t.groupHistory}</MobileLabel>
            {clearedCount !== null ? (
              <p className="mb-2 inline-flex items-center gap-1 text-[13px] font-medium text-emerald-600 dark:text-emerald-400">
                <Check className="h-3.5 w-3.5" /> {t.cleared}
              </p>
            ) : null}
            {confirmClear ? (
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setConfirmClear(false)} disabled={clearing} className={`${button} border-(--inv-hairline) bg-(--inv-surface) text-(--inv-body) ${FOCUS_RING}`}>{t.clearCancel}</button>
                <button type="button" onClick={clearAll} disabled={clearing} className={`${button} border-red-600 bg-red-600 text-white ${FOCUS_RING}`}>
                  <Trash2 className="h-4 w-4" /> {t.clearConfirm}
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={toggleTrash} className={`${button} border-(--inv-hairline) bg-(--inv-surface) text-(--inv-body) ${FOCUS_RING}`}>
                  {trashOpen ? t.trashClose : t.trashOpen}
                  {trash && trash.length > 0 ? ` (${trash.length})` : ""}
                </button>
                <button type="button" onClick={() => setConfirmClear(true)} className={`${button} border-red-200 bg-(--inv-surface) text-red-600 dark:border-red-900/60 dark:text-red-400 ${FOCUS_RING}`}>
                  {t.clearButton}
                </button>
              </div>
            )}
            {trashOpen ? <div className="mt-3">{trashList}</div> : null}
          </>
        )}
      </MobileSection>
    );
  }
  return body;
}
