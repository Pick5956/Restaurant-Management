import { View } from 'react-native';

import { Bone, SkeletonReveal } from '@/src/components/skeleton';
import { spacing } from '@/src/theme';

import { RESERVATION_HEADING_INSET, ReservationDayCard, ReservationRow } from './reservation-day';
import { RESERVATION_COLUMN_GAP, RESERVATION_TIME_COLUMN } from './reservation-row-summary';

// The history before it arrives, in the shapes it will take: a day heading and
// one card of rows, each a time, a table line and a guest line.

const ROWS = 5;

export function ReservationListSkeleton({ label }: { label: string }) {
  return (
    <SkeletonReveal label={label}>
      <View style={{ gap: spacing.sm }}>
        <Bone height={14} radius={6} width={72} style={{ marginLeft: RESERVATION_HEADING_INSET, marginVertical: 3 }} />
        <ReservationDayCard>
          {Array.from({ length: ROWS }, (_, index) => (
            <ReservationRow first={index === 0} key={index}>
              <View style={{ flexDirection: 'row', gap: RESERVATION_COLUMN_GAP }}>
                <View style={{ width: RESERVATION_TIME_COLUMN, paddingTop: 2 }}>
                  <Bone height={18} radius={6} width={40} />
                </View>
                {/* 44 tall, like the two text lines it stands for. */}
                <View style={{ flex: 1, minWidth: 0, gap: 8, paddingVertical: 3 }}>
                  <Bone height={16} radius={6} width="60%" />
                  <Bone height={14} radius={6} width="80%" />
                </View>
              </View>
            </ReservationRow>
          ))}
        </ReservationDayCard>
      </View>
    </SkeletonReveal>
  );
}
