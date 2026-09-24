import { Pressable, View } from 'react-native';

import { CompactRowAnchor } from '@/src/components/app-shell';
import { AppText as Text } from '@/src/components/app-text';
import { ChoiceChips, type ChipRowSync } from '@/src/components/form/parts';
import { SearchField } from '@/src/components/ui';
import { palette, spacing } from '@/src/theme';

// The menu manager's controls: the search on its own line, then one row of
// category chips with "จัดหมวด" at its end. It replaced a search box, a
// "หมวด" button and a labelled category dropdown - three differently drawn
// boxes, two of them called หมวด and doing different things (owner,
// 2026-09-23). "จัดหมวด" is drawn as table management draws "เลือก": words in
// the brand ink, not another box.
//
// Once this bar has scrolled away, MenuCompactRow carries the chips and a
// search button in the compact header. The chips row here is the anchor the
// shell hands that row over at: the bar's chips appear exactly as these slide
// up under them, so the chips are never on screen twice.

export function MenuFilterBar({ search, onSearch, onFocusSearch, category, onCategory, options, chipSync, onManageCategories, t }: {
  search: string;
  onSearch: (text: string) => void;
  /** Touching the field opens the bar's search stage and hands the typing to
   *  it, so the page has one search, and it closes the way the order screen's
   *  does (owner, 2026-09-25). */
  onFocusSearch?: () => void;
  category: string;
  onCategory: (value: string) => void;
  /** "ทุกหมวด" first, then the active categories. */
  options: { label: string; value: string }[];
  /** Shared with the compact row's chips, so the two scroll sideways as one. */
  chipSync?: ChipRowSync;
  /** Absent without manage rights. */
  onManageCategories?: () => void;
  t: (th: string, en: string) => string;
}) {
  return (
    <View style={{ gap: spacing.md }}>
      <SearchField
        accessibilityLabel={t('ค้นหาชื่อเมนู', 'Search menu items')}
        clearLabel={t('ล้างคำค้นหา', 'Clear search')}
        value={search}
        onChangeText={onSearch}
        onFocus={onFocusSearch}
        placeholder={t('ค้นหาเมนู', 'Search menu')}
      />
      <CompactRowAnchor style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <View style={{ minWidth: 0, flex: 1 }}>
          <ChoiceChips
            scroll
            sync={chipSync}
            options={options.map((option) => ({ key: option.value, label: option.label }))}
            value={category}
            onChange={onCategory}
          />
        </View>
        {onManageCategories ? (
          <Pressable
            accessibilityLabel={t('จัดการหมวดเมนู', 'Manage categories')}
            accessibilityRole="button"
            hitSlop={8}
            onPress={onManageCategories}
            style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}
          >
            <Text numberOfLines={1} style={{ fontSize: 14.5, lineHeight: 20, fontWeight: '600', color: palette.primaryInk }}>
              {t('จัดหมวด', 'Categories')}
            </Text>
          </Pressable>
        ) : null}
      </CompactRowAnchor>
    </View>
  );
}
