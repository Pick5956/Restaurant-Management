import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View, type PressableProps } from 'react-native';

import { BottomSheet } from '@/src/components/ai/chrome';
import { AppIcon } from '@/src/components/app-icon';
import { AppText as Text } from '@/src/components/app-text';
import { SheetTitle } from '@/src/components/inventory/parts';
import { calendarMonthOf, MonthCalendar, stepCalendarMonth } from '@/src/components/month-calendar';
import { EdgeRow, GlassLayer, IconButton } from '@/src/components/ui';
import { COMPACT_BUTTON } from '@/src/lib/compact-header';
import type { DisplayLanguage } from '@/src/lib/display-preferences';
import { money } from '@/src/lib/format';
import {
  archiveDateTimeLine,
  archiveRowTitle,
  archiveTableZone,
  type ArchiveDay,
} from '@/src/lib/order-archive';
import { controlShadow, palette, radius, spacing } from '@/src/theme';
import type { Order } from '@/src/types/order';

// The order archive: search, one day control, and a plain list led by the
// order number. It went through a receipt roll and a ruled grid first (16 ก.ย.
// 2569); the list below is design C from the second round of mocks a day later.

type Copy = (th: string, en: string) => string;

// The detail line's grey: neutral, not the palette's warm brown - the owner
// pointed at a delivery app's list and asked for that grey under the title.
const DETAIL_GREY = '#6B7280';

// ---------------------------------------------------------------- day filter

/** The day control under the search: the assistant screen's glass in a pill, its pale orange wash elsewhere. */
export function ArchiveDayButton({ label, onPress, accessibilityLabel, compact = false, ...rest }: Omit<PressableProps, 'children' | 'style' | 'onPress' | 'accessibilityLabel' | 'accessibilityRole'> & {
  label: string;
  onPress: () => void;
  accessibilityLabel: string;
  /** The compact header's row: the bar's 40 and no glass, because the row
   *  fades in and glass under a fading parent renders flat. The same wash and
   *  edge the glass falls back to, so it reads as the same control. */
  compact?: boolean;
}) {
  const face = (
    // 52 to sit level with the search field it shares a row with.
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, height: compact ? COMPACT_BUTTON : 52, paddingLeft: compact ? 12 : 14, paddingRight: compact ? 10 : 12 }}>
      <AppIcon name="calendar-outline" size={compact ? 17 : 18} color={palette.primaryInk} />
      <Text numberOfLines={1} style={[{ fontSize: 14, fontWeight: '700', color: palette.primaryInk }, compact ? { flexShrink: 1 } : null]}>{label}</Text>
      <AppIcon name="chevron-down" size={16} color={palette.primaryInk} />
    </View>
  );
  return (
    <View style={[{ flexDirection: 'row' }, compact ? { flexShrink: 1, minWidth: 0 } : null]}>
      <Pressable
        {...rest}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        onPress={onPress}
        style={({ pressed }) => ({
          ...(compact ? { flexShrink: 1, minWidth: 0 } : null),
          borderRadius: radius.full,
          ...controlShadow,
          opacity: pressed ? 0.78 : 1,
          transform: [{ scale: pressed ? 0.985 : 1 }],
        })}
      >
        {compact ? (
          <View style={{ borderRadius: radius.full, borderWidth: 1, borderColor: palette.controlBorder, backgroundColor: palette.primaryWash }}>
            {face}
          </View>
        ) : (
          <GlassLayer
            style={{ borderRadius: radius.full }}
            // The glass Button's wash: pale orange with the orange ink on it, and
            // a real border where there is no material to give the pill an edge.
            tint={palette.primaryWash}
            fallback={palette.primaryWash}
            fallbackBorder={palette.controlBorder}
          >
            {face}
          </GlassLayer>
        )}
      </Pressable>
    </View>
  );
}

/**
 * The compact header's row for the archive (the owner's Grab reference, 23
 * ก.ย. 2569): the day control and a round search button, the two things a
 * reader deep in the list reaches for. Both act on the page's own state - the
 * day opens the screen's one day sheet, search goes back to the page's field -
 * so nothing here can drift from the full controls at the top.
 */
export function ArchiveCompactRow({ dayLabel, dayAccessibilityLabel, onDayPress, searchLabel, onSearchPress }: {
  dayLabel: string;
  dayAccessibilityLabel: string;
  onDayPress: () => void;
  searchLabel: string;
  onSearchPress: () => void;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm }}>
      <ArchiveDayButton compact label={dayLabel} accessibilityLabel={dayAccessibilityLabel} onPress={onDayPress} />
      <IconButton icon="search-outline" accessibilityLabel={searchLabel} onPress={onSearchPress} size={COMPACT_BUTTON} />
    </View>
  );
}

/** Pick one day for the list, or every day. A tap applies at once, like the reports presets. */
export function ArchiveDaySheet({ open, onClose, date, today, onApply, language }: {
  open: boolean;
  onClose: () => void;
  date: string | null;
  today: string;
  onApply: (date: string | null) => void;
  language: DisplayLanguage;
}) {
  const th = language === 'th';
  const [month, setMonth] = useState(() => calendarMonthOf(date ?? today));
  useEffect(() => {
    if (open) setMonth(calendarMonthOf(date ?? today));
  }, [date, open, today]);
  const allDays = date === null;

  return (
    <BottomSheet open={open} onClose={onClose} heightFraction={0.72} label={th ? 'ปิด' : 'Close'} showClose>
      <SheetTitle title={th ? 'เลือกวัน' : 'Choose a day'} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 28, gap: 16 }}>
        <View style={{ flexDirection: 'row' }}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: allDays }}
            onPress={() => { onApply(null); onClose(); }}
            style={({ pressed }) => ({ paddingVertical: 7, paddingHorizontal: 13, borderRadius: 999, borderWidth: 1, borderColor: allDays ? palette.primary : palette.accentMuted, backgroundColor: allDays ? palette.primary : palette.surface, opacity: pressed ? 0.7 : 1 })}
          >
            <Text style={{ fontSize: 13.5, fontWeight: '600', color: allDays ? '#fff' : palette.primaryInk }}>{th ? 'ทุกวัน' : 'All days'}</Text>
          </Pressable>
        </View>
        <MonthCalendar
          month={month}
          onStepMonth={(delta) => setMonth((current) => stepCalendarMonth(current, delta))}
          today={today}
          picked={date ? { from: date, to: date } : null}
          onTapDay={(day) => { onApply(day); onClose(); }}
          language={language}
        />
      </ScrollView>
    </BottomSheet>
  );
}

// ---------------------------------------------------------------- the list

// Design C, chosen 17 ก.ย. 2569 from four mocked treatments of the data area:
// a plain transaction list in the app's own EdgeRow language - no header, no
// boxes, a hairline between rows. The order number is the loud thing on each
// row ("ต้องแสดงเลขออเดอร์ชัดๆ ไม่ใช่โต๊ะชัดกว่า"); under it two grey lines -
// item count with the table and its zone, then the full date - and the amount
// on the right.

function detailLines(order: Order, language: DisplayLanguage, copy: Copy): [string, string] {
  const count = order.items?.length || 0;
  const items = copy(`${count.toLocaleString('th-TH')} รายการ`, `${count.toLocaleString('en-US')} ${count === 1 ? 'item' : 'items'}`);
  // A slot never sits empty: a table without a zone says so, a takeaway
  // without a name says so (owner's rule, 17 ก.ย. 2569: "ถ้ามันไม่มีโซนก็ใส่มาว่าไม่มีโซน").
  const where = order.order_type === 'takeaway'
    ? `${archiveRowTitle(order, copy)}, ${order.customer_name?.trim() || copy('ไม่ระบุชื่อ', 'No name')}`
    : `${archiveRowTitle(order, copy)} ${archiveTableZone(order) || copy('ไม่มีโซน', 'No zone')}`;
  return [`${items}, ${where}`, archiveDateTimeLine(order.opened_at, language)];
}

export function ArchiveList({ days, today, language, copy, onOpen }: {
  days: ArchiveDay[];
  today: string;
  language: DisplayLanguage;
  copy: Copy;
  onOpen: (order: Order) => void;
}) {
  return (
    <View>
      {days.flatMap((day) => day.orders.map((order) => {
        const cancelled = order.status === 'cancelled';
        return (
          <EdgeRow
            key={order.ID}
            title={order.order_number}
            // Sized to the owner's reference (a delivery app's order list, 17 ก.ย.
            // 2569): the number at the row title's own 16/600, two detail lines
            // in a neutral grey - what and where, then the full date - and the
            // amount a step larger at a medium weight.
            titleStyle={[
              { fontVariant: ['tabular-nums'] },
              cancelled ? { color: palette.placeholder, textDecorationLine: 'line-through' } : null,
            ]}
            detailContent={(
              <View style={{ gap: 1 }}>
                {detailLines(order, language, copy).map((line) => (
                  <Text key={line} numberOfLines={1} selectable style={{ color: DETAIL_GREY, fontSize: 14, lineHeight: 22, fontVariant: ['tabular-nums'] }}>{line}</Text>
                ))}
              </View>
            )}
            trailing={(
              <Text numberOfLines={1} selectable style={{ fontSize: 18, lineHeight: 26, fontWeight: '500', color: cancelled ? palette.danger : palette.textStrong, fontVariant: ['tabular-nums'] }}>
                {cancelled ? copy('ยกเลิก', 'Cancelled') : money(order.grand_total, language)}
              </Text>
            )}
            showChevron={false}
            accessibilityLabel={`${order.order_number} ${archiveRowTitle(order, copy)} ${money(order.grand_total, language)}`}
            onPress={() => onOpen(order)}
            style={{ borderBottomWidth: 1, borderBottomColor: palette.divider }}
          />
        );
      }))}
    </View>
  );
}
