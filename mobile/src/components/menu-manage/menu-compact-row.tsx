import type { MutableRefObject, RefObject } from 'react';
import { View, type TextInput } from 'react-native';

import type { AppScreenScrollControl } from '@/src/components/app-shell';
import { ChoiceChips } from '@/src/components/form/parts';
import { IconButton } from '@/src/components/ui';
import { spacing } from '@/src/theme';

// The menu's row in the compact header (owner, 2026-09-23, the Grab
// reference): once the heading and the full filter bar have scrolled away, a
// reader deep in the dishes keeps the category chips and a round search
// button. "จัดหมวด" stays in the full bar only; leaving the list is not
// reading it.
//
// Both act on the page's own state, the same `category` the full bar shows, so
// the two rows cannot drift apart. Nothing here is Liquid Glass: the row fades
// in with the bar, and glass under a fading parent renders flat.

/** Level with the chips beside it; hitSlop brings the target to 44. */
const SEARCH_BUTTON = 36;

export function MenuCompactRow({ category, onCategory, options, scrollControlRef, searchRef, t }: {
  category: string;
  onCategory: (value: string) => void;
  /** The same options the full bar shows: "ทุกหมวด" first, then the active categories. */
  options: { label: string; value: string }[];
  scrollControlRef: MutableRefObject<AppScreenScrollControl | null>;
  /** The full bar's search field. */
  searchRef: RefObject<TextInput | null>;
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

  const search = () => {
    // Not animated either: the keyboard coming up for the field runs its own
    // unanimated scroll on iOS, which cuts an animated one short wherever it
    // has got to.
    scrollControlRef.current?.scrollTo(0, false);
    // A frame later, so the field is back on screen when it takes the caret.
    requestAnimationFrame(() => searchRef.current?.focus());
  };

  return (
    <View style={{ minHeight: SEARCH_BUTTON, flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
      <View style={{ minWidth: 0, flex: 1 }}>
        <ChoiceChips
          scroll
          options={options.map((option) => ({ key: option.value, label: option.label }))}
          value={category}
          onChange={pick}
        />
      </View>
      <IconButton
        accessibilityLabel={t('ค้นหาเมนู', 'Search menu')}
        icon="search-outline"
        onPress={search}
        size={SEARCH_BUTTON}
      />
    </View>
  );
}
