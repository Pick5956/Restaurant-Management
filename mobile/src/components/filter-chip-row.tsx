import type { ReactNode } from 'react';
import { View } from 'react-native';

import { ChoiceChips, type ChipRowSync } from '@/src/components/form/parts';
import { spacing } from '@/src/theme';

/**
 * The one filter row the list screens draw: the choices as chips that scroll
 * sideways, then the row's round buttons at its trailing edge. The menu
 * manager's bar started it; the order screen's categories, the floor's zones
 * and the table plan's rooms were dropdowns - two taps to change, and every
 * other choice hidden until opened. The owner asked for them all in the one
 * pattern (2026-09-25). A picker inside a form, chosen once, stays a dropdown.
 */
export function FilterChipRow<T extends string>({ options, value, onChange, trailing, sync }: {
  /** "ทุก…" first, then the choices. */
  options: readonly { key: T; label: string }[];
  value: T;
  onChange: (key: T) => void;
  /** The row's round buttons - a layout toggle, the magnifier - in order. */
  trailing?: ReactNode;
  /** Scroll as one with another row of the same chips. */
  sync?: ChipRowSync;
}) {
  return (
    <View style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
      <View style={{ minWidth: 0, flex: 1 }}>
        <ChoiceChips scroll sync={sync} options={[...options]} value={value} onChange={onChange} />
      </View>
      {trailing}
    </View>
  );
}
