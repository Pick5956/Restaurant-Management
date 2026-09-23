import { View, type ViewProps } from 'react-native';

import { AppText as Text } from '@/src/components/app-text';
import { palette } from '@/src/theme';

// The frame of the reservation history: a quiet heading over each day, one card
// per day, and rows split by a hairline - the table plan's GroupCard look, so the
// history reads like the screens next to it. A card is never nested in another.

const ROW_HAIRLINE = '#F3EDE7';

/** A row's side padding inside its card. */
export const RESERVATION_ROW_INSET = 14;

/** The heading's inset: the row padding plus the card's 1px edge, so it lines up with the times under it. */
export const RESERVATION_HEADING_INSET = RESERVATION_ROW_INSET + 1;

export function ReservationDayHeader({ label }: { label: string }) {
  return (
    <Text
      accessibilityRole="header"
      numberOfLines={1}
      style={{
        paddingHorizontal: RESERVATION_HEADING_INSET,
        fontSize: 13.5,
        lineHeight: 20,
        fontWeight: '600',
        color: palette.muted,
      }}
    >
      {label}
    </Text>
  );
}

export function ReservationDayCard({ style, children, ...rest }: ViewProps) {
  return (
    <View
      {...rest}
      style={[
        {
          borderRadius: 20,
          borderCurve: 'continuous',
          borderWidth: 1,
          borderColor: palette.divider,
          backgroundColor: palette.surface,
          overflow: 'hidden',
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/** One booking inside a day card. Every row but the first carries the hairline. */
export function ReservationRow({ first, style, children, ...rest }: ViewProps & { first?: boolean }) {
  return (
    <View
      {...rest}
      style={[
        {
          paddingVertical: 12,
          paddingHorizontal: RESERVATION_ROW_INSET,
          borderTopWidth: first ? 0 : 1,
          borderTopColor: ROW_HAIRLINE,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}
