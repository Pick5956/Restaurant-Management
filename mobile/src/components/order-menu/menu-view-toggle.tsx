import * as Haptics from 'expo-haptics';

import { IconButton } from '@/src/components/ui';
import {
  menuViewModeIcon,
  menuViewModeLabel,
  nextMenuViewMode,
  type MenuViewMode,
} from '@/src/lib/menu-view-mode';
import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';

/**
 * One button that steps the order screen's menu through its layouts - photo
 * grid, one dish per row, the photo-less dense tiles - and round again. It
 * sits in the filter row beside the magnifier and wears the same glass, so the
 * row keeps one material. The glyph and the label name the layout the tap
 * switches TO, as the tables screen's density button does (app/tables.tsx):
 * a toggle that shows the state it is already in gives nothing to predict
 * from, and two view buttons in one app must not read in opposite ways.
 */
export function MenuViewToggle({ value, onChange }: {
  value: MenuViewMode;
  onChange: (next: MenuViewMode) => void;
}) {
  const { language } = useDisplayPreferences();
  const next = nextMenuViewMode(value);
  const nextLabel = menuViewModeLabel(next, language);
  return (
    <IconButton
      accessibilityLabel={language === 'en' ? `${nextLabel} view` : `มุมมอง${nextLabel}`}
      icon={menuViewModeIcon(next)}
      onPress={() => {
        // A phone with haptics off, or without a motor, rejects; the layout
        // change still happens.
        void Haptics.selectionAsync().catch(() => undefined);
        onChange(next);
      }}
      variant="glass"
    />
  );
}
