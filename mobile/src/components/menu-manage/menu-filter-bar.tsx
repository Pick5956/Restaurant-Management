import type { Ref } from 'react';
import { Pressable, View, type TextInput } from 'react-native';

import { AppText as Text } from '@/src/components/app-text';
import { ChoiceChips } from '@/src/components/form/parts';
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
// search button in the compact header; that button puts the caret back in the
// field here through `searchRef`.

export function MenuFilterBar({ search, onSearch, searchRef, category, onCategory, options, onManageCategories, t }: {
  search: string;
  onSearch: (text: string) => void;
  searchRef?: Ref<TextInput>;
  category: string;
  onCategory: (value: string) => void;
  /** "ทุกหมวด" first, then the active categories. */
  options: { label: string; value: string }[];
  /** Absent without manage rights. */
  onManageCategories?: () => void;
  t: (th: string, en: string) => string;
}) {
  return (
    <View style={{ gap: spacing.md }}>
      <SearchField
        accessibilityLabel={t('ค้นหาชื่อเมนู', 'Search menu items')}
        clearLabel={t('ล้างคำค้นหา', 'Clear search')}
        inputRef={searchRef}
        value={search}
        onChangeText={onSearch}
        placeholder={t('ค้นหาเมนู', 'Search menu')}
      />
      <View style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
        <View style={{ minWidth: 0, flex: 1 }}>
          <ChoiceChips
            scroll
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
      </View>
    </View>
  );
}
