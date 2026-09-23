import { Pressable, View } from 'react-native';

import { AppText as Text } from '@/src/components/app-text';
import { AppTextInput as TextInput } from '@/src/components/app-text-input';
import { useRepeatPress } from '@/src/components/table-plan/count-stepper';
import { hapticSelect } from '@/src/components/table-plan/plan-context';
import { RoundKey } from '@/src/components/table-plan/sheet-kit';
import { clampGuestCount, GUEST_COUNT_MAX, GUEST_COUNT_MIN, QUICK_GUEST_COUNTS } from '@/src/lib/guest-count';
import { controlShadow, palette, radius, spacing } from '@/src/theme';

// How many people a table is opened or booked for. The stepper keeps its shape
// and place (− the count +, 52pt, the number in the middle); its keys are the
// tinted round keys of the table-management stepper, because the glass ones
// fell back to white on a white card everywhere but iOS 26 and left two bare
// glyphs. What changed is the row under it. That row used to be two separate
// buttons, +5 then −5, which put the jump down after the jump up and made five
// boxes out of one number. It is now one rail of the party sizes a waiter says
// most, and anything past six is held or typed: holding − or + runs the count,
// and a tap on the number selects it for typing.

const KEY_SIZE = 52;
const THUMB_HEIGHT = 38;

type GuestCountPickerProps = {
  label: string;
  /** What the field holds. It may be empty while the waiter types. */
  text: string;
  /** The count every read uses, already clamped. */
  count: number;
  onChangeText: (text: string) => void;
  onChange: (count: number) => void;
  onBlur: () => void;
  decreaseLabel: string;
  increaseLabel: string;
  /** "4 คน": what a screen reader says for one of the quick counts. */
  quickLabel: (count: number) => string;
};

export function GuestCountPicker({
  label,
  text,
  count,
  onChangeText,
  onChange,
  onBlur,
  decreaseLabel,
  increaseLabel,
  quickLabel,
}: GuestCountPickerProps) {
  const step = (delta: number) => () => {
    const next = clampGuestCount(count + delta);
    if (next === count) return false;
    onChange(next);
    return true;
  };
  const minus = useRepeatPress(step(-1));
  const plus = useRepeatPress(step(1));
  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={{ color: palette.text, fontSize: 13, fontWeight: '600' }}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <RoundKey
          disabled={count <= GUEST_COUNT_MIN}
          icon="remove"
          iconSize={22}
          label={decreaseLabel}
          onPress={minus.onPress}
          onPressIn={minus.onPressIn}
          onPressOut={minus.onPressOut}
          size={KEY_SIZE}
        />
        {/* Shadow on the wrapper: Android drops a box shadow set on a
            TextInput, the same reason TextField carries it outside. */}
        <View style={{ flex: 1, minWidth: 0, borderRadius: radius.md, ...controlShadow }}>
          <TextInput
            accessibilityLabel={label}
            keyboardAppearance="light"
            keyboardType="number-pad"
            maxLength={4}
            onBlur={onBlur}
            onChangeText={onChangeText}
            selectTextOnFocus
            selectionColor={palette.primary}
            style={{
              width: '100%',
              height: KEY_SIZE,
              paddingVertical: 0,
              borderWidth: 1,
              borderColor: palette.controlBorder,
              borderRadius: radius.md,
              backgroundColor: palette.surfaceSubtle,
              color: palette.textStrong,
              // One line, so the type-scale test sees the weight beside the size.
              // No lineHeight: on a single-line TextInput it pushes the digits
              // off the vertical centre, and TextField sets none either.
              fontSize: 20, fontWeight: '600',
              fontVariant: ['tabular-nums'],
              textAlign: 'center',
              textAlignVertical: 'center',
            }}
            value={text}
          />
        </View>
        <RoundKey
          disabled={count >= GUEST_COUNT_MAX}
          icon="add"
          iconSize={22}
          label={increaseLabel}
          onPress={plus.onPress}
          onPressIn={plus.onPressIn}
          onPressOut={plus.onPressOut}
          size={KEY_SIZE}
        />
      </View>
      <QuickCounts count={count} onPick={onChange} quickLabel={quickLabel} />
    </View>
  );
}

/**
 * One rail, one thumb: the count it holds is lifted out in white, and a count
 * past six leaves the rail with nothing lifted, because the stepper above is
 * showing it.
 */
function QuickCounts({ count, onPick, quickLabel }: {
  count: number;
  onPick: (count: number) => void;
  quickLabel: (count: number) => string;
}) {
  return (
    <View
      accessibilityRole="radiogroup"
      style={{
        flexDirection: 'row',
        padding: 3,
        borderRadius: radius.full,
        borderCurve: 'continuous',
        borderWidth: 1,
        borderColor: palette.divider,
        backgroundColor: palette.surfaceSubtle,
      }}
    >
      {QUICK_GUEST_COUNTS.map((value) => {
        const on = value === count;
        return (
          <Pressable
            key={value}
            accessibilityLabel={quickLabel(value)}
            accessibilityRole="radio"
            accessibilityState={{ selected: on, checked: on }}
            hitSlop={{ top: 4, bottom: 4 }}
            onPress={() => {
              if (!on) hapticSelect();
              onPick(value);
            }}
            style={({ pressed }) => ({
              flex: 1,
              height: THUMB_HEIGHT,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: radius.full,
              backgroundColor: on ? palette.surface : pressed ? palette.surfaceStrong : 'transparent',
              ...(on ? { shadowColor: '#21130C', shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 } : null),
            })}
          >
            <Text style={{ fontSize: 15, lineHeight: 20, fontWeight: on ? '700' : '600', color: on ? palette.textStrong : palette.muted, fontVariant: ['tabular-nums'] }}>
              {value}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
