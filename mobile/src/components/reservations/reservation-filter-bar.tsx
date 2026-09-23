import * as Haptics from 'expo-haptics';
import { Pressable, View } from 'react-native';

import { AppText as Text } from '@/src/components/app-text';
import { Bone } from '@/src/components/skeleton';
import type { DisplayLanguage } from '@/src/lib/display-preferences';
import {
  RESERVATION_FILTERS,
  reservationFilterCount,
  reservationFilterWord,
  type ReservationCounts,
  type ReservationFilter,
} from '@/src/lib/reservation-history';
import { controlShadow, palette, radius } from '@/src/theme';

// The four status filters as one row of equal segments that always fits,
// down to a 320dp phone. It replaced a chip row that scrolled sideways with no
// sign that it did, so "ยกเลิก 10" sat cut off at the right edge. The count
// stands over the word so the four fit without either being shortened. The
// look is the chip row's own: the chosen one filled orange, the rest white
// with the control edge.

export function ReservationFilterBar({ value, onChange, counts, countsLoading, language }: {
  value: ReservationFilter;
  onChange: (filter: ReservationFilter) => void;
  /** Null when the counts are not known: while loading, or after a failed load. */
  counts: ReservationCounts | null;
  /** The first load is still out: a bone holds the count's place. */
  countsLoading: boolean;
  language: DisplayLanguage;
}) {
  const locale = language === 'th' ? 'th-TH' : 'en-US';
  return (
    <View style={{ width: '100%', maxWidth: 560, alignSelf: 'center', flexDirection: 'row', gap: 6 }}>
      {RESERVATION_FILTERS.map((filter) => {
        const selected = filter === value;
        const word = reservationFilterWord(filter, language);
        const count = counts ? reservationFilterCount(filter, counts).toLocaleString(locale) : null;
        const ink = selected ? palette.primaryText : palette.textStrong;
        return (
          <Pressable
            accessibilityLabel={count === null ? word : `${word} ${count}`}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            key={filter}
            onPress={() => {
              if (selected) return;
              void Haptics.selectionAsync().catch(() => undefined);
              onChange(filter);
            }}
            style={({ pressed }) => ({
              flex: 1,
              minWidth: 0,
              minHeight: 52,
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: 3,
              paddingVertical: 6,
              borderRadius: radius.md,
              borderCurve: 'continuous',
              borderWidth: 1,
              borderColor: selected ? palette.primary : palette.borderStrong,
              backgroundColor: selected ? palette.primary : palette.surface,
              ...controlShadow,
              opacity: pressed ? 0.72 : 1,
            })}
          >
            {count !== null ? (
              <Text adjustsFontSizeToFit minimumFontScale={0.8} numberOfLines={1} style={{ alignSelf: 'stretch', textAlign: 'center', fontSize: 15, lineHeight: 20, fontWeight: '600', color: ink, fontVariant: ['tabular-nums'] }}>
                {count}
              </Text>
            ) : countsLoading ? (
              <Bone height={14} onColor={selected} radius={5} width={22} style={{ marginVertical: 3 }} />
            ) : null}
            {/* Shrinks a step rather than cut "Cancelled" or "กำลังจอง" on a 320dp phone. */}
            <Text adjustsFontSizeToFit minimumFontScale={0.8} numberOfLines={1} style={{ alignSelf: 'stretch', textAlign: 'center', fontSize: 12.5, lineHeight: 17, fontWeight: '600', color: selected ? palette.primaryText : palette.muted }}>
              {word}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
