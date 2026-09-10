import MaskedView from '@react-native-masked-view/masked-view';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Easing, Pressable, ScrollView, Switch, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  getAISettings,
  listTrashedAIConversations,
  purgeAIConversation,
  purgeAllTrashedAIConversations,
  restoreAIConversation,
  updateAISettings,
} from '@/src/api/ai';
import { AppIcon, type AppIconName } from '@/src/components/app-icon';
import { AppText as Text } from '@/src/components/app-text';
import { AppTextInput as TextInput } from '@/src/components/app-text-input';
import { useReducedMotion } from '@/src/components/motion';
import { threadStamp } from '@/src/lib/ai-chat';
import { readFollowUpsEnabled, writeCachedOwnerTitle, writeFollowUpsEnabled } from '@/src/lib/ai-prefs';
import type { DisplayLanguage } from '@/src/lib/display-preferences';
import { AI_ACTION_TYPES, type AIActionType, type AIConversationSummary, type AIInsightKind, type AISettingsPatch, type AISettingsView } from '@/src/types/ai';

import { BottomSheet, GlassButton, GlassSurface } from './chrome';
import { ai } from './theme';

// Settings the way a phone does them: a short list of subjects, each opening its
// own page, rather than every switch in the product on one scroll. Switches save
// as they are flipped; there is no save button to forget.
//
// The trash and chat recovery stay on the web, where there is room to show what
// is in it.

type Page = 'root' | 'title' | 'actions' | 'notifications' | 'trash';

// The header's geometry, shared by the pane behind it and the space each page
// leaves for it. Same idea as the chat screen: the row floats, the content
// scrolls under a blur that fades out just past the buttons, and the first
// thing on the page starts below that fade rather than inside it.
const HEADER_BUTTON = 44;
const HEADER_ROW_PADDING_TOP = 4;
const HEADER_ROW_PADDING_BOTTOM = 10;
/** How far the blur spills past the buttons before it is gone. The owner's pick on the chat screen. */
const HEADER_FADE = 15;
const HEADER_ROW = HEADER_ROW_PADDING_TOP + HEADER_BUTTON + HEADER_ROW_PADDING_BOTTOM;
const CONTENT_TOP = HEADER_ROW_PADDING_TOP + HEADER_BUTTON + HEADER_FADE + 10;

// From here up the sheet is wide enough to hold the list and a subject side by
// side, so it stops sliding pages over one another: an iPad in portrait is 834
// points across, and even that has room for both.
const SPLIT_AT = 768;
const SIDEBAR = 330;
/** A settings page reads at a column's width, not a tablet's. */
const DETAIL_MAX = 680;

const ACTION_LABELS: Record<AIActionType, { th: string; en: string }> = {
  set_menu_availability: { th: 'เปิด/ปิดขายเมนู', en: 'Menu availability' },
  set_menu_price: { th: 'เปลี่ยนราคาเมนู', en: 'Menu price' },
  create_menu_item: { th: 'เพิ่มเมนูใหม่', en: 'Create menu item' },
  adjust_ingredient_stock: { th: 'ปรับจำนวนสต๊อก', en: 'Adjust stock' },
  set_ingredient_min_stock: { th: 'ตั้งขั้นต่ำวัตถุดิบ', en: 'Minimum stock' },
  set_ingredient_cost: { th: 'เปลี่ยนต้นทุนวัตถุดิบ', en: 'Ingredient cost' },
  create_ingredient: { th: 'เพิ่มวัตถุดิบใหม่', en: 'Create ingredient' },
  create_expense: { th: 'บันทึกรายจ่าย', en: 'Record expense' },
};

const INSIGHT_ROWS: { key: AIInsightKind; pair?: AIInsightKind; th: string; en: string }[] = [
  { key: 'ingredient_low', th: 'ของใกล้หมด', en: 'Low stock' },
  { key: 'dead_stock', th: 'ของค้างสต๊อก', en: 'Dead stock' },
  { key: 'sales_drop', pair: 'sales_up', th: 'ยอดขายผิดปกติ', en: 'Unusual sales' },
  { key: 'plowhorse', th: 'เมนูขายดีแต่กำไรต่ำ', en: 'Popular but low margin' },
];

function GroupLabel({ text }: { text: string }) {
  return (
    <Text style={{ fontSize: 13, color: ai.faded, paddingHorizontal: 18, paddingBottom: 7, paddingTop: 20 }}>{text}</Text>
  );
}

function Group({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ backgroundColor: ai.surface, borderRadius: 18, overflow: 'hidden', marginHorizontal: 12 }}>
      {children}
    </View>
  );
}

/** One line in a group: taps through to a page, or carries its own switch. */
function Row({
  icon,
  label,
  detail,
  value,
  onPress,
  toggle,
  disabled,
  first,
  selected,
}: {
  icon?: AppIconName;
  label: string;
  detail?: string;
  /** Shown greyed on the right, the way a settings list shows current state. */
  value?: string;
  onPress?: () => void;
  toggle?: { on: boolean; onChange: (next: boolean) => void };
  disabled?: boolean;
  first?: boolean;
  /** The row whose page is open beside it, on the split layout. */
  selected?: boolean;
}) {
  const body = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        minHeight: 56,
        paddingHorizontal: 16,
        paddingVertical: 10,
        opacity: disabled ? 0.45 : 1,
      }}
    >
      {icon ? <AppIcon name={icon} size={22} color={selected ? ai.deep : ai.body} /> : null}
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 16, fontWeight: selected ? '600' : '400', color: selected ? ai.deep : ai.ink }}>{label}</Text>
        {detail ? <Text style={{ fontSize: 12.5, color: ai.faded, marginTop: 1 }}>{detail}</Text> : null}
      </View>
      {value ? <Text style={{ fontSize: 15, color: ai.faded, maxWidth: 150 }} numberOfLines={1}>{value}</Text> : null}
      {toggle ? (
        <Switch
          value={toggle.on}
          onValueChange={toggle.onChange}
          disabled={disabled}
          trackColor={{ true: '#fb923c', false: '#e5e7eb' }}
          thumbColor="#ffffff"
        />
      ) : null}
      {onPress ? <AppIcon name="chevron-forward" size={18} color={ai.ghost} /> : null}
    </View>
  );
  return (
    <View style={{ borderTopWidth: first ? 0 : 1, borderTopColor: '#f1f0ee' }}>
      {onPress ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: Boolean(selected) }}
          disabled={disabled}
          onPress={onPress}
          style={({ pressed }) => ({ backgroundColor: selected ? ai.orangeSoft : pressed ? '#f6f4f0' : 'transparent' })}
        >
          {body}
        </Pressable>
      ) : (
        body
      )}
    </View>
  );
}

export function SettingsSheet({
  open,
  onClose,
  language,
  onOwnerTitle,
  onFollowUps,
  onConversationsChanged,
}: {
  open: boolean;
  onClose: () => void;
  language: DisplayLanguage;
  onOwnerTitle: (title: string) => void;
  onFollowUps: (enabled: boolean) => void;
  /** Restoring a chat puts it back in the list, so the screen reloads it. */
  onConversationsChanged?: () => void;
}) {
  const t = (th: string, en: string) => (language === 'th' ? th : en);
  const [page, setPage] = useState<Page>('root');
  // Pages push in from the right and pop back out to it, the way a navigation
  // stack does. While one is on its way the page it is replacing is still
  // mounted, sliding the other way; `transition` holds which one and which
  // direction, and `slide` is how far along the move is.
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const reducedMotion = useReducedMotion();
  // The blurred pane reaches up over the status bar (the sheet's own top
  // padding) and down to the buttons' bottom edge plus the fade. Where the fade
  // starts is computed against the pane, so it lands on the buttons on every
  // phone whatever its status bar height.
  const headerPane = insets.top + HEADER_ROW_PADDING_TOP + HEADER_BUTTON + HEADER_FADE;
  const headerSolid = (insets.top + HEADER_ROW_PADDING_TOP + HEADER_BUTTON) / headerPane;
  const fadeAt = (through: number) => headerSolid + (1 - headerSolid) * through;

  const [transition, setTransition] = useState<{ from: Page; dir: 'push' | 'pop' } | null>(null);
  const slide = useRef(new Animated.Value(1)).current;
  const go = (next: Page) => {
    if (next === page) return;
    // Side by side there is nothing to slide: the list never leaves, and only
    // the pane beside it changes.
    if (reducedMotion || width >= SPLIT_AT) {
      setPage(next);
      return;
    }
    setTransition({ from: page, dir: next === 'root' ? 'pop' : 'push' });
    setPage(next);
    slide.setValue(0);
    Animated.timing(slide, {
      toValue: 1,
      duration: 460,
      easing: Easing.bezier(0.2, 0.8, 0.2, 1),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setTransition(null);
    });
  };
  const [settings, setSettings] = useState<AISettingsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [followUps, setFollowUps] = useState(true);
  const [title, setTitle] = useState('');
  const [trashed, setTrashed] = useState<AIConversationSummary[] | null>(null);
  const [trashBusy, setTrashBusy] = useState(false);

  const loadTrash = async () => {
    setTrashBusy(true);
    try {
      const res = await listTrashedAIConversations();
      setTrashed(res.conversations ?? []);
    } catch {
      setTrashed([]);
      setError(t('เปิดถังขยะไม่สำเร็จ', 'Could not open the trash'));
    } finally {
      setTrashBusy(false);
    }
  };

  // One tap, two ways out: put it back, or end it. Deleting for good asks again,
  // because that one cannot be undone.
  const openTrashRow = (conversation: AIConversationSummary) => {
    Alert.alert(conversation.title || t('แชทไม่มีชื่อ', 'Untitled chat'), undefined, [
      {
        text: t('กู้คืน', 'Restore'),
        onPress: () => {
          void (async () => {
            try {
              await restoreAIConversation(conversation.id);
              setTrashed((rows) => rows?.filter((row) => row.id !== conversation.id) ?? null);
              onConversationsChanged?.();
            } catch {
              setError(t('กู้คืนไม่สำเร็จ', 'Could not restore'));
            }
          })();
        },
      },
      {
        text: t('ลบถาวร', 'Delete forever'),
        style: 'destructive',
        onPress: () => {
          Alert.alert(
            t('ลบถาวรไหม?', 'Delete forever?'),
            t('แชทนี้จะหายไปเลย กู้คืนไม่ได้อีก', 'This chat goes for good and cannot be restored'),
            [
              { text: t('ยกเลิก', 'Cancel'), style: 'cancel' },
              {
                text: t('ลบถาวร', 'Delete forever'),
                style: 'destructive',
                onPress: () => {
                  void (async () => {
                    try {
                      await purgeAIConversation(conversation.id);
                      setTrashed((rows) => rows?.filter((row) => row.id !== conversation.id) ?? null);
                    } catch {
                      setError(t('ลบไม่สำเร็จ', 'Could not delete'));
                    }
                  })();
                },
              },
            ],
          );
        },
      },
      { text: t('ยกเลิก', 'Cancel'), style: 'cancel' },
    ]);
  };

  const emptyTrash = () => {
    Alert.alert(
      t('ล้างถังขยะทั้งหมด?', 'Empty the trash?'),
      t('แชทในถังขยะจะหายไปเลย กู้คืนไม่ได้อีก', 'Everything in the trash goes for good'),
      [
        { text: t('ยกเลิก', 'Cancel'), style: 'cancel' },
        {
          text: t('ล้างทั้งหมด', 'Empty it'),
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                await purgeAllTrashedAIConversations();
                setTrashed([]);
              } catch {
                setError(t('ล้างถังขยะไม่สำเร็จ', 'Could not empty the trash'));
              }
            })();
          },
        },
      ],
    );
  };

  // Both header buttons stay mounted for the life of the sheet and slide in and
  // out with the page. Mounting the back button only on sub-pages meant a fresh
  // glass view on every push — and glass takes most of a second to appear, so
  // its shadow had to be held back that long and then landed late. A button
  // that never unmounts has had its glass since the sheet opened.
  //
  // Each one's visibility is a number 0..1 that moves with the page slide; it
  // drives scale and a small slide, never opacity — fading a glass view's
  // parent is what made the material vanish on the menu.
  const wasRoot = transition ? transition.from === 'root' : page === 'root';
  const isRoot = page === 'root';
  const shown = (atRoot: boolean) => {
    const before = (wasRoot === atRoot) ? 1 : 0;
    const after = (isRoot === atRoot) ? 1 : 0;
    if (before === after) return new Animated.Value(after);
    return Animated.add(before, Animated.multiply(slide, after - before));
  };
  const backShown = shown(false);
  const closeShown = shown(true);
  const slot = (visible: Animated.Value | Animated.AnimatedAddition<number>, fromX: number) => ({
    position: 'absolute' as const,
    transform: [
      { translateX: visible.interpolate({ inputRange: [0, 1], outputRange: [fromX, 0] }) },
      { scale: visible.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0.01, 0.7, 1] }) },
    ],
  });

  useEffect(() => {
    if (!open) return;
    let active = true;
    // The phone opens on the list; the split layout opens with the first subject
    // already in the pane, because an empty half-screen says nothing.
    setPage(width >= SPLIT_AT ? 'title' : 'root');
    setTransition(null);
    setError(null);
    void readFollowUpsEnabled().then((enabled) => { if (active) setFollowUps(enabled); });
    getAISettings()
      .then((view) => {
        if (!active) return;
        setSettings(view);
        setTitle(view.owner_title ?? '');
      })
      .catch(() => { if (active) setError(t('โหลดการตั้งค่าไม่สำเร็จ', 'Could not load settings')); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const patch = async (change: AISettingsPatch) => {
    if (!settings) return;
    const previous = settings;
    setSettings({
      ...settings,
      ...(change.actions_enabled !== undefined ? { actions_enabled: change.actions_enabled } : {}),
      action_types: { ...settings.action_types, ...(change.action_types ?? {}) },
      insight_kinds: { ...settings.insight_kinds, ...(change.insight_kinds ?? {}) },
      ...(change.owner_title !== undefined ? { owner_title: change.owner_title } : {}),
    });
    try {
      const saved = await updateAISettings(change);
      setSettings(saved);
      if (change.owner_title !== undefined) {
        await writeCachedOwnerTitle(saved.owner_title ?? '');
        onOwnerTitle(saved.owner_title ?? '');
      }
    } catch {
      setSettings(previous);
      setError(t('บันทึกไม่สำเร็จ ลองอีกครั้ง', 'Could not save, try again'));
    }
  };

  const commitTitle = () => {
    const next = title.trim();
    if (!settings || next === (settings.owner_title ?? '')) return;
    void patch({ owner_title: next });
  };

  const heading = page === 'root'
    ? t('การตั้งค่า', 'Settings')
    : page === 'title'
      ? t('ชื่อเรียก', 'Name')
      : page === 'actions'
        ? t('ความปลอดภัย', 'Safety')
        : page === 'trash'
          ? t('ถังขยะ', 'Trash')
          : t('การแจ้งเตือน', 'Notifications');

  const loading = !settings ? (
    <View style={{ paddingVertical: 28, alignItems: 'center' }}><ActivityIndicator color={ai.orange} /></View>
  ) : null;

  const wide = width >= SPLIT_AT;
  // What the sidebar should mark as chosen. `renderPage` shadows `page` with its
  // own parameter — deliberately, so it can draw two pages at once during a
  // move — so the current one is captured here where it is still visible.
  const chosen = page;

  // The body of one page. Named `page` on purpose: the checks inside read the
  // parameter, so the same markup can draw the page leaving and the page
  // arriving while a move is on.
  const renderPage = (page: Page) => (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingTop: CONTENT_TOP, paddingBottom: 32 }}>
      {error ? (
        <Text style={{ fontSize: 13, color: '#dc2626', paddingHorizontal: 18, paddingBottom: 8 }}>{error}</Text>
      ) : null}

      {page === 'root' ? (
        <>
          <GroupLabel text={t('ทั่วไป', 'General')} />
          <Group>
            <Row
              first
              icon="person-circle-outline"
              label={t('ชื่อเรียก', 'Name')}
              value={settings?.owner_title?.trim() || t('คุณผู้จัดการ', 'Manager')}
              selected={wide && chosen === 'title'}
              onPress={() => go('title')}
            />
            <Row
              icon="sparkles-outline"
              label={t('แนะนำให้ถาม', 'Suggested questions')}
              toggle={{ on: followUps, onChange: (next) => { setFollowUps(next); void writeFollowUpsEnabled(next); onFollowUps(next); } }}
            />
          </Group>

          <GroupLabel text={t('สิ่งที่ผู้ช่วยทำได้', 'What it can do')} />
          <Group>
            <Row
              first
              icon="shield-checkmark-outline"
              label={t('ความปลอดภัย', 'Safety')}
              selected={wide && chosen === 'actions'}
              onPress={() => go('actions')}
            />
            <Row
              icon="notifications-outline"
              label={t('การแจ้งเตือน', 'Notifications')}
              selected={wide && chosen === 'notifications'}
              onPress={() => go('notifications')}
            />
          </Group>

          <GroupLabel text={t('แชท', 'Chats')} />
          <Group>
            <Row
              first
              icon="trash-outline"
              label={t('ถังขยะ', 'Trash')}
              detail={t('แชทที่ลบไว้ กู้คืนได้ภายใน 7 วัน', 'Deleted chats, restorable for 7 days')}
              selected={wide && chosen === 'trash'}
              onPress={() => { go('trash'); void loadTrash(); }}
            />
          </Group>
        </>
      ) : null}

      {page === 'title' ? (
        <>
          <GroupLabel text={t('ผู้ช่วยจะเรียกคุณแบบนี้ตอนทักทาย', 'The assistant greets you by this')} />
          <Group>
            <View style={{ paddingHorizontal: 16, paddingVertical: 14 }}>
              <TextInput
                value={title}
                onChangeText={setTitle}
                onBlur={commitTitle}
                onSubmitEditing={commitTitle}
                editable={Boolean(settings)}
                maxLength={40}
                returnKeyType="done"
                autoFocus
                placeholder={t('คุณผู้จัดการ', 'Manager')}
                placeholderTextColor={ai.faded}
                accessibilityLabel={t('ชื่อเรียก', 'Name')}
                style={{ minHeight: 44, fontSize: 17, color: ai.ink, paddingVertical: 0 }}
              />
            </View>
          </Group>
          <Text style={{ fontSize: 12.5, color: ai.faded, paddingHorizontal: 18, paddingTop: 10 }}>
            {t('เว้นว่างไว้ก็ได้ ผู้ช่วยจะเรียกว่าคุณผู้จัดการ', 'Leave it empty and it says "Manager"')}
          </Text>
        </>
      ) : null}

      {page === 'actions' ? (
        <>
          <GroupLabel text={t('ทุกอย่างยังต้องกดยืนยันก่อนบันทึกเสมอ', 'Everything still needs your confirmation')} />
          {loading ?? (
            <>
              <Group>
                <Row
                  first
                  label={t('ให้ผู้ช่วยแก้ข้อมูลได้', 'Allow changes')}
                  toggle={{ on: settings!.actions_enabled, onChange: (next) => { void patch({ actions_enabled: next }); } }}
                  disabled={!settings!.feature_available}
                />
              </Group>
              <GroupLabel text={t('เลือกทีละอย่าง', 'Pick them one by one')} />
              <Group>
                {AI_ACTION_TYPES.map((type, index) => (
                  <Row
                    key={type}
                    first={index === 0}
                    label={language === 'th' ? ACTION_LABELS[type].th : ACTION_LABELS[type].en}
                    toggle={{ on: Boolean(settings!.action_types?.[type]), onChange: (next) => { void patch({ action_types: { [type]: next } }); } }}
                    disabled={!settings!.actions_enabled || !settings!.feature_available}
                  />
                ))}
              </Group>
            </>
          )}
        </>
      ) : null}

      {page === 'trash' ? (
        <>
          <GroupLabel text={t('แตะแชทเพื่อกู้คืนหรือลบถาวร', 'Tap a chat to restore it or delete it for good')} />
          {trashBusy && !trashed ? (
            <View style={{ paddingVertical: 28, alignItems: 'center' }}><ActivityIndicator color={ai.orange} /></View>
          ) : (trashed?.length ?? 0) === 0 ? (
            <Group>
              <Row first label={t('ถังขยะว่าง', 'The trash is empty')} />
            </Group>
          ) : (
            <>
              <Group>
                {(trashed ?? []).map((conversation, index) => (
                  <Row
                    key={conversation.id}
                    first={index === 0}
                    label={conversation.title || t('แชทไม่มีชื่อ', 'Untitled chat')}
                    detail={conversation.trashed_at
                      ? t('ลบเมื่อ ' + threadStamp(conversation.trashed_at, language), 'Deleted ' + threadStamp(conversation.trashed_at, language))
                      : undefined}
                    onPress={() => openTrashRow(conversation)}
                  />
                ))}
              </Group>
              <View style={{ marginTop: 20, marginHorizontal: 12 }}>
                <Pressable
                  accessibilityRole="button"
                  onPress={emptyTrash}
                  style={({ pressed }) => ({
                    minHeight: 52,
                    borderRadius: 18,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: pressed ? '#fee2e2' : ai.surface,
                  })}
                >
                  <Text style={{ fontSize: 16, fontWeight: '600', color: '#dc2626' }}>{t('ล้างถังขยะทั้งหมด', 'Empty the trash')}</Text>
                </Pressable>
              </View>
            </>
          )}
        </>
      ) : null}

      {page === 'notifications' ? (
        <>
          <GroupLabel text={t('เรื่องที่ขึ้นใน "ควรรู้วันนี้"', 'What shows under "Today\'s insights"')} />
          {loading ?? (
            <Group>
              {INSIGHT_ROWS.map((row, index) => (
                <Row
                  key={row.key}
                  first={index === 0}
                  label={language === 'th' ? row.th : row.en}
                  toggle={{
                    on: Boolean(settings!.insight_kinds?.[row.key]),
                    onChange: (next) => {
                      const change: Partial<Record<AIInsightKind, boolean>> = { [row.key]: next };
                      if (row.pair) change[row.pair] = next;
                      void patch({ insight_kinds: change });
                    },
                  }}
                />
              ))}
            </Group>
          )}
        </>
      ) : null}
    </ScrollView>
  );

  const fill = { position: 'absolute' as const, top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#f4f2ee' };
  const stage = transition ? (
    <View style={{ flex: 1, overflow: 'hidden' }}>
      {/* The page on its way out: on a push it slips back a little and dims,
          the way the one under a card does; on a pop it slides off to the right. */}
      <Animated.View
        pointerEvents="none"
        style={[
          fill,
          {
            opacity: transition.dir === 'push' ? slide.interpolate({ inputRange: [0, 1], outputRange: [1, 0.78] }) : 1,
            transform: [{ translateX: slide.interpolate({ inputRange: [0, 1], outputRange: [0, transition.dir === 'push' ? -width * 0.28 : width] }) }],
          },
        ]}
      >
        {renderPage(transition.from)}
      </Animated.View>
      {/* The page arriving. No shadow along its edge: a shadow the full height
          of the page drew a dark band down its left and across its top, which
          read as the page being cut off rather than sliding in. Both pages share
          the sheet's colour, so with nothing drawn at the join there is no join. */}
      <Animated.View
        style={[
          fill,
          {
            opacity: transition.dir === 'pop' ? slide.interpolate({ inputRange: [0, 1], outputRange: [0.78, 1] }) : 1,
            transform: [{ translateX: slide.interpolate({ inputRange: [0, 1], outputRange: [transition.dir === 'push' ? width : -width * 0.28, 0] }) }],
          },
        ]}
      >
        {renderPage(page)}
      </Animated.View>
    </View>
  ) : (
    renderPage(page)
  );

  // The list on the left, the subject on the right, a hairline between them —
  // and no page ever moves, so there is nothing to animate.
  const split = (
    <View style={{ flex: 1, flexDirection: 'row' }}>
      <View style={{ width: SIDEBAR, borderRightWidth: 1, borderRightColor: '#e6e3dd' }}>
        {renderPage('root')}
      </View>
      <View style={{ flex: 1, alignItems: 'center' }}>
        {page === 'root' ? (
          <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 24 }}>
            <Text style={{ fontSize: 15, color: ai.faded, textAlign: 'center' }}>{t('เลือกหัวข้อทางซ้าย', 'Pick a subject on the left')}</Text>
          </View>
        ) : (
          <View style={{ flex: 1, width: '100%', maxWidth: DETAIL_MAX }}>{renderPage(page)}</View>
        )}
      </View>
    </View>
  );

  return (
    <BottomSheet open={open} onClose={onClose} heightFraction={1} background="#f4f2ee" label={t('ปิดตั้งค่า', 'Close settings')}>
      <View style={{ flex: 1 }}>
        {wide ? split : stage}
        {/* The header's backdrop, the chat screen's: a blurred copy of what
            scrolls past, masked solid behind the buttons and faded to nothing
            just below them. No panel, no tint — the fade is the edge. */}
        <MaskedView
          pointerEvents="none"
          style={{ position: 'absolute', top: -insets.top, left: 0, right: 0, height: headerPane, zIndex: 2 }}
          maskElement={
            <LinearGradient
              colors={['#000000', '#000000', 'rgba(0,0,0,0.72)', 'rgba(0,0,0,0.42)', 'rgba(0,0,0,0.18)', 'rgba(0,0,0,0.05)', 'rgba(0,0,0,0)']}
              locations={[0, headerSolid, fadeAt(0.3), fadeAt(0.55), fadeAt(0.75), fadeAt(0.9), 1]}
              style={{ flex: 1 }}
            />
          }
        >
          <GlassSurface effect="regular" style={{ flex: 1 }} fallbackStyle={{ backgroundColor: 'rgba(244,242,238,0.9)' }}>
            <View />
          </GlassSurface>
        </MaskedView>
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 3, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingTop: HEADER_ROW_PADDING_TOP, paddingBottom: HEADER_ROW_PADDING_BOTTOM, gap: 8 }}>
          {/* Two titles when there are two columns: the list keeps its own name
              over the sidebar, and the subject's name sits over its pane. */}
          {wide ? (
            <>
              <Text numberOfLines={1} style={{ width: SIDEBAR - 18, paddingLeft: 6, fontSize: 20, fontWeight: '700', color: ai.ink }}>{t('การตั้งค่า', 'Settings')}</Text>
              <Text numberOfLines={1} style={{ flex: 1, paddingLeft: 6, fontSize: 18, fontWeight: '700', color: ai.ink }}>{page === 'root' ? '' : heading}</Text>
              <GlassButton icon="close" label={t('ปิด', 'Close')} onPress={onClose} size={44} />
            </>
          ) : (
          <>
          {/* Back sits where a back button belongs; close sits under the thumb
              that opened the sheet. Each side keeps a slot so the title stays centred. */}
          <View style={{ width: 44, height: 44 }}>
            <Animated.View pointerEvents={isRoot ? 'none' : 'auto'} style={slot(backShown, -26)}>
              <GlassButton icon="chevron-back" label={t('ย้อนกลับ', 'Back')} onPress={() => go('root')} size={44} />
            </Animated.View>
          </View>
          <Animated.View
            style={{
              flex: 1,
              opacity: transition ? slide : 1,
              transform: [{ translateX: transition ? slide.interpolate({ inputRange: [0, 1], outputRange: [transition.dir === 'push' ? 28 : -28, 0] }) : 0 }],
            }}
          >
            <Text numberOfLines={1} style={{ textAlign: 'center', fontSize: 18, fontWeight: '700', color: ai.ink }}>{heading}</Text>
          </Animated.View>
          <View style={{ width: 44, height: 44 }}>
            <Animated.View pointerEvents={isRoot ? 'auto' : 'none'} style={slot(closeShown, 26)}>
              <GlassButton icon="close" label={t('ปิด', 'Close')} onPress={onClose} size={44} />
            </Animated.View>
          </View>
          </>
          )}
        </View>
      </View>
    </BottomSheet>
  );
}
