import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { AppRefreshControl } from '@/src/components/app-shell';
import { AppIcon, type AppIconName } from '@/src/components/app-icon';
import { AppText as Text } from '@/src/components/app-text';
import { money } from '@/src/lib/format';
import {
  expenseCategoryLabel,
  expenseDayLabel,
  expenseTitle,
  type ExpenseDayGroup,
  type ExpenseShare,
} from '@/src/lib/expense-view';
import { palette } from '@/src/theme';
import type { ExpenseCategory, Expense } from '@/src/types/expense';

// The expenses screen's pieces (15 ก.ย. 2569), in the reports screen's
// language: one orange block for the total, white cards with a warm hairline,
// and a day heading that stays at the top of the list while its rows scroll.

type Language = 'th' | 'en';

/** Each category keeps one icon and one tint, on the row, in the chips and in the breakdown. */
export const CATEGORY_LOOK: Record<ExpenseCategory, { icon: AppIconName; wash: string; ink: string }> = {
  ingredient: { icon: 'basket-outline', wash: '#FFF4E8', ink: '#AC3A0B' },
  labor: { icon: 'person-outline', wash: '#EEF2FF', ink: '#4338CA' },
  rent: { icon: 'home-outline', wash: '#F3F0ED', ink: '#5B3A2B' },
  utilities: { icon: 'bulb-outline', wash: '#E0F2FE', ink: '#0369A1' },
  equipment: { icon: 'construct-outline', wash: '#ECFDF5', ink: '#047857' },
  other: { icon: 'ellipsis-horizontal', wash: '#F3F4F6', ink: '#4B5563' },
};

const lookOf = (category: string) => CATEGORY_LOOK[category as ExpenseCategory] ?? CATEGORY_LOOK.other;

/** White steps on the orange block's share bar: the biggest category brightest. */
const SHARE_WHITES = ['rgba(255,255,255,0.95)', 'rgba(255,255,255,0.62)', 'rgba(255,255,255,0.38)', 'rgba(255,255,255,0.24)'];

export function ExpenseHero({ label, total, entries, perDay, shares, language }: {
  label: string;
  total: number;
  entries: number;
  perDay: number;
  shares: ExpenseShare[];
  language: Language;
}) {
  const th = language === 'th';
  const shown = shares.filter((share) => share.amount > 0).slice(0, 4);
  return (
    <LinearGradient
      colors={['#B93A0D', '#D9581F', '#EF7A35']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{ borderRadius: 20, borderCurve: 'continuous', paddingVertical: 12, paddingHorizontal: 16 }}
    >
      <Text numberOfLines={1} style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.9)' }}>{label}</Text>
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={{ fontSize: 20, lineHeight: 28, fontWeight: '600', color: '#fff', fontVariant: ['tabular-nums'] }}>{money(total, language)}</Text>
      <Text numberOfLines={1} style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.9)' }}>
        {th ? `${entries.toLocaleString('th-TH')} รายการ` : `${entries.toLocaleString('en-US')} entries`}
        {perDay > 0 ? (th ? ` · เฉลี่ยวันละ ${money(perDay, language)}` : ` · ${money(perDay, language)} a day`) : ''}
      </Text>
      {shown.length ? (
        <>
          <View style={{ flexDirection: 'row', height: 8, borderRadius: 4, overflow: 'hidden', marginTop: 10, gap: 2 }}>
            {shown.map((share, index) => (
              <View key={share.category} style={{ flexGrow: Math.max(share.amount, total * 0.01), flexBasis: 0, height: 8, backgroundColor: SHARE_WHITES[index] }} />
            ))}
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 2, marginTop: 7 }}>
            {shown.map((share, index) => (
              <View key={share.category} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: SHARE_WHITES[index] }} />
                <Text style={{ fontSize: 11.5, color: '#fff' }}>{`${expenseCategoryLabel(share.category, language)} ${share.percent}%`}</Text>
              </View>
            ))}
          </View>
        </>
      ) : null}
    </LinearGradient>
  );
}

/** The category chips, one row that scrolls sideways when it runs long. */
export function ExpenseChips({ categories, counts, total, value, onChange, language }: {
  categories: ExpenseCategory[];
  counts: Partial<Record<ExpenseCategory, number>>;
  total: number;
  value: ExpenseCategory | 'all';
  onChange: (value: ExpenseCategory | 'all') => void;
  language: Language;
}) {
  const options: { key: ExpenseCategory | 'all'; label: string }[] = [
    { key: 'all', label: `${language === 'th' ? 'ทั้งหมด' : 'All'} ${total}` },
    ...categories.map((category) => ({ key: category, label: `${expenseCategoryLabel(category, language)} ${counts[category] ?? 0}` })),
  ];
  return (
    // flexGrow 0: a sideways ScrollView otherwise grows to fill a locked column.
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 0, maxWidth: '100%' }} contentContainerStyle={{ gap: 6 }}>
      {options.map((option) => {
        const on = option.key === value;
        return (
          <Pressable
            key={option.key}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(option.key)}
            hitSlop={4}
            style={({ pressed }) => ({ paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: on ? palette.textStrong : palette.divider, backgroundColor: on ? palette.textStrong : palette.surface, opacity: pressed ? 0.7 : 1 })}
          >
            <Text style={{ fontSize: 13, fontWeight: '600', color: on ? '#fff' : palette.muted, fontVariant: ['tabular-nums'] }}>{option.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function ExpenseRow({ expense, onPress, language }: { expense: Expense; onPress?: () => void; language: Language }) {
  const look = lookOf(expense.category);
  const fromStock = Boolean(expense.ingredient_transaction_id);
  const title = expenseTitle(expense, language);
  const category = expenseCategoryLabel(expense.category, language);
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${title}, ${category}, ${money(expense.amount, language)}`}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 58, paddingVertical: 7, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: '#F3EDE7', backgroundColor: pressed ? palette.surfaceSubtle : palette.surface })}
    >
      <View style={{ width: 36, height: 36, borderRadius: 11, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center', backgroundColor: look.wash }}>
        <AppIcon name={look.icon} size={19} color={look.ink} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 15, lineHeight: 20, fontWeight: '600', color: palette.textStrong }}>{title}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: 12, lineHeight: 17, color: palette.placeholder }}>{category}</Text>
          {fromStock ? (
            <View style={{ borderRadius: 999, paddingHorizontal: 7, backgroundColor: '#E0F2FE' }}>
              <Text style={{ fontSize: 10.5, lineHeight: 16, fontWeight: '600', color: '#0369A1' }}>{language === 'th' ? 'จากสต๊อก' : 'from stock'}</Text>
            </View>
          ) : null}
        </View>
      </View>
      <Text numberOfLines={1} style={{ fontSize: 15, fontWeight: '700', color: palette.textStrong, fontVariant: ['tabular-nums'] }}>{money(expense.amount, language)}</Text>
      {onPress ? <AppIcon name="chevron-forward" size={15} color={palette.placeholder} /> : <View style={{ width: 0 }} />}
    </Pressable>
  );
}

/**
 * Every entry in the period, a heading for each day that sticks to the top of
 * the list while that day's rows pass under it. Like the reports tables, the
 * bottom edge fades and says how many entries are still below.
 */
export function ExpenseList({ groups, today, onOpen, onRefresh, empty, footer, language }: {
  groups: ExpenseDayGroup[];
  today: string;
  onOpen?: (expense: Expense) => void;
  onRefresh?: () => void | Promise<void>;
  empty: React.ReactNode;
  /** A totals line pinned under the list. */
  footer?: { label: string; value: string };
  language: Language;
}) {
  const [viewport, setViewport] = useState(0);
  const [offset, setOffset] = useState(0);
  const [bottoms, setBottoms] = useState<Record<string, number>>({});

  const children: React.ReactNode[] = [];
  const sticky: number[] = [];
  const rowKeys: string[] = [];
  for (const group of groups) {
    sticky.push(children.length);
    children.push(
      // Two Views on purpose: a sticky header's own style is moved onto the
      // wrapper React Native puts around it, and the child is left with only
      // flex 1 — so a row set on the outer View came out as a column, the date
      // above the amount, cropped at 30pt (seen on iOS, 15 ก.ย. 2569).
      <View key={`d${group.date}`}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 30, paddingHorizontal: 14, backgroundColor: palette.accentSoft, borderBottomWidth: 1, borderBottomColor: '#EFD9C6' }}>
          <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: '600', color: '#8B5E44' }}>{expenseDayLabel(group.date, today, language)}</Text>
          <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: '700', color: palette.textStrong, fontVariant: ['tabular-nums'] }}>{money(group.amount, language)}</Text>
        </View>
      </View>,
    );
    for (const expense of group.items) {
      const key = String(expense.ID);
      rowKeys.push(key);
      children.push(
        <View
          key={key}
          onLayout={(event) => {
            const bottom = event.nativeEvent.layout.y + event.nativeEvent.layout.height;
            setBottoms((current) => (current[key] === bottom ? current : { ...current, [key]: bottom }));
          }}
        >
          <ExpenseRow expense={expense} onPress={onOpen ? () => onOpen(expense) : undefined} language={language} />
        </View>,
      );
    }
  }
  const hidden = viewport > 0 ? rowKeys.filter((key) => (bottoms[key] ?? 0) > offset + viewport + 2).length : 0;

  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      {groups.length ? (
        <View style={{ flex: 1, minHeight: 0 }}>
          <ScrollView
            style={{ flex: 1, backgroundColor: palette.surface }}
            stickyHeaderIndices={sticky}
            onLayout={(event) => setViewport(event.nativeEvent.layout.height)}
            onScroll={(event) => setOffset(event.nativeEvent.contentOffset.y)}
            scrollEventThrottle={32}
            refreshControl={onRefresh ? <AppRefreshControl onRefresh={onRefresh} /> : undefined}
          >
            {children}
          </ScrollView>
          {hidden > 0 ? (
            <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 52, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 7 }}>
              <LinearGradient colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.96)']} locations={[0, 0.7]} style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }} />
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, paddingVertical: 2, paddingHorizontal: 10, borderRadius: 999, backgroundColor: palette.surfaceStrong }}>
                <Text style={{ fontSize: 11.5, fontWeight: '700', color: palette.primaryInk }}>{language === 'th' ? `อีก ${hidden} รายการ` : `${hidden} more`}</Text>
                <AppIcon name="chevron-down" size={12} color={palette.primaryInk} />
              </View>
            </View>
          ) : null}
        </View>
      ) : (
        <View style={{ flex: 1 }}>{empty}</View>
      )}
      {footer && groups.length ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 42, paddingHorizontal: 14, backgroundColor: palette.textStrong }}>
          <Text style={{ fontSize: 13.5, fontWeight: '700', color: '#fff' }}>{footer.label}</Text>
          <Text style={{ fontSize: 13.5, fontWeight: '700', color: '#fff', fontVariant: ['tabular-nums'] }}>{footer.value}</Text>
        </View>
      ) : null}
    </View>
  );
}

/** The tablet's breakdown: each category with a bar against the period's total, its amount and share. */
export function ExpenseBreakdown({ shares, language }: { shares: ExpenseShare[]; language: Language }) {
  const biggest = shares[0]?.amount || 1;
  return (
    <View>
      {shares.map((share) => {
        const look = lookOf(share.category);
        return (
          <View key={share.category} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, paddingHorizontal: 14, borderTopWidth: 1, borderTopColor: '#F3EDE7' }}>
            <View style={{ width: 28, height: 28, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: look.wash }}>
              <AppIcon name={look.icon} size={15} color={look.ink} />
            </View>
            <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
                <Text numberOfLines={1} style={{ flex: 1, fontSize: 13.5, fontWeight: '600', color: palette.textStrong }}>{expenseCategoryLabel(share.category, language)}</Text>
                <Text style={{ fontSize: 11.5, color: palette.placeholder, fontVariant: ['tabular-nums'] }}>{language === 'th' ? `${share.entries} รายการ` : `${share.entries} entries`}</Text>
              </View>
              <View style={{ height: 6, borderRadius: 3, backgroundColor: '#F3EDE7', overflow: 'hidden' }}>
                <View style={{ width: `${Math.max(2, Math.round((share.amount / biggest) * 100))}%`, height: 6, borderRadius: 3, backgroundColor: look.ink }} />
              </View>
            </View>
            <View style={{ width: 84, alignItems: 'flex-end' }}>
              <Text numberOfLines={1} style={{ fontSize: 13.5, fontWeight: '700', color: palette.textStrong, fontVariant: ['tabular-nums'] }}>{money(share.amount, language)}</Text>
              <Text style={{ fontSize: 11.5, color: palette.placeholder, fontVariant: ['tabular-nums'] }}>{`${share.percent}%`}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}
