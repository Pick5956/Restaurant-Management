import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { AppIcon, type AppIconName } from '@/src/components/app-icon';
import { AppText as Text } from '@/src/components/app-text';
import { RetryPill } from '@/src/components/hub/stage-tiles';
import { Bone, SkeletonReveal } from '@/src/components/skeleton';
import { palette } from '@/src/theme';

// The floor's other faces: nothing yet, nothing matching, a failed first load,
// no permission, and loading. One line each and no detail line under it - the
// line is the state's name, never a sentence about the screen.

function IconTile({ icon }: { icon: AppIconName }) {
  return (
    <View style={{ width: 52, height: 52, borderRadius: 16, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center', backgroundColor: palette.surfaceSubtle }}>
      <AppIcon color={palette.primaryInk} name={icon} size={26} />
    </View>
  );
}

function OutlinePill({ label, icon, onPress }: { label: string; icon?: AppIconName; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => ({ minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: palette.primary, backgroundColor: palette.surface, opacity: pressed ? 0.7 : 1 })}
    >
      {icon ? <AppIcon color={palette.primaryInk} name={icon} size={17} /> : null}
      <Text style={{ fontSize: 14, fontWeight: '600', color: palette.primaryInk }}>{label}</Text>
    </Pressable>
  );
}

export function PlanState({ icon, line, action, children }: {
  icon: AppIconName;
  line: string;
  action?: { label: string; icon?: AppIconName; onPress: () => void } | null;
  children?: ReactNode;
}) {
  return (
    <View style={{ alignItems: 'center', gap: 10, paddingTop: 48 }}>
      <IconTile icon={icon} />
      <Text style={{ fontSize: 15, lineHeight: 22, fontWeight: '700', color: palette.textStrong, textAlign: 'center' }}>{line}</Text>
      {action ? <OutlinePill icon={action.icon} label={action.label} onPress={action.onPress} /> : null}
      {children}
    </View>
  );
}

export function PlanFailed({ line, onRetry }: { line: string; onRetry: () => void }) {
  return (
    <View style={{ alignItems: 'center', gap: 10, paddingTop: 48 }}>
      <IconTile icon="cloud-offline-outline" />
      <Text style={{ fontSize: 15, lineHeight: 22, fontWeight: '700', color: palette.textStrong, textAlign: 'center' }}>{line}</Text>
      <RetryPill onPress={onRetry} style={{ alignSelf: 'center' }} />
    </View>
  );
}

/** The loading floor in the shapes it will take: the summary card, a room title, nine tiles. */
export function PlanSkeleton({ label }: { label: string }) {
  return (
    <SkeletonReveal label={label}>
      <View style={{ gap: 20 }}>
        <Bone height={84} radius={18} />
        <View style={{ gap: 10 }}>
          <Bone height={16} radius={6} width={120} />
          {/* Three rows of three that reach the right edge, like the grid they stand for. */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {Array.from({ length: 9 }, (_, index) => <Bone height={62} key={index} radius={12} style={{ flexGrow: 1, flexBasis: '30%' }} width="auto" />)}
          </View>
        </View>
      </View>
    </SkeletonReveal>
  );
}
