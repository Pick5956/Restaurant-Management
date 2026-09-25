import { Pressable, View } from 'react-native';

import { AppIcon } from '@/src/components/app-icon';
import { AppText as Text } from '@/src/components/app-text';
import { planStatusWord, type PlanLanguage, type PlanSummary } from '@/src/lib/table-plan';
import { tileToneFor } from '@/src/lib/table-tile-tone';
import { palette } from '@/src/theme';
import type { TableStatus } from '@/src/types/table';

// "22 โต๊ะ, 58 ที่นั่ง" and, when at least two statuses are present, one pill
// per status with its count. A pill filters the floor; tapping it again clears
// the filter. The card always counts the whole shop, closed tables included:
// this screen is the setup inventory. Service counts stay on the hub.

function count(value: number) {
  return value.toLocaleString('en-US');
}

function StatusPill({ status, value, on, language, onPress }: {
  status: TableStatus;
  value: number;
  on: boolean;
  language: PlanLanguage;
  onPress: () => void;
}) {
  const tone = tileToneFor(status);
  const word = planStatusWord(status, language);
  // No swatch dot (owner, 2026-09-23): the pill is drawn in its own status
  // fill and ink, and the chosen one takes an ink edge and a tick.
  return (
    <Pressable
      accessibilityLabel={`${word} ${value}`}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 32,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 12,
        borderRadius: 999,
        borderWidth: 1.5,
        borderColor: on ? tone.ink : 'transparent',
        backgroundColor: tone.fill,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      {on ? <AppIcon color={tone.ink} name="checkmark" size={14} /> : null}
      <Text style={{ fontSize: 13, lineHeight: 18, fontWeight: '600', color: tone.ink, fontVariant: ['tabular-nums'] }}>{`${word} ${count(value)}`}</Text>
    </Pressable>
  );
}

export function SummaryCard({ summary, status, onStatus, language }: {
  summary: PlanSummary;
  status: TableStatus | null;
  onStatus: (status: TableStatus | null) => void;
  language: PlanLanguage;
}) {
  const th = language === 'th';
  const tables = th ? `${count(summary.tables)} โต๊ะ` : `${count(summary.tables)} ${summary.tables === 1 ? 'table' : 'tables'}`;
  const seats = th ? `, ${count(summary.seats)} ที่นั่ง` : `, ${count(summary.seats)} ${summary.seats === 1 ? 'seat' : 'seats'}`;
  return (
    <View style={{ borderRadius: 18, borderCurve: 'continuous', borderWidth: 1, borderColor: '#E4D8CD', backgroundColor: palette.surface, paddingTop: 12, paddingHorizontal: 16, paddingBottom: 12 }}>
      <Text style={{ fontSize: 17, lineHeight: 24, fontWeight: '600', color: palette.textStrong, fontVariant: ['tabular-nums'] }}>
        {tables}
        <Text style={{ fontSize: 15, fontWeight: '500', color: palette.muted }}>{seats}</Text>
      </Text>
      {summary.pills.length ? (
        <View style={{ marginTop: 10, flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {summary.pills.map((pill) => (
            <StatusPill
              key={pill}
              language={language}
              on={status === pill}
              onPress={() => onStatus(status === pill ? null : pill)}
              status={pill}
              value={summary.counts[pill]}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}
