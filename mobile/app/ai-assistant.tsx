import MaskedView from '@react-native-masked-view/masked-view';
import { LinearGradient } from 'expo-linear-gradient';
import { router, usePathname } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  TextInput as NativeTextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  askOperationsAIStream,
  cancelAIAction,
  cancelAIActionPlan,
  confirmAIAction,
  confirmAIActionPlan,
  deleteAIConversation,
  getAIConversationTurns,
  getAISettings,
  getProactiveInsights,
  listAIConversations,
  renameAIConversation,
} from '@/src/api/ai';
import { AppIcon } from '@/src/components/app-icon';
import { AppScreen } from '@/src/components/app-shell';
import { AppText as Text } from '@/src/components/app-text';
import {
  AIResponseContent,
  AssistantRow,
  FollowUpList,
  OutcomeLine,
  StreamCaret,
  ThinkingText,
  UserBubble,
} from '@/src/components/ai/bubbles';
import { AIChart } from '@/src/components/ai/chart';
import { ChatListSheet } from '@/src/components/ai/chat-list-sheet';
import { GlassButton, GlassMorphMenu, GlassPill, GlassSurface } from '@/src/components/ai/chrome';
import { Composer } from '@/src/components/ai/composer';
import { ConfirmCard, type ConfirmState } from '@/src/components/ai/confirm-card';
import { InsightsSheet, insightKey } from '@/src/components/ai/insights-sheet';
import { AIOrb } from '@/src/components/ai/orb';
import { SettingsSheet } from '@/src/components/ai/settings-sheet';
import { ai } from '@/src/components/ai/theme';
import { Feedback } from '@/src/components/ui';
import {
  type AIGuidedAction,
  canUseAIAssistant,
  getGuidedAIActions,
  getUnclearAIActions,
  resolveAIClarificationRequest,
  resolveAINavigationRequest,
} from '@/src/lib/ai-actions';
import { formatAIActionConfirmationMessage, getAIActionErrorMessage } from '@/src/lib/ai-action-preview';
import {
  type AIChatMessage,
  answerChips,
  isConversationGone,
  readAIOutage,
  turnsToMessages,
  welcomeFor,
} from '@/src/lib/ai-chat';
import { recentConversationHistory } from '@/src/lib/ai-conversation';
import {
  readActiveThread,
  readCachedOwnerTitle,
  readFollowUpsEnabled,
  readSeenInsights,
  writeActiveThread,
  writeCachedOwnerTitle,
  writeSeenInsights,
} from '@/src/lib/ai-prefs';
import { can } from '@/src/lib/rbac';
import { useAuth } from '@/src/providers/auth-provider';
import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';
import { breakpoints } from '@/src/theme';
import type {
  AIActionPlan,
  AIActionPreview,
  AIConversationMessage,
  AIConversationSummary,
  AIInsight,
} from '@/src/types/ai';

// The assistant, the way the web page draws it: one full-height chat on a
// cream canvas, the four glass buttons top-right, the orb greeting on an empty
// thread, streaming answers with charts and follow-ups, and the confirm card
// under any command. The dock stays out: this screen lives under "More".

// The header buttons and the gap left when one steps aside share this size.
const HEADER_BUTTON = 46;
/** The header row's own bottom padding, below the buttons. */
const HEADER_ROW_PADDING_BOTTOM = 8;
/**
 * How far the header's blur spills past the bottom of the buttons before it is
 * gone entirely. The whole fade happens inside this band.
 *
 * It is the one number that decides both how soft the header's bottom edge is
 * and how far down the chat has to start, and those two pull against each
 * other: content must begin below the band or the first message sits in the
 * blur and looks washed out, but a long band pushes that first message a long
 * way down the screen.
 *
 * The owner chose the far short end of that trade, on the screen and by eye:
 * the blur clears the buttons and stops. Do not raise it back "to smooth the
 * scroll" without asking — the tighter first message is the point, and the
 * abruptness underneath is a price that was picked deliberately.
 */
const HEADER_FADE = 15;

const SUGGESTIONS_TH = ['สรุปร้าน', 'เมนูขายดี', 'วัตถุดิบใกล้หมด', 'มูลค่าสต๊อก'];
const SUGGESTIONS_EN = ['Shop summary', 'Best sellers', 'Low stock', 'Stock value'];

function availabilityLabel(isAvailable: boolean, language: 'th' | 'en'): string {
  if (language === 'th') return isAvailable ? 'เปิดขาย' : 'ปิดขาย';
  return isAvailable ? 'Available' : 'Unavailable';
}

function newId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export default function AIAssistantScreen() {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { activeMembership } = useAuth();
  const { copy, language } = useDisplayPreferences();
  const pathname = usePathname();
  const canUseAI = canUseAIAssistant(activeMembership?.role?.name);
  const scope = `${activeMembership?.restaurant_id ?? 0}:${activeMembership?.user_id ?? 0}`;
  const wide = width >= breakpoints.tablet;

  const [messages, setMessages] = useState<AIChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; tone: 'error' | 'info' } | null>(null);
  const [ownerTitle, setOwnerTitle] = useState('');
  const [followUpsOn, setFollowUpsOn] = useState(true);

  const [pendingPlan, setPendingPlan] = useState<AIActionPlan | null>(null);
  const [pendingPreview, setPendingPreview] = useState<AIActionPreview | null>(null);
  const [pendingQuestion, setPendingQuestion] = useState('');

  const [insights, setInsights] = useState<AIInsight[] | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [seenInsights, setSeenInsights] = useState<string[]>([]);
  const [conversations, setConversations] = useState<AIConversationSummary[] | null>(null);
  const [conversationsLoading, setConversationsLoading] = useState(false);
  const conversationsStale = useRef(true);

  const [insightsOpen, setInsightsOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const [stickToBottom, setStickToBottom] = useState(true);
  const [showJump, setShowJump] = useState(false);
  const [composerHeight, setComposerHeight] = useState(120);
  const scrollRef = useRef<ScrollView | null>(null);
  const inputRef = useRef<NativeTextInput | null>(null);
  const generation = useRef(0);

  const hasPermission = useCallback((permission: string) => can(activeMembership, permission), [activeMembership]);
  // One roll for as long as the screen is open. Rolling inside the render would
  // reword the greeting on every state change — the owner would watch it shuffle
  // as they typed — and the date is read here rather than inside welcomeFor so
  // the wording is settled by the same rule.
  const greetingRoll = useRef(Math.random()).current;
  const welcome = useMemo(
    () => welcomeFor(language, ownerTitle, new Date(), greetingRoll),
    [greetingRoll, language, ownerTitle],
  );
  const suggestions = language === 'th' ? SUGGESTIONS_TH : SUGGESTIONS_EN;
  const busy = loading || threadLoading;
  // The floating header's real height: the status bar, one button row, and the
  // row's own bottom padding. It used to be written as `insets.top + 42` while
  // the buttons in that row are HEADER_BUTTON tall — so everything measured
  // against it sat 12px too high, and the first message came out tucked under
  // the chat's name instead of below it.
  const headerHeight = insets.top + HEADER_BUTTON + HEADER_ROW_PADDING_BOTTOM;
  // The blurred pane: down to the bottom of the buttons, then the fade.
  const headerPane = insets.top + HEADER_BUTTON + HEADER_FADE;
  // Where the fade starts, as a share of the pane — the buttons' bottom edge.
  // Computed rather than written as a fixed fraction because the status bar is a
  // different height on every phone, and a fixed fraction puts the ramp across
  // the buttons on some of them and below the pane on others.
  const headerSolid = (insets.top + HEADER_BUTTON) / headerPane;
  const fadeAt = (through: number) => headerSolid + (1 - headerSolid) * through;
  // Once the owner has asked something the header becomes the chat's own: its
  // name in the middle, and the four buttons folded into one "…".
  const started = messages.length > 0 || threadLoading;
  const firstQuestion = messages.find((message) => message.role === 'user')?.content ?? '';
  const chatTitle = conversations?.find((row) => row.id === conversationId)?.title
    || firstQuestion
    || copy('แชทใหม่', 'New chat');
  const restaurantName = activeMembership?.restaurant?.name ?? '';

  // ---------------------------------------------------------------- loading

  // A card the owner never answered still blocks every other command on the
  // server until it is confirmed or cancelled — so leaving it behind (new chat,
  // opening another chat, switching restaurant) cancels it there first.
  const pendingRef = useRef<{ plan: AIActionPlan | null; preview: AIActionPreview | null }>({ plan: null, preview: null });
  pendingRef.current = { plan: pendingPlan, preview: pendingPreview };

  const discardPending = useCallback(() => {
    const { plan, preview } = pendingRef.current;
    if (plan) cancelAIActionPlan(plan.id).catch(() => undefined);
    if (preview) cancelAIAction(preview.id).catch(() => undefined);
    setPendingPlan(null);
    setPendingPreview(null);
  }, []);

  const resetThread = useCallback(() => {
    generation.current += 1;
    discardPending();
    setMessages([]);
    setConversationId(null);
    setDraft(null);
    setLoading(false);
    setNotice(null);
  }, [discardPending]);

  const openThread = useCallback(async (id: string) => {
    const mine = ++generation.current;
    setThreadLoading(true);
    discardPending();
    setMessages([]);
    setConversationId(id);
    setNotice(null);
    try {
      const { turns } = await getAIConversationTurns(id);
      if (generation.current !== mine) return;
      setMessages(turnsToMessages(turns ?? []));
      setStickToBottom(true);
      await writeActiveThread(scope, id);
    } catch (error) {
      if (generation.current !== mine) return;
      setConversationId(null);
      await writeActiveThread(scope, null);
      if (!isConversationGone(error)) {
        setNotice({ text: copy('เปิดแชทไม่สำเร็จ', 'Could not open the chat'), tone: 'error' });
      }
    } finally {
      if (generation.current === mine) setThreadLoading(false);
    }
  }, [copy, discardPending, scope]);

  useEffect(() => {
    if (!canUseAI) return;
    resetThread();
    let active = true;
    // The cache paints the greeting immediately; the shop's settings are the
    // truth and correct it a moment later.
    void readCachedOwnerTitle().then((title) => { if (active && title) setOwnerTitle(title); });
    getAISettings()
      .then((view) => {
        if (!active) return;
        const title = (view.owner_title ?? '').trim();
        setOwnerTitle(title);
        void writeCachedOwnerTitle(title);
      })
      .catch(() => undefined);
    void readFollowUpsEnabled().then((enabled) => { if (active) setFollowUpsOn(enabled); });
    void readSeenInsights(scope).then((keys) => { if (active) setSeenInsights(keys); });
    void readActiveThread(scope).then((id) => { if (active && id) void openThread(id); });
    setInsightsLoading(true);
    getProactiveInsights()
      .then((res) => { if (active) setInsights(res.insights ?? []); })
      .catch(() => { if (active) setInsights([]); })
      .finally(() => { if (active) setInsightsLoading(false); });
    conversationsStale.current = true;
    setConversations(null);
    return () => { active = false; };
  }, [canUseAI, openThread, resetThread, scope]);

  const loadConversations = useCallback(async () => {
    setConversationsLoading(true);
    try {
      const res = await listAIConversations();
      setConversations(res.conversations ?? []);
      conversationsStale.current = false;
    } catch {
      setConversations((current) => current ?? []);
    } finally {
      setConversationsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (listOpen && conversationsStale.current) void loadConversations();
  }, [listOpen, loadConversations]);

  useEffect(() => {
    if (!insightsOpen || !insights || insights.length === 0) return;
    const keys = insights.map(insightKey);
    setSeenInsights((current) => {
      const merged = Array.from(new Set([...current, ...keys]));
      void writeSeenInsights(scope, merged);
      return merged;
    });
  }, [insights, insightsOpen, scope]);

  const unseenInsights = useMemo(
    () => (insights ?? []).filter((insight) => !seenInsights.includes(insightKey(insight))).length,
    [insights, seenInsights],
  );

  // ---------------------------------------------------------------- asking

  const history = useMemo<AIConversationMessage[]>(
    () => recentConversationHistory(messages.map((message) => ({ role: message.role, content: message.content }))),
    [messages],
  );

  const append = useCallback((message: AIChatMessage) => {
    setMessages((current) => [...current, message]);
    setStickToBottom(true);
  }, []);

  const ask = useCallback(async (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed || loading) return;
    setNotice(null);
    setInput('');
    append({ id: newId('q'), role: 'user', content: trimmed, createdAt: new Date() });

    const navigation = resolveAINavigationRequest(trimmed, hasPermission, pathname, language, canUseAI);
    if (navigation) {
      append({
        id: newId('nav'),
        role: 'assistant',
        content: navigation.message,
        createdAt: new Date(),
        actions: navigation.kind === 'suggest' ? navigation.options.map((option) => ({ id: option.href, ...option })) : undefined,
      });
      if (navigation.kind === 'navigate' && !navigation.alreadyThere) router.push(navigation.href as never);
      return;
    }
    const clarification = resolveAIClarificationRequest(trimmed, hasPermission, language, canUseAI);
    if (clarification) {
      append({ id: newId('clarify'), role: 'assistant', content: clarification.message, createdAt: new Date(), actions: clarification.actions });
      return;
    }

    const mine = generation.current;
    setLoading(true);
    setDraft(null);
    try {
      const data = await askOperationsAIStream(trimmed, history, conversationId, {
        onDraft: (text) => { if (generation.current === mine) setDraft(text); },
      });
      if (generation.current !== mine) return;
      const answer = data.answer?.trim();
      if (!answer) throw new Error(copy('ผู้ช่วยตอบไม่ได้ในขณะนี้', 'The assistant could not answer'));
      if (data.conversation_id) {
        setConversationId(data.conversation_id);
        void writeActiveThread(scope, data.conversation_id);
        conversationsStale.current = true;
        // The server names the chat on its first answer; read it back so the
        // header shows that name instead of the raw question.
        void loadConversations();
      }
      if (data.action_plan) {
        setPendingPlan(data.action_plan);
        setPendingQuestion(trimmed);
      }
      if (data.action_preview) {
        setPendingPreview(data.action_preview);
        setPendingQuestion(trimmed);
      }
      const written = answerChips(data.follow_ups, data.navigate, language);
      // No follow-ups from the writer is a decision, not a gap: the fixed list
      // is kept only for a question it could not read.
      const actions = written
        ?? (data.intent === 'unclear' ? getUnclearAIActions(hasPermission, language, canUseAI) : []);
      append({
        id: data.turn_id ? `${data.turn_id}` : newId('a'),
        role: 'assistant',
        content: answer,
        createdAt: new Date(),
        chart: data.chart,
        toolsUsed: data.tools_used,
        scopeAssumed: data.scope_assumed,
        planId: data.action_plan?.id,
        previewId: data.action_preview?.id,
        actions: actions.length > 0 ? actions : undefined,
      });
    } catch (error) {
      if (generation.current !== mine) return;
      if (isConversationGone(error)) {
        setConversationId(null);
        void writeActiveThread(scope, null);
        setNotice({ text: copy('แชทนี้ถูกลบไปแล้ว เริ่มแชทใหม่ได้เลย', 'This chat was deleted. Start a new one'), tone: 'error' });
        return;
      }
      const outage = readAIOutage(error);
      if (outage) {
        const wait = outage.retryAfterSeconds ? Math.ceil(outage.retryAfterSeconds / 60) : 0;
        setNotice({
          text: outage.kind === 'quota'
            ? copy(`โควตา AI วันนี้เต็มแล้ว${wait ? ` ลองใหม่ในอีก ${wait} นาที` : ''}`, `Today's AI quota is used up${wait ? `, try again in ${wait} min` : ''}`)
            : copy('ผู้ให้บริการ AI ไม่ตอบ ลองใหม่ในสักครู่', 'The AI provider is not responding, try again shortly'),
          tone: 'error',
        });
        return;
      }
      setNotice({
        text: error instanceof Error && error.message ? error.message : copy('ผู้ช่วยตอบไม่ได้ในขณะนี้', 'The assistant could not answer'),
        tone: 'error',
      });
    } finally {
      if (generation.current === mine) {
        setLoading(false);
        setDraft(null);
      }
    }
  }, [append, canUseAI, conversationId, copy, hasPermission, history, language, loadConversations, loading, pathname, scope]);

  const onAction = useCallback((action: AIGuidedAction) => {
    if (action.prompt) {
      void ask(action.prompt);
      return;
    }
    if (action.href) router.push(action.href as never);
  }, [ask]);

  // ---------------------------------------------------------------- commands

  const confirmPlan = useCallback(async () => {
    const plan = pendingPlan;
    if (!plan) return;
    const result = await confirmAIActionPlan(plan.id, plan.confirmation_token);
    setMessages((current) => current.map((message) => (
      message.planId === plan.id
        ? { ...message, outcome: { tone: result.failed > 0 && result.succeeded === 0 ? 'bad' : 'good', text: result.message } }
        : message
    )));
    if (result.succeeded === 0 && result.failed > 0) throw new Error(result.message);
  }, [pendingPlan]);

  const confirmPreview = useCallback(async () => {
    const preview = pendingPreview;
    if (!preview) return;
    try {
      const result = await confirmAIAction(preview.id, preview.confirmation_token);
      const text = formatAIActionConfirmationMessage(result, language);
      setMessages((current) => current.map((message) => (
        message.previewId === preview.id ? { ...message, outcome: { tone: 'good', text } } : message
      )));
    } catch (error) {
      throw new Error(getAIActionErrorMessage(error, language));
    }
  }, [language, pendingPreview]);

  const reissue = useCallback(() => {
    setPendingPlan(null);
    setPendingPreview(null);
    if (!pendingQuestion) return;
    setInput(pendingQuestion);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [pendingQuestion]);

  const onResolved = useCallback((kind: 'plan' | 'preview', state: ConfirmState) => {
    if (state === 'confirming') return;
    if (state === 'cancelled' || state === 'expired') {
      const text = state === 'cancelled'
        ? copy('ยกเลิกแล้ว · ไม่มีการแก้ข้อมูล', 'Cancelled · nothing changed')
        : copy('คำสั่งหมดอายุ · ไม่มีการแก้ข้อมูล', 'Expired · nothing changed');
      setMessages((current) => current.map((message) => (
        (kind === 'plan' && message.planId && message.planId === pendingPlan?.id)
        || (kind === 'preview' && message.previewId && message.previewId === pendingPreview?.id)
          ? { ...message, outcome: { tone: 'muted', text } }
          : message
      )));
    }
    if (state === 'done' || state === 'cancelled') {
      if (kind === 'plan') setPendingPlan(null);
      else setPendingPreview(null);
    }
  }, [copy, pendingPlan?.id, pendingPreview?.id]);

  // ---------------------------------------------------------------- chats

  const startNewChat = useCallback(() => {
    resetThread();
    void writeActiveThread(scope, null);
    setTimeout(() => inputRef.current?.focus(), 200);
  }, [resetThread, scope]);

  const renameChat = useCallback(async (id: string, title: string) => {
    await renameAIConversation(id, title);
    setConversations((current) => current?.map((row) => (row.id === id ? { ...row, title, title_by_owner: true } : row)) ?? null);
  }, []);

  const deleteChat = useCallback(async (id: string) => {
    try {
      await deleteAIConversation(id);
    } catch {
      setNotice({ text: copy('ลบแชทไม่สำเร็จ', 'Could not delete the chat'), tone: 'error' });
      return;
    }
    setConversations((current) => current?.filter((row) => row.id !== id) ?? null);
    if (id === conversationId) startNewChat();
  }, [conversationId, copy, startNewChat]);

  // ---------------------------------------------------------------- render

  if (!canUseAI) {
    return (
      <AppScreen title={copy('ผู้ช่วย AI', 'AI assistant')} subtitle={copy('วิเคราะห์จากข้อมูลร้านล่าสุด', 'Analyze current restaurant data')} topLevel={false}>
        <Feedback
          title={copy('ไม่มีสิทธิ์ใช้ผู้ช่วยวิเคราะห์', 'Analytics assistant access unavailable')}
          detail={copy('ผู้ช่วยวิเคราะห์เปิดให้ใช้งานเฉพาะเจ้าของร้าน', 'The analytics assistant is available to restaurant owners only.')}
          tone="info"
        />
      </AppScreen>
    );
  }

  const empty = messages.length === 0 && !loading && !threadLoading;
  const planAnchor = pendingPlan ? messages.find((message) => message.planId === pendingPlan.id)?.id ?? null : null;
  const previewAnchor = pendingPreview ? messages.find((message) => message.previewId === pendingPreview.id)?.id ?? null : null;

  const planCard = pendingPlan && pendingPlan.items.length > 0 ? (
    <ConfirmCard
      key={pendingPlan.id}
      summary={pendingPlan.summary}
      items={pendingPlan.items.map((item) => ({ title: item.title, change: item.change, unit: item.unit, sideEffects: item.side_effects }))}
      warnings={pendingPlan.warnings}
      detail={copy(`แก้ข้อมูลจริง ${pendingPlan.items.length} รายการ`, `changes ${pendingPlan.items.length} record(s)`)}
      expiresAt={pendingPlan.expires_at}
      onConfirm={confirmPlan}
      onCancel={() => { cancelAIActionPlan(pendingPlan.id).catch(() => undefined); }}
      onReissue={reissue}
      onResolved={(state) => onResolved('plan', state)}
      language={language}
    />
  ) : null;

  const previewCard = pendingPreview ? (
    <ConfirmCard
      key={pendingPreview.id}
      summary={pendingPreview.summary}
      items={[{
        title: pendingPreview.target.name,
        change: `${availabilityLabel(pendingPreview.current.is_available, language)} → ${availabilityLabel(pendingPreview.requested.is_available, language)}`,
      }]}
      warnings={pendingPreview.warnings}
      detail={copy('แก้ข้อมูลจริง 1 รายการ', 'changes 1 record')}
      expiresAt={pendingPreview.expires_at}
      onConfirm={confirmPreview}
      onCancel={() => { cancelAIAction(pendingPreview.id).catch(() => undefined); }}
      onReissue={reissue}
      onResolved={(state) => onResolved('preview', state)}
      language={language}
    />
  ) : null;

  return (
    <View style={{ flex: 1, backgroundColor: ai.canvas }}>
      <LinearGradient
        pointerEvents="none"
        colors={['rgba(255,206,164,0)', 'rgba(255,206,164,0.35)', 'rgba(255,172,104,0.55)']}
        locations={[0, 0.55, 1]}
        style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '55%' }}
      />
      {/* The header's backdrop blurs what passes behind it and nothing else — no
          panel, no tint. The blur cannot weaken by itself, so a blurred copy is
          masked: solid behind the buttons, then given a long ramp to nothing. The
          ramp is deliberately longer than it needs to be, because any short one
          shows up as a line across the chat.

          Only once there is a chat to pass under it. On the empty first screen
          there is nothing to blur but the Orb, and frosting it left a cloudy
          band across the top of the ball. */}
      {empty ? null : (
      <MaskedView
        pointerEvents="none"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: headerPane, zIndex: 2 }}
        maskElement={
          <LinearGradient
            colors={[
              '#000000',
              '#000000',
              'rgba(0,0,0,0.72)',
              'rgba(0,0,0,0.42)',
              'rgba(0,0,0,0.18)',
              'rgba(0,0,0,0.05)',
              'rgba(0,0,0,0)',
            ]}
            locations={[0, headerSolid, fadeAt(0.3), fadeAt(0.55), fadeAt(0.75), fadeAt(0.9), 1]}
            style={{ flex: 1 }}
          />
        }
      >
        {/* "regular" rather than "clear": frosted, so the band reads as a
            material the chat passes under instead of a smear of the chat itself.
            The mask still takes it to nothing, so this cannot bleach the page the
            way a flat tint over the whole header did. */}
        <GlassSurface
          effect="regular"
          style={{ flex: 1 }}
          fallbackStyle={{ backgroundColor: 'rgba(250,248,242,0.9)' }}
        >
          <View style={{ flex: 1 }} />
        </GlassSurface>
      </MaskedView>
      )}
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, paddingTop: insets.top, paddingBottom: HEADER_ROW_PADDING_BOTTOM, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingRight: 14, gap: 8, zIndex: 3 }}>
        <GlassButton
          icon="chevron-back"
          label={started ? copy('กลับไปหน้าเริ่มต้นของผู้ช่วย', 'Back to the assistant home') : copy('ย้อนกลับ', 'Back')}
          onPress={() => {
            // Inside a chat, back goes up one level to the assistant's own home
            // rather than out of the assistant entirely. The chat is saved and
            // reopens from the list, and a second press leaves as it always did.
            if (started) {
              startNewChat();
              return;
            }
            if (router.canGoBack()) router.back();
            else router.replace('/more' as never);
          }}
        />
        {started ? (
          <View style={{ flex: 1, alignItems: 'center', paddingHorizontal: 4 }}>
            <Text numberOfLines={1} style={{ fontSize: 16, fontWeight: '600', color: ai.ink }}>{chatTitle}</Text>
            {restaurantName ? (
              <Text numberOfLines={1} style={{ fontSize: 12, color: ai.faded }}>{restaurantName}</Text>
            ) : null}
          </View>
        ) : (
          <View style={{ flex: 1 }} />
        )}
        {started ? (
          // The "…" button is drawn by GlassMorphMenu below, at this exact spot,
          // because it and the menu have to be one piece of glass. The row keeps
          // a gap the button's size so the title beside it never moves.
          <View style={{ width: HEADER_BUTTON, height: HEADER_BUTTON }} />
        ) : (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <GlassButton icon="chatbubbles-outline" label={copy('รายการแชท', 'Chats')} onPress={() => setListOpen(true)} />
            <GlassButton icon="notifications-outline" label={copy('ควรรู้วันนี้', "Today's insights")} badge={unseenInsights} active={insightsOpen} onPress={() => setInsightsOpen(true)} />
            <GlassButton icon="settings-outline" label={copy('การตั้งค่า', 'Settings')} onPress={() => setSettingsOpen(true)} />
          </View>
        )}
      </View>

      {started ? (
      <GlassMorphMenu
        open={menuOpen}
        onOpen={() => setMenuOpen(true)}
        onClose={() => setMenuOpen(false)}
        icon="ellipsis-horizontal"
        label={copy('เมนู', 'Menu')}
        dot={unseenInsights > 0}
        // The row above puts the button's top-right corner here: its own top
        // padding is the safe area, its right padding 14.
        style={{ top: insets.top, right: 14 }}
        items={[
          { key: 'chats', icon: 'chatbubbles-outline', label: copy('รายการแชท', 'Chats'), onPress: () => setListOpen(true) },
          {
            key: 'insights',
            icon: 'notifications-outline',
            label: copy('ควรรู้วันนี้', "Today's insights"),
            detail: unseenInsights > 0 ? copy(`${unseenInsights} เรื่องยังไม่ได้อ่าน`, `${unseenInsights} unread`) : undefined,
            dot: unseenInsights > 0,
            onPress: () => setInsightsOpen(true),
          },
          { key: 'new', icon: 'create-outline', label: copy('แชทใหม่', 'New chat'), onPress: startNewChat },
          { key: 'settings', icon: 'settings-outline', label: copy('การตั้งค่า', 'Settings'), onPress: () => setSettingsOpen(true) },
        ]}
      />
      ) : null}

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={0}>
        <View style={{ flex: 1, alignSelf: 'center', width: '100%', maxWidth: wide ? 760 : undefined }}>
          {empty ? (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 22, paddingHorizontal: 24, paddingTop: headerHeight, paddingBottom: composerHeight }}>
              <AIOrb size={128} speed={20} interactive style={{ shadowColor: ai.orange, shadowOpacity: 0.4, shadowRadius: 25, shadowOffset: { width: 0, height: 15 } }} />
              <Text style={{ fontSize: 19, fontWeight: '600', color: '#0a0a0a', textAlign: 'center' }}>{welcome}</Text>
            </View>
          ) : (
            <View style={{ flex: 1 }}>
              <ScrollView
                ref={scrollRef}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="interactive"
                // Content starts where the fade ends, not inside it. The fade is there
        // for messages travelling up past the header; a message sitting still at
        // the top of an unscrolled chat has no business being blurred at all.
        contentContainerStyle={{ paddingHorizontal: 14, paddingTop: headerPane + 8, paddingBottom: composerHeight + 12, gap: 14 }}
                onContentSizeChange={() => { if (stickToBottom) scrollRef.current?.scrollToEnd({ animated: true }); }}
                onScroll={(event) => {
                  const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
                  const fromBottom = contentSize.height - layoutMeasurement.height - contentOffset.y;
                  const near = fromBottom < 80;
                  setStickToBottom(near);
                  setShowJump(fromBottom > 240);
                }}
                scrollEventThrottle={64}
              >
                {threadLoading ? (
                  <AssistantRow><ThinkingText text={copy('กำลังเปิดแชท', 'Opening the chat')} /></AssistantRow>
                ) : null}
                {messages.map((message) => (
                  message.role === 'user' ? (
                    <UserBubble key={message.id} text={message.content} />
                  ) : (
                    <View key={message.id} style={{ gap: 14 }}>
                      <AssistantRow>
                        <AIResponseContent content={message.content} />
                        {message.chart ? <AIChart data={message.chart} /> : null}
                        {planAnchor === message.id ? planCard : null}
                        {previewAnchor === message.id ? previewCard : null}
                        {message.outcome ? <OutcomeLine tone={message.outcome.tone} text={message.outcome.text} /> : null}
                      </AssistantRow>
                      {followUpsOn && message.actions && message.actions.length > 0 ? (
                        <FollowUpList heading={copy('ถามต่อได้เลย', 'Ask next')} actions={message.actions} disabled={loading} onPress={onAction} />
                      ) : null}
                    </View>
                  )
                ))}
                {pendingPlan && planAnchor === null ? <AssistantRow>{planCard}</AssistantRow> : null}
                {pendingPreview && previewAnchor === null ? <AssistantRow>{previewCard}</AssistantRow> : null}
                {loading && draft ? (
                  <AssistantRow>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                      <View style={{ flexShrink: 1 }}><AIResponseContent content={draft} /></View>
                      <StreamCaret />
                    </View>
                  </AssistantRow>
                ) : null}
                {loading && !draft ? (
                  <AssistantRow><ThinkingText text={copy('กำลังวิเคราะห์', 'Analyzing')} /></AssistantRow>
                ) : null}
              </ScrollView>
              {showJump ? (
                <View style={{ position: 'absolute', bottom: composerHeight + 8, alignSelf: 'center' }}>
                  <GlassButton
                    icon="chevron-down"
                    label={copy('ไปที่ข้อความล่าสุด', 'Jump to latest')}
                    onPress={() => { setStickToBottom(true); scrollRef.current?.scrollToEnd({ animated: true }); }}
                    size={44}
                  />
                </View>
              ) : null}
            </View>
          )}

          <View
            onLayout={(event) => setComposerHeight(Math.round(event.nativeEvent.layout.height))}
            style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 12, paddingBottom: Math.max(insets.bottom, 10) + 4, gap: 8 }}
          >
            {notice ? (
              <Pressable accessibilityRole="button" onPress={() => setNotice(null)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: notice.tone === 'error' ? '#fef2f2' : '#eff6ff', borderWidth: 1, borderColor: notice.tone === 'error' ? '#fecaca' : '#bfdbfe' }}>
                <AppIcon name={notice.tone === 'error' ? 'alert-circle-outline' : 'information-circle-outline'} size={16} color={notice.tone === 'error' ? '#b91c1c' : '#1d4ed8'} />
                <Text style={{ flex: 1, fontSize: 12.5, color: notice.tone === 'error' ? '#b91c1c' : '#1e40af' }}>{notice.text}</Text>
                <AppIcon name="close" size={14} color={ai.faded} />
              </Pressable>
            ) : null}
            {/* Two by two: four pills on one wrapping row left an odd one centred
                underneath, which read as a mistake. */}
            {empty ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10, paddingHorizontal: 4, paddingBottom: 2 }}>
                {suggestions.map((suggestion) => (
                  <View key={suggestion} style={{ width: '48.5%' }}>
                    <GlassPill stretch label={suggestion} onPress={() => { void ask(suggestion); }} />
                  </View>
                ))}
              </View>
            ) : null}
            <Composer
              ref={inputRef}
              value={input}
              onChange={setInput}
              onSend={() => { void ask(input); }}
              onInsert={(text) => { setInput(text); setTimeout(() => inputRef.current?.focus(), 50); }}
              onNotice={(text, tone) => setNotice({ text, tone })}
              sending={loading}
              disabled={busy && !loading}
              language={language}
            />
          </View>
        </View>
      </KeyboardAvoidingView>

      <InsightsSheet
        open={insightsOpen}
        onClose={() => setInsightsOpen(false)}
        insights={insights}
        loading={insightsLoading}
        language={language}
      />
      <ChatListSheet
        open={listOpen}
        onClose={() => setListOpen(false)}
        conversations={conversations}
        loading={conversationsLoading}
        activeId={conversationId}
        language={language}
        onOpen={(id) => { if (id !== conversationId) void openThread(id); }}
        onNew={startNewChat}
        onRename={renameChat}
        onDelete={deleteChat}
      />
      <SettingsSheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        language={language}
        onOwnerTitle={setOwnerTitle}
        onFollowUps={setFollowUpsOn}
        onConversationsChanged={() => { conversationsStale.current = true; void loadConversations(); }}
      />
    </View>
  );
}
