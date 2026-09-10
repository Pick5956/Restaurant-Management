import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Easing, Pressable, ScrollView, Switch, View, useWindowDimensions } from 'react-native';

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

import { BottomSheet, GlassButton } from './chrome';
import { ai } from './theme';

// Settings the way a phone does them: a short list of subjects, each opening its
// own page, rather than every switch in the product on one scroll. Switches save
// as they are flipped; there is no save button to forget.
//
// The trash and chat recovery stay on the web, where there is room to show what
// is in it.

type Page = 'root' | 'title' | 'actions' | 'notifications' | 'trash';

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
      {icon ? <AppIcon name={icon} size={22} color={ai.body} /> : null}
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 16, color: ai.ink }}>{label}</Text>
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
        <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={({ pressed }) => ({ backgroundColor: pressed ? '#f6f4f0' : 'transparent' })}>
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
  const reducedMotion = useReducedMotion();
  const [transition, setTransition] = useState<{ from: Page; dir: 'push' | 'pop' } | null>(null);
  const slide = useRef(new Animated.Value(1)).current;
  const go = (next: Page) => {
    if (next === page) return;
    if (reducedMotion) {
      setPage(next);
      return;
    }
    setTransition({ from: page, dir: next === 'root' ? 'pop' : 'push' });
    setPage(next);
    slide.setValue(0);
    Animated.timing(slide, {
      toValue: 1,
      duration: 340,
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

  useEffect(() => {
    if (!open) return;
    let active = true;
    setPage('root');
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

  // The body of one page. Named `page` on purpose: the checks inside read the
  // parameter, so the same markup can draw the page leaving and the page
  // arriving while a move is on.
  const renderPage = (page: Page) => (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 32 }}>
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
              onPress={() => go('actions')}
            />
            <Row
              icon="notifications-outline"
              label={t('การแจ้งเตือน', 'Notifications')}
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
            opacity: transition.dir === 'push' ? slide.interpolate({ inputRange: [0, 1], outputRange: [1, 0.5] }) : 1,
            transform: [{ translateX: slide.interpolate({ inputRange: [0, 1], outputRange: [0, transition.dir === 'push' ? -width * 0.28 : width] }) }],
          },
        ]}
      >
        {renderPage(transition.from)}
      </Animated.View>
      {/* The page arriving, with a soft edge so it reads as sliding over. */}
      <Animated.View
        style={[
          fill,
          {
            opacity: transition.dir === 'pop' ? slide.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) : 1,
            transform: [{ translateX: slide.interpolate({ inputRange: [0, 1], outputRange: [transition.dir === 'push' ? width : -width * 0.28, 0] }) }],
            shadowColor: '#000',
            shadowOpacity: transition.dir === 'push' ? 0.12 : 0,
            shadowRadius: 14,
            shadowOffset: { width: -4, height: 0 },
          },
        ]}
      >
        {renderPage(page)}
      </Animated.View>
    </View>
  ) : (
    renderPage(page)
  );

  return (
    <BottomSheet open={open} onClose={onClose} heightFraction={1} background="#f4f2ee" label={t('ปิดตั้งค่า', 'Close settings')}>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingTop: 4, paddingBottom: 10, gap: 8 }}>
          {/* Back sits where a back button belongs; close sits under the thumb
              that opened the sheet. Each side keeps a slot so the title stays centred. */}
          {page === 'root' ? (
            <View style={{ width: 44 }} />
          ) : (
            <GlassButton icon="chevron-back" label={t('ย้อนกลับ', 'Back')} onPress={() => go('root')} size={44} />
          )}
          <Animated.View
            style={{
              flex: 1,
              opacity: transition ? slide : 1,
              transform: [{ translateX: transition ? slide.interpolate({ inputRange: [0, 1], outputRange: [transition.dir === 'push' ? 28 : -28, 0] }) : 0 }],
            }}
          >
            <Text numberOfLines={1} style={{ textAlign: 'center', fontSize: 18, fontWeight: '700', color: ai.ink }}>{heading}</Text>
          </Animated.View>
          {page === 'root' ? (
            <GlassButton icon="close" label={t('ปิด', 'Close')} onPress={onClose} size={44} />
          ) : (
            <View style={{ width: 44 }} />
          )}
        </View>

        {stage}
      </View>
    </BottomSheet>
  );
}
