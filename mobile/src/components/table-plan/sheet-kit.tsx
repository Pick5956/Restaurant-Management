import { forwardRef, useState, type ReactNode, type RefObject } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  View,
  type KeyboardTypeOptions,
  type TextInput as NativeTextInput,
} from 'react-native';

import { BottomSheet } from '@/src/components/ai/chrome';
import { AppIcon, type AppIconName } from '@/src/components/app-icon';
import { AppText as Text } from '@/src/components/app-text';
import { AppTextInput as TextInput } from '@/src/components/app-text-input';
import { planStatusWord, type PlanLanguage } from '@/src/lib/table-plan';
import { tileToneFor } from '@/src/lib/table-tile-tone';
import { palette } from '@/src/theme';
import type { TableStatus } from '@/src/types/table';

// The pieces the table-management bodies are built from: the sheet itself, a
// body's frame (title, scrolling rows, one footer), the grouped card and its
// rows, the house field, the orange button and the zone chips.

export type BodyChrome = 'sheet' | 'inline';

const CARD_EDGE = '#EFE7DF';
const ROW_HAIRLINE = '#F3EDE7';
const ERROR_INK = '#B91C1C';

/**
 * Every overlay in the section is this one sheet. BottomSheet calls
 * useTabSwipeCover for as long as it is up, closing animation included, so
 * nothing here opens a raw Modal (table-management-guards.test.mjs). It is
 * fitted: the sheet is as tall as what is in it, so a short body never sits
 * over a blank band above its footer (owner, 2026-09-23).
 */
export function PlanSheet({ open, onClose, keyboardLift, label, children }: {
  open: boolean;
  onClose: () => void;
  keyboardLift?: boolean;
  label: string;
  children: ReactNode;
}) {
  return (
    <BottomSheet fit keyboardLift={keyboardLift} label={label} onClose={onClose} open={open} showClose>
      {children}
    </BottomSheet>
  );
}

/**
 * A body's frame: the title beside the close button, the rows, and the footer
 * right under them. It is as tall as its content; only when that is taller
 * than the room it is given do the rows scroll, with the footer still under
 * them. `topGap` stands in for a title where the body leads with its own
 * header (the table tent) and has to clear the sheet's close button.
 */
export function BodyFrame({ chrome, title, topGap, footer, children, scrollRef }: {
  chrome: BodyChrome;
  title?: string;
  topGap?: number;
  footer?: ReactNode;
  children: ReactNode;
  scrollRef?: RefObject<ScrollView | null>;
}) {
  const side = chrome === 'sheet' ? 16 : 0;
  return (
    <View style={{ flexShrink: 1, minHeight: 0 }}>
      {title ? (
        <View style={{ paddingLeft: side, paddingRight: 64, paddingTop: chrome === 'sheet' ? 2 : 10, paddingBottom: 10 }}>
          <Text accessibilityRole="header" numberOfLines={2} style={{ fontSize: 16, lineHeight: 24, fontWeight: '700', color: palette.textStrong }}>{title}</Text>
        </View>
      ) : (
        <View style={{ height: topGap ?? (chrome === 'sheet' ? 40 : 52) }} />
      )}
      <ScrollView
        automaticallyAdjustKeyboardInsets={chrome === 'inline'}
        contentContainerStyle={{ paddingHorizontal: side, paddingBottom: footer ? 4 : 12, gap: 12 }}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        style={{ flexGrow: 0, flexShrink: 1 }}
      >
        {children}
      </ScrollView>
      {footer ? <View style={{ paddingHorizontal: side, paddingTop: 12, paddingBottom: chrome === 'inline' ? 16 : 0 }}>{footer}</View> : null}
    </View>
  );
}

/** One grouped card: white, radius 20, a warm hairline. Its rows bring their own separators. */
export function GroupCard({ children }: { children: ReactNode }) {
  return (
    <View style={{ borderRadius: 20, borderCurve: 'continuous', borderWidth: 1, borderColor: CARD_EDGE, backgroundColor: palette.surface, overflow: 'hidden' }}>
      {children}
    </View>
  );
}

/** A 56pt row: its name on the left, its control on the right. */
export function KitRow({ title, first, children, accessibilityLabel }: {
  title: string;
  first?: boolean;
  children?: ReactNode;
  accessibilityLabel?: string;
}) {
  return (
    <View
      accessibilityLabel={accessibilityLabel}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingVertical: 8, paddingHorizontal: 14, borderTopWidth: first ? 0 : 1, borderTopColor: ROW_HAIRLINE }}
    >
      <Text numberOfLines={2} style={{ flex: 1, minWidth: 0, fontSize: 14.5, lineHeight: 20, fontWeight: '600', color: palette.textStrong }}>{title}</Text>
      {children}
    </View>
  );
}

/** A row whose control sits under its name: the zone chips. */
export function KitBlock({ title, first, children }: { title: string; first?: boolean; children: ReactNode }) {
  return (
    <View style={{ gap: 10, padding: 14, borderTopWidth: first ? 0 : 1, borderTopColor: ROW_HAIRLINE }}>
      <Text style={{ fontSize: 14.5, lineHeight: 20, fontWeight: '600', color: palette.textStrong }}>{title}</Text>
      {children}
    </View>
  );
}

/** A problem with one field, directly under it. */
export function FieldError({ text }: { text: string | null | undefined }) {
  if (!text) return null;
  return (
    <Text accessibilityLiveRegion="polite" style={{ fontSize: 12.5, lineHeight: 18, color: ERROR_INK }}>{text}</Text>
  );
}

/** The house field: 44pt, a hairline that turns orange on focus, and an optional unit slot. */
export const KitField = forwardRef<NativeTextInput, {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  unit?: string;
  error?: string | null;
  maxLength?: number;
  keyboardType?: KeyboardTypeOptions;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  returnKeyType?: 'done' | 'next';
  onSubmitEditing?: () => void;
  onBlur?: () => void;
  selectTextOnFocus?: boolean;
}>(function KitField({ label, value, onChangeText, unit, error, maxLength, keyboardType, autoCapitalize, returnKeyType, onSubmitEditing, onBlur, selectTextOnFocus }, ref) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ fontSize: 12.5, fontWeight: '600', color: palette.muted }}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingHorizontal: 12, borderRadius: 12, borderCurve: 'continuous', borderWidth: 1, borderColor: error ? ERROR_INK : focused ? palette.primary : palette.divider, backgroundColor: palette.surface }}>
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          autoCapitalize={autoCapitalize ?? 'sentences'}
          autoCorrect={false}
          blurOnSubmit={returnKeyType !== 'next'}
          keyboardAppearance="light"
          keyboardType={keyboardType}
          maxLength={maxLength}
          onBlur={() => {
            setFocused(false);
            onBlur?.();
          }}
          onChangeText={onChangeText}
          onFocus={() => setFocused(true)}
          onSubmitEditing={onSubmitEditing}
          placeholderTextColor={palette.placeholder}
          returnKeyType={returnKeyType}
          selectTextOnFocus={selectTextOnFocus}
          selectionColor={palette.primary}
          style={{ flex: 1, minWidth: 0, fontSize: 15, color: palette.textStrong, paddingVertical: 0 }}
          value={value}
        />
        {unit ? <Text numberOfLines={1} style={{ flexShrink: 0, maxWidth: '45%', fontSize: 14, color: palette.placeholder, fontVariant: ['tabular-nums'] }}>{unit}</Text> : null}
      </View>
      <FieldError text={error} />
    </View>
  );
});

/** The one orange button a body ends in. `progress` ("3/5") replaces the label while a run is under way. */
export function PlanButton({ label, onPress, disabled, loading, progress }: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  progress?: string | null;
}) {
  const inert = disabled || loading;
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled), busy: Boolean(loading) }}
      disabled={inert}
      onPress={onPress}
      style={({ pressed }) => ({ opacity: disabled ? 0.45 : pressed ? 0.88 : 1 })}
    >
      <View style={{ height: 50, borderRadius: 25, borderCurve: 'continuous', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: palette.primary }}>
        {loading ? <ActivityIndicator color="#ffffff" size="small" /> : null}
        <Text numberOfLines={1} style={{ fontSize: 15, fontWeight: '600', color: '#ffffff', fontVariant: ['tabular-nums'] }}>{loading && progress ? progress : label}</Text>
      </View>
    </Pressable>
  );
}

export type ZoneChipOption<K> = { key: K; label: string };

/**
 * The zone choice: chips that turn black when chosen, and an optional dashed
 * "+ โซนใหม่" chip at the end.
 */
export function ZoneChips<K extends string | number>({ options, value, onChange, newChip }: {
  options: readonly ZoneChipOption<K>[];
  value: K | null;
  onChange: (key: K) => void;
  newChip?: { label: string; on: boolean; onPress: () => void };
}) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {options.map((option) => {
        const on = option.key === value;
        return (
          <Pressable
            key={String(option.key)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            hitSlop={4}
            onPress={() => onChange(option.key)}
            style={({ pressed }) => ({ minHeight: 34, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: on ? palette.textStrong : CARD_EDGE, backgroundColor: on ? palette.textStrong : palette.surface, opacity: pressed ? 0.7 : 1 })}
          >
            <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: '600', color: on ? '#ffffff' : palette.muted }}>{option.label}</Text>
          </Pressable>
        );
      })}
      {newChip ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected: newChip.on }}
          hitSlop={4}
          onPress={newChip.onPress}
          style={({ pressed }) => ({ minHeight: 34, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderStyle: newChip.on ? 'solid' : 'dashed', borderColor: newChip.on ? palette.textStrong : palette.border, backgroundColor: newChip.on ? palette.textStrong : palette.surface, opacity: pressed ? 0.7 : 1 })}
        >
          <AppIcon color={newChip.on ? '#ffffff' : palette.primaryInk} name="add" size={15} />
          <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: '600', color: newChip.on ? '#ffffff' : palette.primaryInk }}>{newChip.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** A live status in its own colour: "กำลังใช้งาน", "จอง, คุณนภา". */
export function StatusChip({ status, language, extra }: { status: TableStatus; language: PlanLanguage; extra?: string | null }) {
  const tone = tileToneFor(status);
  const words = extra ? `${planStatusWord(status, language)}, ${extra}` : planStatusWord(status, language);
  return (
    <View style={{ flexShrink: 1, minHeight: 26, justifyContent: 'center', paddingHorizontal: 10, borderRadius: 999, backgroundColor: tone.fill }}>
      <Text numberOfLines={1} style={{ fontSize: 12.5, lineHeight: 18, fontWeight: '600', color: tone.ink }}>{words}</Text>
    </View>
  );
}

/** A row of the ⋯ sheet: an icon and what it does. The danger row is red. */
export function KitAction({ icon, label, onPress, danger, first, disabled }: {
  icon: AppIconName;
  label: string;
  onPress: () => void;
  danger?: boolean;
  first?: boolean;
  disabled?: boolean;
}) {
  const ink = danger ? ERROR_INK : palette.textStrong;
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({ minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, borderTopWidth: first ? 0 : 1, borderTopColor: ROW_HAIRLINE, backgroundColor: pressed ? palette.surfaceSubtle : palette.surface, opacity: disabled ? 0.45 : 1 })}
    >
      <AppIcon color={danger ? ERROR_INK : palette.muted} name={icon} size={20} />
      <Text numberOfLines={1} style={{ flex: 1, fontSize: 15, lineHeight: 22, fontWeight: '500', color: ink }}>{label}</Text>
    </Pressable>
  );
}

/** Whether a destination is the chosen one: an orange disc with a tick, or an empty ring. */
export function ChoiceMark({ on }: { on: boolean }) {
  return (
    <View style={{ width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', borderWidth: on ? 0 : 1.5, borderColor: '#E4D8CD', backgroundColor: on ? palette.primary : palette.surface }}>
      {on ? <AppIcon color="#ffffff" name="checkmark" size={14} /> : null}
    </View>
  );
}

/** A read-only value on the right of a row: the seats of a table in service. */
export function KitValue({ text }: { text: string }) {
  return <Text numberOfLines={1} style={{ flexShrink: 0, fontSize: 15, lineHeight: 22, fontWeight: '600', color: palette.textStrong, fontVariant: ['tabular-nums'] }}>{text}</Text>;
}

/** A round tinted key: the ↑/↓ of the room order, the − / + of a compact stepper. */
export function RoundKey({ icon, label, onPress, disabled, size = 36, iconSize = 18, onPressIn, onPressOut }: {
  icon: 'arrow-up' | 'arrow-down' | 'remove' | 'add';
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  size?: number;
  iconSize?: number;
  onPressIn?: () => void;
  onPressOut?: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      hitSlop={6}
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      style={({ pressed }) => ({ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? palette.surfaceStrong : palette.surfaceSubtle, opacity: disabled ? 0.35 : 1 })}
    >
      <AppIcon color={palette.primaryInk} name={icon} size={iconSize} />
    </Pressable>
  );
}
