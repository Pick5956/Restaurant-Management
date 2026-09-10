import { GlassView } from 'expo-glass-effect';
import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, useWindowDimensions, View, type KeyboardTypeOptions, type StyleProp, type TextInputProps, type TextStyle, type ViewStyle } from 'react-native';

import { AppIcon, type AppIconName } from '@/src/components/app-icon';
import { AppText as Text } from '@/src/components/app-text';
import { AppTextInput as TextInput } from '@/src/components/app-text-input';
import { useTabSwipeExclusionHandlers } from '@/src/components/tab-swipe-context';
import { LIQUID_GLASS } from '@/src/lib/liquid-glass';
import { breakpoints, controlShadow, palette, radius, spacing, statusTone, typeScale } from '@/src/theme';

/**
 * The assistant screen's material as a background layer: real Liquid Glass on
 * iOS 26, its translucent-white stand-in everywhere else.
 *
 * The fallback is not optional. This is a *background* — ship the GlassView
 * alone and every Android device and every iPhone below iOS 26 renders the
 * control's label on nothing at all. One implementation here so that can only be
 * got wrong once.
 */
export function GlassLayer({
  style,
  tint = 'rgba(255, 255, 255, 0.42)',
  fallback = 'rgba(255, 255, 255, 0.82)',
  fallbackBorder = 'rgba(255, 255, 255, 0.9)',
  children,
}: {
  style: ViewStyle;
  /** What the glass is tinted with on iOS 26. */
  tint?: string;
  /** The opaque-ish stand-in painted everywhere else. Keep it the same colour. */
  fallback?: string;
  /**
   * The fallback's edge. White by default, which reads as no edge at all — fine
   * on a control whose fill already separates it from the surface behind, and
   * not fine on a pale one, where it is the only thing giving the control a
   * boundary to see.
   */
  fallbackBorder?: string;
  children?: React.ReactNode;
}) {
  if (LIQUID_GLASS) {
    return (
      // These surfaces are light-only, so the glass must not follow a dark system
      // theme. A fixed tint, never a state colour changed at runtime: the native
      // view goes on wearing the old one if it changes.
      <GlassView glassEffectStyle="regular" isInteractive colorScheme="light" tintColor={tint} style={style}>
        {children}
      </GlassView>
    );
  }
  return (
    <View style={[style, { borderWidth: 1, borderColor: fallbackBorder, backgroundColor: fallback }]}>
      {children}
    </View>
  );
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  compact,
  icon,
  leading,
  style,
}: {
  label: string;
  onPress: () => void;
  /** `glass` is the assistant screen's material carrying a primary action: a
   *  pale wash of the brand orange with the orange itself as the label. Chosen
   *  over a solid fill deliberately — see the note on the tint below for the two
   *  things that pale fill then has to be given so it still reads as a control
   *  off iOS 26, where there is no material to help it. */
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'glass';
  disabled?: boolean;
  loading?: boolean;
  compact?: boolean;
  icon?: AppIconName;
  leading?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const isGlass = variant === 'glass';
  const backgroundColor = variant === 'primary' ? palette.primary : variant === 'danger' ? palette.danger : variant === 'ghost' ? 'transparent' : palette.surface;
  const color = variant === 'primary' || variant === 'danger' ? palette.primaryText : variant === 'ghost' ? palette.muted : isGlass ? palette.primaryInk : palette.text;
  const body = (
    <>
      {loading
        ? <ActivityIndicator color={color} size="small" />
        : leading || (icon ? <AppIcon color={color} name={icon} size={19} /> : null)}
      <Text style={{ color, fontSize: 14, fontWeight: '700' }}>{label}</Text>
    </>
  );
  if (isGlass) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: Boolean(disabled || loading), busy: Boolean(loading) }}
        disabled={disabled || loading}
        onPress={onPress}
        style={({ pressed }) => [
          {
            borderRadius: radius.md,
            ...controlShadow,
            opacity: disabled || loading ? 0.48 : pressed ? 0.78 : 1,
            transform: [{ scale: pressed ? 0.985 : 1 }],
          },
          style,
        ]}
      >
        <GlassLayer
          style={{
            minHeight: compact ? 44 : 52,
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'row',
            gap: spacing.sm,
            borderRadius: radius.md,
            paddingHorizontal: compact ? spacing.md : spacing.lg,
          }}
          // A pale wash of the brand orange, chosen by the owner over a solid
          // fill. Off iOS 26 this value is the button's whole background, so the
          // two things a flat pale fill cannot supply on its own are supplied
          // here: `primaryInk` instead of `primary` for the label, which lifts it
          // from 4.43:1 to 5.34:1 and over AA, and a real border, because the
          // fill sits 1.14:1 against the dock and the control would otherwise
          // have no visible edge at all.
          tint={palette.primaryWash}
          fallback={palette.primaryWash}
          fallbackBorder={palette.controlBorder}
        >
          {body}
        </GlassLayer>
      </Pressable>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled || loading), busy: Boolean(loading) }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        {
          minHeight: compact ? 44 : 52,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: spacing.sm,
          borderWidth: variant === 'ghost' ? 0 : 1,
          borderColor: variant === 'primary' ? palette.primary : variant === 'danger' ? palette.danger : palette.borderStrong,
          borderRadius: radius.md,
          backgroundColor,
          paddingHorizontal: compact ? spacing.md : spacing.lg,
          // A ghost button has no surface of its own, so a lift under it would
          // read as a floating rectangle with nothing in it.
          ...(variant === 'ghost' ? null : controlShadow),
          opacity: disabled || loading ? 0.48 : pressed ? 0.78 : 1,
          transform: [{ scale: pressed ? 0.985 : 1 }],
        },
        style,
      ]}
    >
      {body}
    </Pressable>
  );
}

/**
 * An action reduced to its icon, for the top-right of a screen header where a
 * labelled button would crowd out the title. `accessibilityLabel` is required
 * rather than optional: with the text gone it is the only name the control has.
 */
export function IconButton({
  icon,
  badgeIcon,
  accessibilityLabel,
  onPress,
  disabled,
  variant = 'secondary',
  size = 44,
}: {
  icon: AppIconName;
  /**
   * A second, smaller glyph tucked into the lower-trailing corner, for a control
   * that one icon cannot name on its own. The reservation-history button is the
   * case it exists for: a clipboard alone says "a list", a clock alone says
   * "something about time", and neither says "the list of bookings" — together
   * they do.
   */
  badgeIcon?: AppIconName;
  accessibilityLabel: string;
  onPress: () => void;
  disabled?: boolean;
  /**
   * `glass` is the assistant screen's material: real Liquid Glass on iOS 26 and
   * its translucent-white fallback everywhere else. It carries no colour of its
   * own — the glyph keeps whatever ink the surface it sits on calls for.
   */
  variant?: 'primary' | 'secondary' | 'glass';
  /** Diameter. 44 is the minimum comfortable tap target and the default. */
  size?: number;
}) {
  const isPrimary = variant === 'primary';
  const isGlass = variant === 'glass';
  const iconColor = isPrimary ? palette.primaryText : palette.text;
  const circle = {
    width: size,
    height: size,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    borderRadius: radius.full,
  };
  const face = (
    <>
      <AppIcon color={iconColor} name={icon} size={Math.round(size * 0.45)} />
      {badgeIcon ? (
        // Offset past the main glyph's corner and ringed in the button's own
        // fill, so the two icons read as two objects rather than as one smudged
        // shape at 20pt.
        <View
          style={{
            position: 'absolute',
            right: 7,
            bottom: 7,
            borderRadius: radius.full,
            backgroundColor: isPrimary ? palette.primary : palette.surface,
            padding: 1,
          }}
        >
          <AppIcon color={iconColor} name={badgeIcon} size={12} />
        </View>
      ) : null}
    </>
  );
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => (isGlass
        // The glass carries the shape, so the shadow goes on the wrapper: a lift
        // and a clip on one view is what eats the shadow on Android.
        ? { ...circle, ...controlShadow, opacity: disabled ? 0.48 : pressed ? 0.78 : 1 }
        : {
          ...circle,
          borderWidth: 1,
          borderColor: isPrimary ? palette.primary : palette.borderStrong,
          backgroundColor: isPrimary ? palette.primary : palette.surface,
          ...controlShadow,
          opacity: disabled ? 0.48 : pressed ? 0.78 : 1,
        })}
    >
      {isGlass ? <GlassLayer style={circle}>{face}</GlassLayer> : face}
    </Pressable>
  );
}

export function Surface({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View
      style={[
        {
          gap: spacing.md,
          padding: spacing.lg,
          borderWidth: 1,
          borderColor: palette.border,
          borderRadius: radius.md,
          backgroundColor: palette.surface,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function EdgeSection({
  children,
  fullBleed = true,
  style,
}: {
  children: React.ReactNode;
  fullBleed?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { width } = useWindowDimensions();
  const flushToPhoneEdge = fullBleed && width < breakpoints.tablet;

  return (
    <View
      style={[
        {
          marginHorizontal: flushToPhoneEdge ? -spacing.lg : 0,
          borderWidth: flushToPhoneEdge ? 0 : 1,
          borderColor: palette.border,
          borderRadius: flushToPhoneEdge ? 0 : radius.md,
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

export function EdgeSectionHeader({
  title,
  detail,
  action,
}: {
  title: string;
  detail?: string;
  action?: React.ReactNode;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: spacing.md }}>
      <View style={{ minWidth: 0, flex: 1, gap: 1 }}>
        <Text
          accessibilityRole="header"
          selectable
          style={{ color: palette.muted, fontSize: 14, lineHeight: 20, fontWeight: '600' }}
        >
          {title}
        </Text>
        {detail ? (
          <Text selectable style={{ color: palette.muted, fontSize: 12, lineHeight: 18 }}>
            {detail}
          </Text>
        ) : null}
      </View>
      {action}
    </View>
  );
}

export function EdgeRow({
  title,
  detail,
  icon,
  iconColor = palette.text,
  leading,
  trailing,
  showChevron,
  disabled,
  onPress,
  accessibilityLabel,
  titleStyle,
  style,
}: {
  title: string;
  detail?: string;
  icon?: AppIconName;
  iconColor?: string;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  showChevron?: boolean;
  disabled?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
  titleStyle?: StyleProp<TextStyle>;
  style?: StyleProp<ViewStyle>;
}) {
  const hasLeading = Boolean(icon || leading);
  const row = (
    <>
      {hasLeading ? (
        <View style={{ minHeight: detail ? 48 : 36, width: 32, alignItems: 'center', justifyContent: 'center' }}>
          {leading || (icon ? <AppIcon color={iconColor} name={icon} size={25} /> : null)}
        </View>
      ) : null}
      <View style={{ minWidth: 0, flex: 1, justifyContent: 'center', gap: 1 }}>
        <Text
          numberOfLines={detail ? 2 : 1}
          selectable
          style={[
            { color: palette.textStrong, fontSize: 16, lineHeight: 22, fontWeight: '600' },
            titleStyle,
          ]}
        >
          {title}
        </Text>
        {detail ? (
          <Text numberOfLines={3} selectable style={{ color: palette.muted, fontSize: 13, lineHeight: 18 }}>
            {detail}
          </Text>
        ) : null}
      </View>
      {trailing ? <View style={{ alignItems: 'flex-end', justifyContent: 'center' }}>{trailing}</View> : null}
      {(showChevron ?? Boolean(onPress)) ? <AppIcon color={palette.placeholder} name="chevron-forward" size={20} /> : null}
    </>
  );

  return (
    <View>
      {onPress ? (
        <Pressable
          accessibilityLabel={accessibilityLabel || title}
          accessibilityRole="button"
          accessibilityState={{ disabled: Boolean(disabled) }}
          disabled={disabled}
          onPress={onPress}
          style={({ pressed }) => [
            {
              minHeight: detail ? 72 : 60,
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing.md,
              paddingHorizontal: spacing.lg,
              paddingVertical: detail ? spacing.sm : spacing.xs,
              backgroundColor: pressed ? palette.surfaceStrong : palette.surface,
              opacity: disabled ? 0.48 : 1,
            },
            style,
          ]}
        >
          {row}
        </Pressable>
      ) : (
        <View
          style={[
            {
              minHeight: detail ? 72 : 60,
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing.md,
              paddingHorizontal: spacing.lg,
              paddingVertical: detail ? spacing.sm : spacing.xs,
              backgroundColor: palette.surface,
              opacity: disabled ? 0.48 : 1,
            },
            style,
          ]}
        >
          {row}
        </View>
      )}
    </View>
  );
}

export function SectionHeader({
  title,
  detail,
  inlineDetail,
  action,
}: {
  title: string;
  detail?: string;
  /**
   * A count that belongs beside the heading rather than under it. `detail` takes
   * a line of its own, which on a screen that is mostly headings costs a line per
   * section for something read in a glance.
   */
  inlineDetail?: string;
  action?: React.ReactNode;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: inlineDetail && !detail ? 'center' : 'flex-start', gap: spacing.md }}>
      <View style={{ minWidth: 0, flex: 1, gap: spacing.xs }}>
        <Text selectable style={typeScale.title}>{title}</Text>
        {detail ? <Text selectable style={[typeScale.caption, { color: palette.muted }]}>{detail}</Text> : null}
      </View>
      {inlineDetail ? (
        <Text
          numberOfLines={1}
          selectable
          style={[typeScale.caption, { flexShrink: 0, color: palette.textStrong, fontWeight: '700' }]}
        >
          {inlineDetail}
        </Text>
      ) : null}
      {action}
    </View>
  );
}

export function StatusBadge({ label, tone = 'neutral' }: { label: string; tone?: 'success' | 'warning' | 'danger' | 'info' | 'neutral' }) {
  const style = statusTone(tone);
  return (
    <View style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: radius.md, paddingHorizontal: 8, paddingVertical: 5, ...style }}>
      <View style={{ width: 6, height: 6, borderRadius: radius.full, backgroundColor: style.color }} />
      <Text selectable style={{ color: style.color, fontSize: 12, fontWeight: '700' }}>{label}</Text>
    </View>
  );
}

export function TextField({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  autoComplete,
  textContentType,
  secureTextEntry,
  revealLabel,
  hideLabel,
  icon,
  multiline,
  maxLength,
  minHeight,
  error,
  onFocus,
  onBlur,
}: {
  /** Omit when a section heading beside the field already names it — printing
   *  both puts the same words on screen twice. */
  label?: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  keyboardType?: KeyboardTypeOptions;
  autoComplete?: TextInputProps['autoComplete'];
  textContentType?: TextInputProps['textContentType'];
  secureTextEntry?: boolean;
  revealLabel?: string;
  hideLabel?: string;
  icon?: AppIconName;
  multiline?: boolean;
  /** Hard cap on typed characters. Mirror the backend `binding:"max=N"` for the
   *  field so the keyboard stops before the API rejects the request. */
  maxLength?: number;
  /** Starting height for a multiline field. The default reserves three lines,
   *  which is generous for a note that is usually a few words. */
  minHeight?: number;
  error?: string | null;
  /** For a screen that has to react to the keyboard opening on this field —
   *  scrolling it clear, say. The field's own focus styling is handled here
   *  either way. */
  onFocus?: () => void;
  onBlur?: () => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const [focused, setFocused] = useState(false);
  const canReveal = Boolean(secureTextEntry && revealLabel && hideLabel);
  return (
    <View style={{ gap: spacing.sm }}>
      {label ? <Text selectable style={{ color: palette.text, fontSize: 13, fontWeight: '600' }}>{label}</Text> : null}
      {/* Shadow on the wrapper, not the input — see SearchField for why. */}
      <View style={{ justifyContent: multiline ? 'flex-start' : 'center', borderRadius: radius.md, ...controlShadow }}>
        {icon ? (
          <View
            style={{
              pointerEvents: 'none',
              position: 'absolute',
              left: spacing.md,
              top: multiline ? 16 : 18,
              zIndex: 1,
            }}
          >
            <AppIcon
              color={error ? palette.danger : focused ? palette.textStrong : palette.muted}
              name={icon}
              size={19}
            />
          </View>
        ) : null}
        <TextInput
          accessibilityHint={error || placeholder}
          accessibilityLabel={label}
          autoComplete={autoComplete}
          autoCapitalize={keyboardType === 'email-address' || secureTextEntry ? 'none' : 'sentences'}
          autoCorrect={keyboardType !== 'email-address' && !secureTextEntry}
          // The app has no dark theme, so on a phone set to dark the system was
          // pairing our cream surfaces with a charcoal keyboard — and anything we
          // draw in the accessory bar above it then reads as a foreign panel
          // rather than part of the keyboard. Pinning the appearance is what lets
          // that bar pass for the system's own.
          keyboardAppearance="light"
          keyboardType={keyboardType}
          maxLength={maxLength}
          multiline={multiline}
          onChangeText={onChangeText}
          onBlur={() => { setFocused(false); onBlur?.(); }}
          onFocus={() => { setFocused(true); onFocus?.(); }}
          placeholder={placeholder}
          placeholderTextColor={palette.placeholder}
          secureTextEntry={Boolean(secureTextEntry && !revealed)}
          textContentType={textContentType}
          style={{
            minHeight: minHeight ?? (multiline ? 104 : 54),
            borderWidth: 1,
            borderColor: error ? palette.danger : focused ? palette.primary : palette.controlBorder,
            borderRadius: radius.md,
            backgroundColor: focused ? palette.surface : palette.surfaceSubtle,
            color: palette.textStrong,
            fontSize: 16,
            paddingLeft: icon ? 44 : spacing.md,
            paddingRight: canReveal ? 52 : spacing.md,
            paddingTop: multiline ? spacing.md : undefined,
            textAlignVertical: multiline ? 'top' : 'center',
          }}
          value={value}
        />
        {canReveal ? (
          <Pressable accessibilityLabel={revealed ? hideLabel : revealLabel} accessibilityRole="button" hitSlop={2} onPress={() => setRevealed((current) => !current)} style={({ pressed }) => ({ position: 'absolute', top: 5, right: 5, width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, backgroundColor: pressed ? palette.surfaceStrong : 'transparent', opacity: pressed ? 0.74 : 1 })}>
            <AppIcon color={palette.muted} name={revealed ? 'eye-off-outline' : 'eye-outline'} size={20} />
          </Pressable>
        ) : null}
      </View>
      {error ? <Text selectable style={[typeScale.caption, { color: palette.danger }]}>{error}</Text> : null}
    </View>
  );
}

export function SearchField({
  value,
  onChangeText,
  placeholder,
  accessibilityLabel,
  clearLabel = 'Clear search',
  autoFocus,
}: {
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  accessibilityLabel: string;
  clearLabel?: string;
  /** For a field that appears on demand: without it the caller has to tap the
   *  magnifier and then the field it just summoned. */
  autoFocus?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  return (
    // The lift sits on this wrapper, not on the TextInput: Android's ReactEditText
    // applies background, border and radius from the style but not box shadow, so
    // a shadow set on the input itself renders on iOS and silently vanishes on
    // Android. The radius here has to match the input so the glow follows its shape.
    <View style={{ justifyContent: 'center', borderRadius: radius.md, ...controlShadow }}>
      <View style={{ position: 'absolute', left: spacing.md, zIndex: 1, pointerEvents: 'none' }}>
        <AppIcon color={focused ? palette.textStrong : palette.muted} name="search-outline" size={19} />
      </View>
      <TextInput
        accessibilityLabel={accessibilityLabel}
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus={autoFocus}
        onBlur={() => setFocused(false)}
        onChangeText={onChangeText}
        onFocus={() => setFocused(true)}
        placeholder={placeholder}
        placeholderTextColor={palette.placeholder}
        // The return key reads Search and dismisses on its own, so a Done bar over
        // it would be the same action offered twice.
        omitKeyboardDoneBar
        returnKeyType="search"
        style={{
          minHeight: 52,
          borderWidth: 1,
          borderColor: focused ? palette.primary : palette.controlBorder,
          borderRadius: radius.md,
          backgroundColor: focused ? palette.surface : palette.surfaceSubtle,
          color: palette.textStrong,
          fontSize: 16,
          paddingLeft: 44,
          paddingRight: value ? 52 : spacing.md,
        }}
        value={value}
      />
      {value ? (
        <Pressable
          accessibilityLabel={clearLabel}
          accessibilityRole="button"
          hitSlop={2}
          onPress={() => onChangeText('')}
          style={({ pressed }) => ({
            position: 'absolute',
            right: 4,
            width: 44,
            height: 44,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? 0.55 : 1,
          })}
        >
          <AppIcon color={palette.muted} name="close-circle" size={19} />
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * `fill` splits the row evenly between the chips instead of sizing each to its
 * own text, for the case where the group is the whole width of a screen and
 * content-sized chips would leave dead space to their right. It has no effect
 * with `scrollable`, where the row is wider than the viewport by design.
 */
export function ChipGroup<T extends string | number>({ label, value, options, onChange, scrollable = false, fill = false, glass = false }: { label?: string; value: T; options: Array<{ label: string; value: T }>; onChange: (value: T) => void; scrollable?: boolean; fill?: boolean;
  /** Render the unchosen chips in the assistant screen's glass. The chosen one
   *  keeps its solid orange fill: glass on both would leave the row with no
   *  answer to "which of these is on", which is the only thing a chip row is
   *  for. Opt-in, because most chip rows in the app sit on a plain surface where
   *  a translucent material has nothing to be translucent over. */
  glass?: boolean }) {
  const tabSwipeExclusionHandlers = useTabSwipeExclusionHandlers();
  const controls = options.map((option) => {
    const selected = option.value === value;
    const shape = {
      minHeight: 44,
      justifyContent: 'center' as const,
      alignItems: fill && !scrollable ? ('center' as const) : undefined,
      flex: fill && !scrollable ? 1 : undefined,
      minWidth: fill && !scrollable ? 0 : undefined,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
    };
    const text = (
      <Text numberOfLines={fill && !scrollable ? 1 : undefined} style={{ color: selected ? palette.primaryText : palette.text, fontSize: 13, fontWeight: '700' }}>{option.label}</Text>
    );
    if (glass && !selected) {
      return (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ selected }}
          key={String(option.value)}
          onPress={() => onChange(option.value)}
          style={({ pressed }) => ({
            flex: fill && !scrollable ? 1 : undefined,
            minWidth: fill && !scrollable ? 0 : undefined,
            borderRadius: radius.md,
            ...controlShadow,
            opacity: pressed ? 0.72 : 1,
          })}
        >
          <GlassLayer style={shape}>{text}</GlassLayer>
        </Pressable>
      );
    }
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected }}
        key={String(option.value)}
        onPress={() => onChange(option.value)}
        style={({ pressed }) => ({
          ...shape,
          borderWidth: 1,
          borderColor: selected ? palette.primary : palette.borderStrong,
          backgroundColor: selected ? palette.primary : palette.surface,
          ...controlShadow,
          opacity: pressed ? 0.72 : 1,
        })}
      >
        {text}
      </Pressable>
    );
  });

  return (
    <View style={{ gap: spacing.sm }}>
      {label ? <Text selectable style={{ color: palette.text, fontSize: 13, fontWeight: '700' }}>{label}</Text> : null}
      {scrollable ? (
        <ScrollView
          {...tabSwipeExclusionHandlers}
          horizontal
          contentContainerStyle={{ gap: spacing.sm }}
          keyboardShouldPersistTaps="handled"
          showsHorizontalScrollIndicator={false}
        >
          {controls}
        </ScrollView>
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: fill ? 'nowrap' : 'wrap', gap: spacing.sm }}>{controls}</View>
      )}
    </View>
  );
}

/**
 * A dropdown built from a pressable field and a sheet of options.
 *
 * There is no native picker here on purpose: one would be a native dependency,
 * which costs a rebuild and locks the team's iOS members out of testing it in
 * Expo Go. It replaces a chip row where the list is long enough that the chips
 * scroll sideways, which hides options behind a gesture nobody is told about.
 */
export function Select<T extends string | number>({
  label,
  value,
  options,
  onChange,
  placeholder,
  disabled,
}: {
  label?: string;
  value: T;
  options: Array<{ label: string; value: T }>;
  onChange: (value: T) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);

  return (
    <View style={{ gap: spacing.sm }}>
      {label ? <Text selectable style={{ color: palette.text, fontSize: 13, fontWeight: '700' }}>{label}</Text> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: Boolean(disabled), expanded: open }}
        accessibilityLabel={label}
        accessibilityValue={{ text: selected?.label }}
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={({ pressed }) => ({
          minHeight: 48,
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing.sm,
          borderWidth: 1,
          borderColor: palette.borderStrong,
          borderRadius: radius.md,
          backgroundColor: palette.surface,
          paddingHorizontal: spacing.md,
          ...controlShadow,
          opacity: disabled ? 0.6 : pressed ? 0.72 : 1,
        })}
      >
        <Text
          numberOfLines={1}
          style={{
            minWidth: 0,
            flex: 1,
            color: selected ? palette.text : palette.muted,
            fontSize: 14,
            fontWeight: '600',
          }}
        >
          {selected?.label ?? placeholder ?? ''}
        </Text>
        <AppIcon color={palette.muted} name="chevron-down" size={18} />
      </Pressable>

      <Modal
        animationType="fade"
        onRequestClose={() => setOpen(false)}
        transparent
        visible={open}
      >
        <Pressable
          accessibilityLabel={placeholder ?? label}
          onPress={() => setOpen(false)}
          style={{
            flex: 1,
            justifyContent: 'flex-end',
            backgroundColor: 'rgba(0,0,0,0.45)',
          }}
        >
          {/* Stops a tap inside the sheet from reaching the dismiss backdrop. */}
          <Pressable
            onPress={() => undefined}
            style={{
              maxHeight: '70%',
              borderTopLeftRadius: radius.md,
              borderTopRightRadius: radius.md,
              backgroundColor: palette.surface,
              // Clears the home indicator. At spacing.xl the last row sat right
              // on the gesture bar, which both looks cramped and is where the
              // system swallows the tap.
              paddingBottom: spacing.xxxl + spacing.md,
            }}
          >
            {label ? (
              <View style={{ borderBottomWidth: 1, borderBottomColor: palette.border, paddingHorizontal: spacing.lg, paddingVertical: spacing.md }}>
                <Text style={{ color: palette.text, fontSize: 15, fontWeight: '700' }}>{label}</Text>
              </View>
            ) : null}
            <ScrollView keyboardShouldPersistTaps="handled">
              {options.map((option, index) => {
                const isSelected = option.value === value;
                return (
                  <View key={String(option.value)}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                    key={String(option.value)}
                    onPress={() => {
                      onChange(option.value);
                      setOpen(false);
                    }}
                    style={({ pressed }) => ({
                      minHeight: 52,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: spacing.md,
                      backgroundColor: pressed ? palette.surfaceSubtle : 'transparent',
                      paddingHorizontal: spacing.lg,
                    })}
                  >
                    <Text
                      numberOfLines={1}
                      style={{
                        minWidth: 0,
                        flex: 1,
                        color: palette.text,
                        fontSize: 15,
                        fontWeight: isSelected ? '700' : '500',
                      }}
                    >
                      {option.label}
                    </Text>
                    {isSelected ? <AppIcon color={palette.primary} name="checkmark" size={20} /> : null}
                  </Pressable>
                  {/* Inset hairline, and none after the last row. Drawn as its
                      own view rather than a bottom border so it can stop short
                      of both edges instead of walling the sheet off. */}
                  {index === options.length - 1 ? null : (
                    <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: palette.divider, marginHorizontal: spacing.lg }} />
                  )}
                  </View>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

/**
 * One choice per line with the state on the right, for a decision worth reading
 * before making — a payment method, say. Chips put the options side by side and
 * ask you to compare them at a glance; a stacked list asks you to read them.
 */
export function RadioGroup<T extends string | number>({ label, value, options, onChange }: { label?: string; value: T; options: Array<{ label: string; value: T; disabled?: boolean }>; onChange: (value: T) => void }) {
  return (
    <View style={{ gap: spacing.sm }}>
      {label ? <Text selectable style={{ color: palette.text, fontSize: 13, fontWeight: '700' }}>{label}</Text> : null}
      <View style={{ borderWidth: 1, borderColor: palette.controlBorder, borderRadius: radius.md, backgroundColor: palette.surface, overflow: 'hidden' }}>
        {options.map((option, index) => {
          const selected = option.value === value;
          return (
            <View key={String(option.value)}>
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ selected, disabled: Boolean(option.disabled) }}
              disabled={option.disabled}
              onPress={() => onChange(option.value)}
              style={({ pressed }) => ({
                minHeight: 52,
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.md,
                paddingHorizontal: spacing.md,
                backgroundColor: pressed ? palette.surfaceSubtle : 'transparent',
                opacity: option.disabled ? 0.48 : 1,
              })}
            >
              <Text numberOfLines={1} style={{ minWidth: 0, flex: 1, color: palette.text, fontSize: 15, fontWeight: selected ? '700' : '500' }}>{option.label}</Text>
              <View
                style={{
                  width: 22,
                  height: 22,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: 2,
                  borderColor: selected ? palette.primary : palette.borderStrong,
                  borderRadius: radius.full,
                }}
              >
                {selected ? <View style={{ width: 11, height: 11, borderRadius: radius.full, backgroundColor: palette.primary }} /> : null}
              </View>
            </Pressable>
            {index === options.length - 1 ? null : (
              <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: palette.divider, marginHorizontal: spacing.md }} />
            )}
            </View>
          );
        })}
      </View>
    </View>
  );
}

export function Feedback({ title, detail, tone = 'neutral' }: { title: string; detail?: string; tone?: 'success' | 'warning' | 'danger' | 'info' | 'neutral' }) {
  const style = statusTone(tone);
  return (
    <View
      accessibilityLiveRegion={tone === 'danger' ? 'assertive' : tone === 'neutral' ? 'none' : 'polite'}
      accessibilityRole={tone === 'danger' ? 'alert' : undefined}
      style={{ gap: spacing.xs, borderWidth: 1, borderRadius: radius.md, padding: spacing.md, ...style }}
    >
      <Text selectable style={{ color: style.color, fontSize: 14, fontWeight: '700' }}>{title}</Text>
      {detail ? <Text selectable style={{ color: style.color, fontSize: 13, lineHeight: 19 }}>{detail}</Text> : null}
    </View>
  );
}

export function EmptyState({ title, detail, action }: { title: string; detail?: string; action?: React.ReactNode }) {
  return (
    <View style={{ minHeight: 96, alignItems: 'flex-start', justifyContent: 'center', gap: spacing.sm, paddingVertical: spacing.lg }}>
      <Text selectable style={typeScale.cardTitle}>{title}</Text>
      {detail ? <Text selectable style={[typeScale.body, { color: palette.muted }]}>{detail}</Text> : null}
      {action ? <View style={{ marginTop: spacing.sm }}>{action}</View> : null}
    </View>
  );
}

export function Divider() {
  return <View style={{ height: 1, backgroundColor: palette.border }} />;
}

export function ActionDock({
  label,
  value,
  children,
  separated = true,
}: {
  label?: string;
  value?: string;
  children: React.ReactNode;
  /** Lift the dock off the content it sits over. Turn it off on a screen that
   *  already ends in its own divider, so the two do not stack. */
  separated?: boolean;
}) {
  return (
    // A shadow cast upward rather than a hairline. A line reads as the end of
    // the content; a shadow reads as a bar resting on top of it, which is what
    // this is — the list carries on scrolling underneath. `boxShadow` rather
    // than `elevation` because elevation has no direction on Android and would
    // put the lift on the wrong side.
    //
    // The −6px SPREAD is what keeps it to the top edge. Without it the blur
    // spreads on all four sides, and the part that falls below the dock paints a
    // dark band across the safe-area strip underneath — which reads as a gap
    // between the dock and the bottom of the screen even though the two are one
    // continuous surface. Negative spread shrinks the shadow inside the dock
    // first, so only the part the offset pushes upward ever escapes it.
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, boxShadow: separated ? '0 -6px 16px -6px rgba(61, 43, 31, 0.18)' : undefined, backgroundColor: palette.surface, paddingHorizontal: spacing.lg, paddingVertical: spacing.md }}>
      {label || value ? (
        <View style={{ minWidth: 0, flex: 1, gap: 1 }}>
          {label ? <Text style={[typeScale.caption, { color: palette.muted }]}>{label}</Text> : null}
          {value ? <Text numberOfLines={1} style={[typeScale.number, { fontSize: 20 }]}>{value}</Text> : null}
        </View>
      ) : null}
      <View style={{ flex: label || value ? 1.35 : 1 }}>{children}</View>
    </View>
  );
}
