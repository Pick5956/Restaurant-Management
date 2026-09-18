import { Pressable, View } from 'react-native';

import { AppIcon } from '@/src/components/app-icon';
import { AppText as Text } from '@/src/components/app-text';
import type { DisplayLanguage } from '@/src/lib/display-preferences';
import { calendarWeeks, monthTitle } from '@/src/lib/report-view';
import { palette } from '@/src/theme';

// The one month-at-a-time calendar, lifted out of the reports period sheet on
// 16 ก.ย. 2569 so the order archive could pick a day with the same control.
// The frame is the reports card exactly: white, a warm hairline, 16pt corners.
const CARD_EDGE = '#E4D8CD';
const FUTURE = '#D6C3B6';

const WEEKDAYS_TH = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
const WEEKDAYS_EN = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

export type CalendarMonth = { year: number; month: number };

export function calendarMonthOf(date: string): CalendarMonth {
  return { year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)) };
}

export function stepCalendarMonth(current: CalendarMonth, delta: number): CalendarMonth {
  const next = new Date(Date.UTC(current.year, current.month - 1 + delta, 1));
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1 };
}

/**
 * Tap a day to pick it. `picked` shades a range between its two ends and rings
 * each end; a single day is one ringed cell. Days after today cannot be picked,
 * and the month cannot be stepped past the current one.
 */
export function MonthCalendar({ month, onStepMonth, today, picked, onTapDay, language }: {
  month: CalendarMonth;
  onStepMonth: (delta: number) => void;
  today: string;
  picked: { from: string; to: string } | null;
  onTapDay: (day: string) => void;
  language: DisplayLanguage;
}) {
  const th = language === 'th';
  const thisMonth = calendarMonthOf(today);
  const atLatestMonth = month.year > thisMonth.year || (month.year === thisMonth.year && month.month >= thisMonth.month);

  return (
    <View style={{ backgroundColor: palette.surface, borderRadius: 16, borderCurve: 'continuous', borderWidth: 1, borderColor: CARD_EDGE }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 10, paddingTop: 10 }}>
        <Pressable accessibilityRole="button" accessibilityLabel={th ? 'เดือนก่อน' : 'Previous month'} onPress={() => onStepMonth(-1)} hitSlop={6} style={({ pressed }) => ({ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
          <AppIcon name="chevron-back" size={20} color={palette.primaryInk} />
        </Pressable>
        <Text style={{ fontSize: 15, fontWeight: '700', color: palette.textStrong }}>{monthTitle(month.year, month.month, language)}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={th ? 'เดือนถัดไป' : 'Next month'} disabled={atLatestMonth} onPress={() => onStepMonth(1)} hitSlop={6} style={({ pressed }) => ({ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
          <AppIcon name="chevron-forward" size={20} color={atLatestMonth ? FUTURE : palette.primaryInk} />
        </Pressable>
      </View>
      <View style={{ flexDirection: 'row', paddingHorizontal: 8, paddingTop: 6 }}>
        {(th ? WEEKDAYS_TH : WEEKDAYS_EN).map((name) => (
          <Text key={name} style={{ flex: 1, textAlign: 'center', fontSize: 11.5, fontWeight: '600', color: palette.placeholder }}>{name}</Text>
        ))}
      </View>
      <View style={{ paddingHorizontal: 8, paddingBottom: 10, paddingTop: 4, gap: 2 }}>
        {calendarWeeks(month.year, month.month).map((week, index) => (
          <View key={index} style={{ flexDirection: 'row' }}>
            {week.map((day, cellIndex) => {
              if (!day) return <View key={`e${cellIndex}`} style={{ flex: 1, height: 42 }} />;
              const future = day > today;
              const from = picked?.from;
              const to = picked?.to;
              const inside = Boolean(from && to && day >= from && day <= to);
              const edge = day === from || day === to;
              return (
                <View key={day} style={{ flex: 1, height: 42, justifyContent: 'center', backgroundColor: inside && from !== to ? palette.surfaceStrong : 'transparent', borderTopLeftRadius: day === from ? 21 : 0, borderBottomLeftRadius: day === from ? 21 : 0, borderTopRightRadius: day === to ? 21 : 0, borderBottomRightRadius: day === to ? 21 : 0 }}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected: edge, disabled: future }}
                    disabled={future}
                    onPress={() => onTapDay(day)}
                    style={({ pressed }) => ({ alignSelf: 'center', width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: edge ? palette.primary : pressed ? palette.surfaceSubtle : 'transparent' })}
                  >
                    <Text style={{ fontSize: 14.5, fontWeight: edge || day === today ? '700' : '500', color: future ? FUTURE : edge ? '#fff' : day === today ? palette.primaryInk : palette.textStrong, fontVariant: ['tabular-nums'] }}>{Number(day.slice(8))}</Text>
                  </Pressable>
                </View>
              );
            })}
          </View>
        ))}
      </View>
    </View>
  );
}
