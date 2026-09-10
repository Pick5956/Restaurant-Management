import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Easing, Keyboard, LayoutAnimation, Platform, Pressable, ScrollView, TextInput as NativeTextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';

import { AppIcon } from '@/src/components/app-icon';
import { AppText as Text } from '@/src/components/app-text';
import { AppTextInput as TextInput } from '@/src/components/app-text-input';
import { matchesThreadQuery, threadGroup, threadGroupLabel, threadStamp, type AIThreadGroup } from '@/src/lib/ai-chat';
import type { DisplayLanguage } from '@/src/lib/display-preferences';
import type { AIConversationSummary } from '@/src/types/ai';

import { BottomSheet, GlassButton, SwipeRow } from './chrome';
import { ai } from './theme';

// The chat list as a phone shows a list of sessions: no cards, no dividers, just
// a marker, a name and one grey line under it, grouped by day. The two things
// you actually came to do — start a chat, find one — float at the bottom where a
// thumb reaches, instead of sitting in the header.

const GROUP_ORDER: AIThreadGroup[] = ['today', 'yesterday', 'week', 'older'];

export function ChatListSheet({
  open,
  onClose,
  conversations,
  loading,
  activeId,
  language,
  onOpen,
  onNew,
  onRename,
  onDelete,
}: {
  open: boolean;
  onClose: () => void;
  conversations: AIConversationSummary[] | null;
  loading: boolean;
  activeId: string | null;
  language: DisplayLanguage;
  onOpen: (conversationId: string) => void;
  onNew: () => void;
  onRename: (conversationId: string, title: string) => Promise<void>;
  onDelete: (conversationId: string) => Promise<void>;
}) {
  const t = (th: string, en: string) => (language === 'th' ? th : en);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [editing, setEditing] = useState<{ id: string; title: string } | null>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const editInput = useRef<NativeTextInput | null>(null);
  const insets = useSafeAreaInsets();

  // The bar rides on the keyboard, and travels with it: iOS reports how long its
  // own slide takes, so matching that duration is what keeps the two together.
  // Setting the offset outright made the bar jump home while the keyboard was
  // still on its way down.
  const lift = useRef(new Animated.Value(0)).current;
  const bottomInset = insets.bottom;
  // The composer behind this sheet raises the keyboard too; without this the
  // hidden bar would follow it.
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => {
    const glide = (to: number, duration: number) => {
      Animated.timing(lift, {
        toValue: to,
        duration: duration || 250,
        easing: Easing.out(Easing.ease),
        useNativeDriver: false,
      }).start();
    };
    const show = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      (event) => {
        if (!openRef.current) return;
        const height = event.endCoordinates.height;
        setKeyboardHeight(height);
        // The sheet already clears the home indicator; only the rest is ours.
        glide(Math.max(0, height - bottomInset), event.duration ?? 250);
      },
    );
    const hide = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      (event) => {
        if (!openRef.current) return;
        setKeyboardHeight(0);
        glide(0, event.duration ?? 250);
      },
    );
    return () => { show.remove(); hide.remove(); };
  }, [bottomInset, lift]);

  const liftedBy = keyboardHeight > 0 ? Math.max(0, keyboardHeight - bottomInset) : 0;

  useEffect(() => {
    if (!open) {
      setQuery('');
      setSearching(false);
      setEditing(null);
    }
    // The bar sits on the keyboard, so it has to start each visit on the floor.
    // Closing the sheet while the keyboard is up does not always report the
    // keyboard going away, which used to leave the bar stranded mid-screen the
    // next time the list was opened.
    setKeyboardHeight(0);
    lift.setValue(0);
  }, [lift, open]);

  const groups = useMemo(() => {
    const now = new Date();
    const map = new Map<AIThreadGroup, AIConversationSummary[]>();
    for (const conversation of conversations ?? []) {
      if (!matchesThreadQuery(conversation.title, query)) continue;
      const group = threadGroup(conversation.updated_at, now);
      map.set(group, [...(map.get(group) ?? []), conversation]);
    }
    return GROUP_ORDER.filter((group) => map.has(group)).map((group) => ({ group, rows: map.get(group) ?? [] }));
  }, [conversations, query]);

  const commitRename = async () => {
    const current = editing;
    setEditing(null);
    if (!current) return;
    const title = current.title.trim();
    if (!title) return;
    try {
      await onRename(current.id, title);
    } catch {
      Alert.alert(t('เปลี่ยนชื่อไม่สำเร็จ', 'Could not rename'), t('ลองอีกครั้ง', 'Try again'));
    }
  };

  // The row currently slid open, if any, and how to close it.
  const openSwipe = useRef<{ id: string; close: () => void } | null>(null);
  const onRowWillOpen = (id: string, close: () => void) => {
    if (openSwipe.current && openSwipe.current.id !== id) openSwipe.current.close();
    openSwipe.current = { id, close };
  };

  const confirmDelete = (conversation: AIConversationSummary) => {
    Alert.alert(
      t('ลบแชทนี้ไหม?', 'Delete this chat?'),
      t('แชทจะย้ายไปถังขยะ กู้คืนได้ภายใน 7 วันจากตั้งค่าผู้ช่วยบนเว็บ', 'The chat moves to the trash and can be restored within 7 days from the web settings'),
      [
        { text: t('ยกเลิก', 'Cancel'), style: 'cancel' },
        {
          text: t('ย้ายไปถังขยะ', 'Move to trash'),
          style: 'destructive',
          onPress: () => {
            // The rows below slide up into the gap rather than jumping.
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
            void onDelete(conversation.id);
          },
        },
      ],
    );
  };

  const openMenu = (conversation: AIConversationSummary) => {
    Alert.alert(conversation.title || t('แชทไม่มีชื่อ', 'Untitled chat'), undefined, [
      {
        text: t('เปลี่ยนชื่อ', 'Rename'),
        onPress: () => {
          setEditing({ id: conversation.id, title: conversation.title });
          setTimeout(() => editInput.current?.focus(), 50);
        },
      },
      { text: t('ลบ', 'Delete'), style: 'destructive', onPress: () => confirmDelete(conversation) },
      { text: t('ยกเลิก', 'Cancel'), style: 'cancel' },
    ]);
  };

  return (
    <BottomSheet open={open} onClose={onClose} heightFraction={1} background="#f4f2ee" label={t('ปิดรายการแชท', 'Close chat list')}>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingTop: 4, paddingBottom: 6, gap: 8 }}>
          <View style={{ width: 44 }} />
          <Text style={{ flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '700', color: ai.ink }}>{t('แชท', 'Chats')}</Text>
          <GlassButton icon="close" label={t('ปิด', 'Close')} onPress={onClose} size={44} />
        </View>


        <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ paddingBottom: 120 + liftedBy, paddingHorizontal: 18 }}>
          {loading && !conversations ? (
            <View style={{ paddingVertical: 28, alignItems: 'center' }}><ActivityIndicator color={ai.orange} /></View>
          ) : groups.length === 0 ? (
            <Text style={{ fontSize: 14, color: ai.faded, textAlign: 'center', paddingVertical: 30 }}>
              {query.trim()
                ? t('ไม่มีแชทที่ชื่อตรงกับคำค้น', 'No chat matches that search')
                : t('ยังไม่มีแชท ถามอะไรสักอย่างแล้วแชทจะมาอยู่ที่นี่', 'No chats yet. Ask something and it will show up here')}
            </Text>
          ) : (
            groups.map(({ group, rows }) => (
              <View key={group}>
                <Text style={{ fontSize: 15, color: ai.faded, paddingTop: 22, paddingBottom: 6 }}>
                  {threadGroupLabel(group, language)}
                </Text>
                {rows.map((conversation) => {
                  const active = conversation.id === activeId;
                  const isEditing = editing?.id === conversation.id;
                  return (
                    <SwipeRow
                      key={conversation.id}
                      id={conversation.id}
                      background="#f4f2ee"
                      deleteLabel={t('ลบแชท', 'Delete chat')}
                      onDelete={() => confirmDelete(conversation)}
                      onWillOpen={onRowWillOpen}
                    >
                    {(slidOpen) => (
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => { if (!isEditing) { onClose(); onOpen(conversation.id); } }}
                      onLongPress={() => openMenu(conversation)}
                      style={({ pressed }) => ({
                        flexDirection: 'row',
                        alignItems: 'flex-start',
                        gap: 14,
                        paddingVertical: 13,
                        paddingRight: 4,
                        opacity: pressed ? 0.6 : 1,
                      })}
                    >
                      <View
                        style={{
                          width: 9,
                          height: 9,
                          borderRadius: 5,
                          marginTop: 8,
                          backgroundColor: active ? ai.orange : '#c9c4bc',
                        }}
                      />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        {isEditing ? (
                          <TextInput
                            ref={editInput}
                            value={editing.title}
                            onChangeText={(title) => setEditing({ id: conversation.id, title })}
                            onSubmitEditing={() => { void commitRename(); }}
                            onBlur={() => { void commitRename(); }}
                            autoFocus
                            selectTextOnFocus
                            returnKeyType="done"
                            accessibilityLabel={t('ชื่อแชท', 'Chat title')}
                            style={{ fontSize: 18, lineHeight: 25, color: ai.ink, paddingVertical: 0, borderBottomWidth: 1.5, borderBottomColor: ai.orange }}
                          />
                        ) : (
                          <Text numberOfLines={2} style={{ fontSize: 18, lineHeight: 25, fontWeight: '600', color: ai.ink }}>
                            {conversation.title || t('แชทไม่มีชื่อ', 'Untitled chat')}
                          </Text>
                        )}
                        <Text style={{ fontSize: 13.5, lineHeight: 19, color: ai.faded, marginTop: 1 }}>
                          {isEditing
                            ? t('พิมพ์ชื่อใหม่แล้วกด Done', 'Type a new name, then Done')
                            : active
                              ? t(`เปิดอยู่ · ${threadStamp(conversation.updated_at, language)}`, `Open · ${threadStamp(conversation.updated_at, language)}`)
                              : threadStamp(conversation.updated_at, language)}
                        </Text>
                      </View>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={t('ตัวเลือก', 'Options')}
                        hitSlop={10}
                        disabled={slidOpen}
                        onPress={() => openMenu(conversation)}
                        // Kept in the layout, just not shown: the row must not
                        // reflow while it is sliding.
                        style={{ width: 30, height: 30, alignItems: 'center', justifyContent: 'center', marginTop: 2, opacity: slidOpen ? 0 : 1 }}
                      >
                        <AppIcon name="ellipsis-horizontal" size={18} color="#c9c4bc" />
                      </Pressable>
                    </Pressable>
                    )}
                    </SwipeRow>
                  );
                })}
              </View>
            ))
          )}
        </ScrollView>

        {/* Everything this screen is for sits at the bottom, in reach of a thumb.
            iOS has no ready-made search bar for React Native, and the one in the
            reference floats over the list rather than sitting in a header, so this
            is built here: the field rides above the keyboard and the list keeps
            filtering as it is typed. */}
        <Animated.View style={{ position: 'absolute', left: 0, right: 0, bottom: lift }}>
          <LinearGradient
            pointerEvents="none"
            colors={['rgba(244,242,238,0)', 'rgba(244,242,238,0.85)', '#f4f2ee']}
            locations={[0, 0.55, 1]}
            style={{ height: 56 }}
          />
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 18, backgroundColor: '#f4f2ee' }}>
            {searching ? (
              <>
                <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, height: 56, paddingHorizontal: 20, borderRadius: 28, backgroundColor: ai.surface, shadowColor: '#3d2b1f', shadowOpacity: 0.12, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 5 }}>
                  <AppIcon name="search-outline" size={22} color={ai.faint} />
                  <TextInput
                    value={query}
                    onChangeText={setQuery}
                    autoFocus
                    // Same as SearchField: the return key already reads Search.
                    omitKeyboardDoneBar
                    returnKeyType="search"
                    placeholder={t('ค้นหา', 'Search')}
                    placeholderTextColor={ai.faded}
                    accessibilityLabel={t('ค้นหาแชท', 'Search chats')}
                    style={{ flex: 1, fontSize: 17, color: ai.ink, paddingVertical: 0 }}
                  />
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('ปิดการค้นหา', 'Close search')}
                  onPress={() => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setQuery(''); setSearching(false); }}
                  style={({ pressed }) => ({
                    width: 56,
                    height: 56,
                    borderRadius: 28,
                    backgroundColor: ai.surface,
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: pressed ? 0.85 : 1,
                    shadowColor: '#3d2b1f',
                    shadowOpacity: 0.12,
                    shadowRadius: 10,
                    shadowOffset: { width: 0, height: 4 },
                    elevation: 5,
                  })}
                >
                  <AppIcon name="close" size={26} color={ai.ink} />
                </Pressable>
              </>
            ) : (
              <>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('ค้นหาแชท', 'Search chats')}
                  onPress={() => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setSearching(true); }}
                  style={({ pressed }) => ({
                    width: 52,
                    height: 52,
                    borderRadius: 26,
                    backgroundColor: ai.surface,
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: pressed ? 0.85 : 1,
                    shadowColor: '#3d2b1f',
                    shadowOpacity: 0.16,
                    shadowRadius: 10,
                    shadowOffset: { width: 0, height: 4 },
                    elevation: 6,
                  })}
                >
                  <AppIcon name="search-outline" size={22} color={ai.ink} />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('แชทใหม่', 'New chat')}
                  onPress={() => { onClose(); onNew(); }}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 8,
                    height: 52,
                    paddingHorizontal: 22,
                    borderRadius: 26,
                    backgroundColor: '#1f1a17',
                    opacity: pressed ? 0.85 : 1,
                    shadowColor: '#3d2b1f',
                    shadowOpacity: 0.22,
                    shadowRadius: 12,
                    shadowOffset: { width: 0, height: 5 },
                    elevation: 8,
                  })}
                >
                  <AppIcon name="add" size={22} color="#ffffff" />
                  <Text style={{ fontSize: 16, fontWeight: '600', color: '#ffffff' }}>{t('แชทใหม่', 'New chat')}</Text>
                </Pressable>
              </>
            )}
          </View>
        </Animated.View>
      </View>
    </BottomSheet>
  );
}
