import type { MutableRefObject } from 'react';
import { Pressable, View } from 'react-native';

import type { AppScreenScrollControl } from '@/src/components/app-shell';
import { AppText as Text } from '@/src/components/app-text';
import { ChoiceChips, type ChipRowSync } from '@/src/components/form/parts';
import { IconButton, SearchField } from '@/src/components/ui';
import { COMPACT_BUTTON } from '@/src/lib/compact-header';
import { palette, spacing } from '@/src/theme';

// The menu's row in the compact header (owner, 2026-09-23, the Grab
// reference): once the heading and the full filter bar have scrolled away, a
// reader deep in the dishes keeps the category chips and a round search
// button. "จัดหมวด" stays in the full bar only; leaving the list is not
// reading it.
//
// The search button turns the row into the search field, where it is (owner,
// 24 ก.ย. 2569: "ปุ่มค้นไม่ควรกดแล้วเด้งกลับข้างบน"). The page does not move
// for the field; it moves for the answer: each keystroke starts the results
// from their top, right under the bar, wherever the reader had got to - the
// Grab reference again, the pinned search with a fresh list beneath it.
// ยกเลิก puts the chips back and the keyboard away.
//
// Both act on the page's own state, the same `category` and `search` the full
// bar shows, so the two rows cannot drift apart. Nothing here is Liquid
// Glass: the row fades in with the bar, and glass under a fading parent
// renders flat.

/** Level with the chips beside it; hitSlop brings the target to 44. */
const SEARCH_BUTTON = 36;

export function MenuCompactRow({ category, onCategory, options, chipSync, scrollControlRef, search, searching, onSearch, onOpenSearch, onCloseSearch, t }: {
  category: string;
  onCategory: (value: string) => void;
  /** The same options the full bar shows: "ทุกหมวด" first, then the active categories. */
  options: { label: string; value: string }[];
  /** Shared with the full bar's chips, so the two scroll sideways as one. */
  chipSync?: ChipRowSync;
  scrollControlRef: MutableRefObject<AppScreenScrollControl | null>;
  /** The page's own search text. */
  search: string;
  /** Whether the row is the search field right now. */
  searching: boolean;
  onSearch: (text: string) => void;
  onOpenSearch: () => void;
  onCloseSearch: () => void;
  t: (th: string, en: string) => string;
}) {
  const pick = (value: string) => {
    if (value === category) return;
    // A new filter is read from its top. The jump comes before the list
    // changes and is not animated, so the offset the page reports is already 0
    // when the shorter list lands: an animated scroll still under way would be
    // caught mid-list by the shell's spring-back for a shrunk page and sent to
    // the end instead - and a page left past a shrunk list's end is the pile
    // under the top the owner reported.
    scrollControlRef.current?.scrollTo(0, false);
    onCategory(value);
  };

  const type = (text: string) => {
    // The results are read from their top, under the bar that holds the
    // field: a jump to the hand-off, not to the page's heading. Before the
    // list changes and unanimated, for the same reason `pick` jumps first.
    scrollControlRef.current?.scrollToCompactRow?.(false);
    onSearch(text);
  };

  return (
    // One fixed height in both faces: the shell's hand-off is measured from
    // this row's centre, and a row that changed height with its contents
    // would move the hand-off under a reader who was resting on it.
    <View style={{ height: COMPACT_BUTTON, flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
      {searching ? (
        <>
          <View style={{ minWidth: 0, flex: 1 }}>
            <SearchField
              accessibilityLabel={t('ค้นหาชื่อเมนู', 'Search menu items')}
              autoFocus
              clearLabel={t('ล้างคำค้นหา', 'Clear search')}
              compact
              value={search}
              onChangeText={type}
              placeholder={t('ค้นหาเมนู', 'Search menu')}
            />
          </View>
          {/* Words in the brand ink, as "จัดหมวด" is drawn in the full bar:
              not a third round button beside the field's own clear. The word
              is its own name: no label saying it a second way. */}
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            onPress={onCloseSearch}
            style={({ pressed }) => ({ minHeight: COMPACT_BUTTON, justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}
          >
            <Text numberOfLines={1} style={{ fontSize: 14.5, lineHeight: 20, fontWeight: '600', color: palette.primaryInk }}>
              {t('ยกเลิก', 'Cancel')}
            </Text>
          </Pressable>
        </>
      ) : (
        <>
          <View style={{ minWidth: 0, flex: 1 }}>
            <ChoiceChips
              scroll
              sync={chipSync}
              options={options.map((option) => ({ key: option.value, label: option.label }))}
              value={category}
              onChange={pick}
            />
          </View>
          <IconButton
            accessibilityLabel={t('ค้นหาเมนู', 'Search menu')}
            icon="search-outline"
            onPress={onOpenSearch}
            size={SEARCH_BUTTON}
          />
        </>
      )}
    </View>
  );
}
