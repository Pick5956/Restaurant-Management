import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef } from 'react';
import { Pressable, View } from 'react-native';

import { AppIcon } from '@/src/components/app-icon';
import { AppText as Text } from '@/src/components/app-text';
import { AppTextInput as TextInput } from '@/src/components/app-text-input';
import { hapticSelect } from '@/src/components/table-plan/plan-context';
import { RoundKey } from '@/src/components/table-plan/sheet-kit';
import { palette } from '@/src/theme';

// The two number controls of the section. The limits are part of the control
// (a typed 300 shows 200 at once, and − / + stop at the ends) rather than a
// line explaining them, and holding a key runs the number up.

const REPEAT_DELAY_MS = 400;
const REPEAT_EVERY_MS = 90;

/**
 * Tap to step once; hold to step again after 400 ms and then every 90 ms, with
 * a selection haptic each time. `step` returns false at the limit, which stops
 * the run.
 */
export function useRepeatPress(step: () => boolean) {
  const stepRef = useRef(step);
  stepRef.current = step;
  const delayRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const everyRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const repeatedRef = useRef(false);

  const stop = () => {
    if (delayRef.current) clearTimeout(delayRef.current);
    if (everyRef.current) clearInterval(everyRef.current);
    delayRef.current = null;
    everyRef.current = null;
  };
  useEffect(() => stop, []);

  return {
    onPressIn: () => {
      stop();
      repeatedRef.current = false;
      delayRef.current = setTimeout(() => {
        repeatedRef.current = true;
        everyRef.current = setInterval(() => {
          if (stepRef.current()) hapticSelect();
          else stop();
        }, REPEAT_EVERY_MS);
      }, REPEAT_DELAY_MS);
    },
    onPressOut: stop,
    onPress: () => {
      // A hold already stepped; the release that ends it is not one more.
      if (repeatedRef.current) return;
      if (stepRef.current()) hapticSelect();
    },
  };
}

function clampStep(value: number | null, delta: number, min: number, max: number): number {
  const base = value ?? min;
  return Math.min(max, Math.max(min, base + delta));
}

function OrangeKey({ icon, label, disabled, onStep }: {
  icon: 'remove' | 'add';
  label: string;
  disabled: boolean;
  onStep: () => boolean;
}) {
  const repeat = useRepeatPress(onStep);
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={6}
      onPress={repeat.onPress}
      onPressIn={repeat.onPressIn}
      onPressOut={repeat.onPressOut}
      style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? 'rgba(255,255,255,0.32)' : 'rgba(255,255,255,0.22)', opacity: disabled ? 0.35 : 1 })}
    >
      <AppIcon color="#ffffff" name={icon} size={24} />
    </Pressable>
  );
}

/**
 * The add sheet's orange block: "จำนวนโต๊ะ", − 3 โต๊ะ +, and under it the
 * exact labels the server will write. The field may be empty while typing
 * (the footer is disabled then) and becomes the minimum when it loses focus.
 */
export function CountBlock({ label, unit, text, value, min, max, preview, onChangeText, decreaseLabel, increaseLabel }: {
  label: string;
  unit: string;
  text: string;
  value: number | null;
  min: number;
  max: number;
  preview: string;
  onChangeText: (text: string) => void;
  decreaseLabel: string;
  increaseLabel: string;
}) {
  const step = (delta: number) => () => {
    const next = clampStep(value, delta, min, max);
    if (next === value) return false;
    onChangeText(String(next));
    return true;
  };
  return (
    <LinearGradient
      colors={['#B93A0D', '#D9581F', '#EF7A35']}
      end={{ x: 1, y: 1 }}
      start={{ x: 0, y: 0 }}
      style={{ borderRadius: 20, borderCurve: 'continuous', paddingVertical: 14, paddingHorizontal: 16 }}
    >
      <Text style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.9)' }}>{label}</Text>
      <View style={{ minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <OrangeKey disabled={value !== null && value <= min} icon="remove" label={decreaseLabel} onStep={step(-1)} />
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <TextInput
            accessibilityLabel={label}
            keyboardType="number-pad"
            maxLength={3}
            onBlur={() => {
              if (value === null) onChangeText(String(min));
            }}
            onChangeText={onChangeText}
            selectTextOnFocus
            selectionColor="#ffffff"
            style={{ fontSize: 20, lineHeight: 28, fontWeight: '600', color: '#ffffff', minWidth: 64, textAlign: 'center', paddingVertical: 0, fontVariant: ['tabular-nums'] }}
            value={text}
          />
          <Text style={{ fontSize: 14, color: 'rgba(255,255,255,0.9)' }}>{unit}</Text>
        </View>
        <OrangeKey disabled={value !== null && value >= max} icon="add" label={increaseLabel} onStep={step(1)} />
      </View>
      <Text
        ellipsizeMode="middle"
        numberOfLines={1}
        style={{ marginTop: 6, fontSize: 15, lineHeight: 22, fontWeight: '600', color: '#ffffff', textAlign: 'center', fontVariant: ['tabular-nums'] }}
      >
        {preview}
      </Text>
    </LinearGradient>
  );
}

/** The seats stepper: tinted round keys and the number between them. The row's title names the unit. */
export function CompactStepper({ value, min, max, onChange, label, decreaseLabel, increaseLabel }: {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  label: string;
  decreaseLabel: string;
  increaseLabel: string;
}) {
  const step = (delta: number) => () => {
    const next = clampStep(value, delta, min, max);
    if (next === value) return false;
    onChange(next);
    return true;
  };
  const minus = useRepeatPress(step(-1));
  const plus = useRepeatPress(step(1));
  return (
    <View accessibilityLabel={`${label} ${value}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <RoundKey disabled={value <= min} icon="remove" iconSize={20} label={decreaseLabel} onPress={minus.onPress} onPressIn={minus.onPressIn} onPressOut={minus.onPressOut} />
      <Text style={{ minWidth: 40, textAlign: 'center', fontSize: 17, lineHeight: 24, fontWeight: '600', color: palette.textStrong, fontVariant: ['tabular-nums'] }}>{value}</Text>
      <RoundKey disabled={value >= max} icon="add" iconSize={20} label={increaseLabel} onPress={plus.onPress} onPressIn={plus.onPressIn} onPressOut={plus.onPressOut} />
    </View>
  );
}
