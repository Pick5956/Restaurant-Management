import type { ReactNode } from 'react';
import { View, type ViewProps } from 'react-native';

import { AppText as Text } from '@/src/components/app-text';
import { palette, spacing } from '@/src/theme';

// What a booking says, the same on the phone and the tablet: its time down the
// left edge so a day can be read top to bottom by the clock, then the table,
// then who is coming. The name is the only part that gives way to an ellipsis:
// the phone number and the party size never lose a character.

/**
 * The time column's least width. "19:30" is 40dp in Kanit at the app's scale;
 * 48 keeps a clear gap without taking the width a guest's name needs at 360dp.
 * A minimum, so a larger OS text size widens it instead of clipping the clock.
 */
export const RESERVATION_TIME_COLUMN = 48;
export const RESERVATION_COLUMN_GAP = 12;

export function ReservationSummary({
  clock,
  missingClock,
  title,
  name,
  detail,
  caption,
  trailing,
  footer,
  style,
  ...rest
}: ViewProps & {
  /** "19:30", or null when the booking carries no usable time. */
  clock: string | null;
  /** Said in the time slot when there is no clock: "ไม่ระบุเวลา". */
  missingClock: string;
  /** "T4 ริมน้ำ". */
  title: string;
  name: string;
  /** Everything after the name: "080-000-0000, 2 คน". */
  detail: string;
  /** A muted last line, such as "จองเมื่อ 14 ก.ย. 20:16". */
  caption?: string | null;
  /** Sits at the end of the title line: the status chip. */
  trailing?: ReactNode;
  /** Sits under the text, in the text column: the row's actions. */
  footer?: ReactNode;
}) {
  return (
    <View {...rest} style={[{ flexDirection: 'row', alignItems: 'flex-start', gap: RESERVATION_COLUMN_GAP }, style]}>
      <View style={{ minWidth: RESERVATION_TIME_COLUMN }}>
        {clock ? (
          <Text selectable numberOfLines={1} style={{ fontSize: 16, lineHeight: 22, fontWeight: '600', color: palette.textStrong, fontVariant: ['tabular-nums'] }}>
            {clock}
          </Text>
        ) : (
          <Text selectable numberOfLines={2} style={{ width: RESERVATION_TIME_COLUMN, paddingTop: 2, fontSize: 12.5, lineHeight: 18, fontWeight: '600', color: palette.muted }}>
            {missingClock}
          </Text>
        )}
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minWidth: 0 }}>
          <Text selectable numberOfLines={1} style={{ flexShrink: 1, fontSize: 15, lineHeight: 22, fontWeight: '600', color: palette.textStrong, fontVariant: ['tabular-nums'] }}>
            {title}
          </Text>
          {/* Pulled into the line's own height, so a chip does not push the
              title's baseline away from the clock beside it. */}
          {trailing ? <View style={{ marginLeft: 'auto', marginVertical: -2, flexShrink: 0 }}>{trailing}</View> : null}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', minWidth: 0 }}>
          <Text selectable numberOfLines={1} style={{ flexShrink: 1, fontSize: 13.5, lineHeight: 20, color: palette.text }}>
            {name}
          </Text>
          <Text selectable numberOfLines={1} style={{ flexShrink: 0, fontSize: 13.5, lineHeight: 20, color: palette.muted, fontVariant: ['tabular-nums'] }}>
            {`, ${detail}`}
          </Text>
        </View>
        {caption ? (
          <Text selectable numberOfLines={1} style={{ fontSize: 13, lineHeight: 19, color: palette.muted, fontVariant: ['tabular-nums'] }}>
            {caption}
          </Text>
        ) : null}
        {footer ? <View style={{ marginTop: spacing.sm }}>{footer}</View> : null}
      </View>
    </View>
  );
}
