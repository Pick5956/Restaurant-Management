import { View, type ViewProps } from 'react-native';

import { AppText as Text } from '@/src/components/app-text';
import type { DisplayLanguage } from '@/src/lib/display-preferences';
import { reservationStatusTone, reservationStatusWord } from '@/src/lib/reservation-history';
import { statusTone } from '@/src/theme';
import type { ReservationStatus } from '@/src/types/reservation';

// A booking's status as a word on its own tint - the table plan's status chip,
// with no dot in front of it. StatusBadge's default look draws one, which the
// owner has ruled out everywhere.

export function ReservationStatusChip({ status, language, style, ...rest }: ViewProps & {
  status: ReservationStatus;
  language: DisplayLanguage;
}) {
  const tone = statusTone(reservationStatusTone(status));
  return (
    <View
      {...rest}
      style={[
        {
          minHeight: 26,
          justifyContent: 'center',
          paddingHorizontal: 10,
          borderRadius: 999,
          borderCurve: 'continuous',
          backgroundColor: tone.backgroundColor,
        },
        style,
      ]}
    >
      <Text numberOfLines={1} style={{ fontSize: 12.5, lineHeight: 18, fontWeight: '600', color: tone.color }}>
        {reservationStatusWord(status, language)}
      </Text>
    </View>
  );
}
