import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import Svg, { Path } from 'react-native-svg';

import { palette } from '@/src/theme';

/**
 * Glyphs Ionicons has no match for, drawn from the web app's own SVGs so the two
 * apps name a place with the same picture. `chef-hat` is the web sidebar's
 * kitchen (lucide `ChefHat`), asked for on the hub on 2026-09-23 in place of the
 * flame, which inside the kitchen already means "cooking".
 */
const CUSTOM_ICONS = {
  'chef-hat': [
    'M17 21a1 1 0 0 0 1-1v-5.35c0-.457.316-.844.727-1.041a4 4 0 0 0-2.134-7.589 5 5 0 0 0-9.186 0 4 4 0 0 0-2.134 7.588c.411.198.727.585.727 1.041V20a1 1 0 0 0 1 1Z',
    'M6 17h12',
  ],
} as const;

type CustomIconName = keyof typeof CUSTOM_ICONS;

export type AppIconName = ComponentProps<typeof Ionicons>['name'] | CustomIconName;

function isCustomIcon(name: AppIconName): name is CustomIconName {
  return Object.prototype.hasOwnProperty.call(CUSTOM_ICONS, name);
}

export function AppIcon({
  name,
  size = 20,
  color = palette.text,
}: {
  name: AppIconName;
  size?: number;
  color?: string;
}) {
  if (isCustomIcon(name)) {
    return (
      <Svg
        accessibilityElementsHidden
        fill="none"
        height={size}
        importantForAccessibility="no-hide-descendants"
        stroke={color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        viewBox="0 0 24 24"
        width={size}
      >
        {CUSTOM_ICONS[name].map((d) => <Path d={d} key={d} />)}
      </Svg>
    );
  }
  return (
    <Ionicons
      accessibilityElementsHidden
      color={color}
      importantForAccessibility="no-hide-descendants"
      name={name}
      size={size}
    />
  );
}
