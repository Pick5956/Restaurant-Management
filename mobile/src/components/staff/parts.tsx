import { Pressable, View } from 'react-native';

import { AppIcon, type AppIconName } from '@/src/components/app-icon';
import { AppText as Text } from '@/src/components/app-text';
import { auditKind, memberInitials, type AuditKind } from '@/src/lib/staff-workflow';
import { palette } from '@/src/theme';

// The staff screen's pieces (15 ก.ย. 2569), in the reports and expenses
// screens' language: white cards with a warm hairline, a circle of initials
// for each member, and an icon for what kind of thing each activity was.

type Language = 'th' | 'en';

const AVATAR_TINTS = [
  { wash: '#FFEDD5', ink: '#AC3A0B' },
  { wash: '#E0F2FE', ink: '#0369A1' },
  { wash: '#ECFDF5', ink: '#047857' },
  { wash: '#EEF2FF', ink: '#4338CA' },
  { wash: '#F3F0ED', ink: '#5B3A2B' },
];

const ACTIVITY_LOOK: Record<AuditKind, { icon: AppIconName; wash: string; ink: string }> = {
  ai: { icon: 'sparkles-outline', wash: '#FFF4E8', ink: '#AC3A0B' },
  invitation: { icon: 'mail-outline', wash: '#E0F2FE', ink: '#0369A1' },
  member: { icon: 'person-outline', wash: '#EEF2FF', ink: '#4338CA' },
  role: { icon: 'key-outline', wash: '#F3F0ED', ink: '#5B3A2B' },
  other: { icon: 'time-outline', wash: '#F3F4F6', ink: '#4B5563' },
};

/** The same member keeps the same colour: it follows their account, not their place in the list. */
function avatarTint(seed: number) {
  return AVATAR_TINTS[Math.abs(seed) % AVATAR_TINTS.length];
}

/** A tab's height in the page, and in the compact bar's one row of controls (38 with the track's padding and edge). */
const TAB_HEIGHT = 34;
const COMPACT_TAB_HEIGHT = 30;

/**
 * Three views of the team on a phone: members, invitations, activity.
 * `compact` is the same control a step shorter, for the row under the compact
 * bar's title once the page's own tabs have scrolled away.
 */
export function StaffTabs<T extends string>({ tabs, value, onChange, compact = false }: { tabs: { key: T; label: string }[]; value: T; onChange: (key: T) => void; compact?: boolean }) {
  const height = compact ? COMPACT_TAB_HEIGHT : TAB_HEIGHT;
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: 'row', padding: 3, borderRadius: 999, backgroundColor: palette.surfaceSubtle, borderWidth: 1, borderColor: palette.divider }}>
      {tabs.map((tab) => {
        const on = tab.key === value;
        return (
          <Pressable
            key={tab.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(tab.key)}
            style={({ pressed }) => ({ flex: 1, alignItems: 'center', justifyContent: 'center', height, borderRadius: 999, backgroundColor: on ? palette.surface : 'transparent', opacity: pressed && !on ? 0.6 : 1, ...(on ? { shadowColor: '#21130C', shadowOpacity: 0.08, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 } : {}) })}
          >
            <Text numberOfLines={1} style={{ fontSize: 13.5, fontWeight: on ? '700' : '600', color: on ? palette.textStrong : palette.muted }}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function MemberRow({ seed, name, email, role, status, statusLabel, first, onPress, label }: {
  seed: number;
  name: string;
  email?: string;
  role: string;
  status: string;
  statusLabel: string;
  first: boolean;
  onPress?: () => void;
  label: string;
}) {
  const tint = avatarTint(seed);
  const statusLook = status === 'active'
    ? { wash: palette.successSoft, ink: palette.success }
    : status === 'suspended' ? { wash: palette.warningSoft, ink: palette.warning } : { wash: '#F3F4F6', ink: '#4B5563' };
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityLabel={label}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 68, paddingVertical: 9, paddingHorizontal: 14, borderTopWidth: first ? 0 : 1, borderTopColor: palette.divider, backgroundColor: pressed ? palette.surfaceSubtle : palette.surface })}
    >
      <View style={{ width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: tint.wash }}>
        <Text style={{ fontSize: 15, fontWeight: '700', color: tint.ink }}>{memberInitials(name)}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 15.5, lineHeight: 21, fontWeight: '700', color: palette.textStrong }}>{name}</Text>
        {email ? <Text numberOfLines={1} style={{ fontSize: 12, lineHeight: 17, color: palette.placeholder }}>{email}</Text> : null}
        <View style={{ alignSelf: 'flex-start', marginTop: 3, borderRadius: 999, paddingHorizontal: 8, backgroundColor: palette.surfaceSubtle }}>
          <Text numberOfLines={1} style={{ fontSize: 11.5, lineHeight: 18, fontWeight: '600', color: palette.primaryInk }}>{role}</Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, backgroundColor: statusLook.wash }}>
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: statusLook.ink }} />
        <Text style={{ fontSize: 11.5, fontWeight: '600', color: statusLook.ink }}>{statusLabel}</Text>
      </View>
      {onPress ? <AppIcon name="chevron-forward" size={16} color={palette.placeholder} /> : null}
    </Pressable>
  );
}

export function ActivityRow({ action, message, attribution, when, first }: { action: string; message: string; attribution: string; when: string; first: boolean }) {
  const look = ACTIVITY_LOOK[auditKind(action)];
  return (
    <View accessible accessibilityLabel={`${message}, ${attribution}, ${when}`} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 10, paddingHorizontal: 14, borderTopWidth: first ? 0 : 1, borderTopColor: '#F3EDE7' }}>
      <View style={{ width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: look.wash }}>
        <AppIcon name={look.icon} size={17} color={look.ink} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontSize: 14, lineHeight: 20, fontWeight: '600', color: palette.textStrong }}>{message}</Text>
        <Text numberOfLines={1} style={{ fontSize: 12, lineHeight: 17, color: palette.placeholder }}>{attribution}</Text>
      </View>
      <Text style={{ fontSize: 11.5, lineHeight: 20, color: palette.placeholder, fontVariant: ['tabular-nums'] }}>{when}</Text>
    </View>
  );
}

/** "27 ส.ค. 12:38" — the year only when it is not this year. */
export function shortDateTime(value: string | undefined, language: Language): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleString(language === 'th' ? 'th-TH' : 'en-US', {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Bangkok',
  });
}

/** A small outlined pill button, for secondary actions beside the orange one. */
export function GhostButton({ icon, label, onPress, tone = 'accent' }: { icon: AppIconName; label: string; onPress: () => void; tone?: 'accent' | 'danger' }) {
  const ink = tone === 'danger' ? palette.danger : palette.primaryInk;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      hitSlop={4}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, height: 38, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: tone === 'danger' ? '#FECACA' : palette.accentMuted, backgroundColor: palette.surface, opacity: pressed ? 0.7 : 1 })}
    >
      <AppIcon name={icon} size={16} color={ink} />
      <Text numberOfLines={1} style={{ fontSize: 13.5, fontWeight: '600', color: ink }}>{label}</Text>
    </Pressable>
  );
}

/** Three counts over the members card: active, suspended, invitations waiting. */
export function TeamStats({ stats }: { stats: { key: string; label: string; value: number; tone?: 'good' | 'wait' }[] }) {
  return (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      {stats.map((stat) => (
        <View key={stat.key} accessible accessibilityLabel={`${stat.label} ${stat.value}`} style={{ flex: 1, minWidth: 0, borderRadius: 16, borderCurve: 'continuous', borderWidth: 1, borderColor: '#E4D8CD', backgroundColor: palette.surface, paddingVertical: 7, paddingHorizontal: 12 }}>
          <Text numberOfLines={1} style={{ fontSize: 12, color: palette.placeholder }}>{stat.label}</Text>
          <Text style={{ fontSize: 20, lineHeight: 28, fontWeight: '600', fontVariant: ['tabular-nums'], color: stat.value > 0 && stat.tone === 'good' ? palette.success : stat.value > 0 && stat.tone === 'wait' ? palette.warning : palette.textStrong }}>{stat.value}</Text>
        </View>
      ))}
    </View>
  );
}

/**
 * One role in "บทบาทในร้าน": its name, the faces of who holds it and how many,
 * or "ยังไม่มีใคร" when nobody does. Opens the role's permissions when this
 * person may edit it.
 */
export function RoleRow({ title, detail, people, first, onPress, language }: {
  title: string;
  /** Under the name: "มาตรฐาน · 18 สิทธิ์". */
  detail?: string;
  people: { seed: number; name: string }[];
  first: boolean;
  onPress?: () => void;
  language: Language;
}) {
  const th = language === 'th';
  const shown = people.slice(0, 3);
  const has = people.length > 0;
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : 'text'}
      accessibilityLabel={`${title}, ${has ? (th ? `${people.length} คน` : `${people.length} people`) : (th ? 'ยังไม่มีใคร' : 'nobody yet')}`}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 50, paddingVertical: 8, paddingHorizontal: 14, borderTopWidth: first ? 0 : 1, borderTopColor: '#F3EDE7', backgroundColor: pressed ? palette.surfaceSubtle : palette.surface })}
    >
      <View style={{ width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: has ? palette.surfaceSubtle : '#F3F0ED' }}>
        <AppIcon name="key-outline" size={17} color={has ? palette.primaryInk : '#8B6F5F'} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 14.5, fontWeight: '600', color: palette.textStrong }}>{title}</Text>
        {detail ? <Text numberOfLines={1} style={{ fontSize: 11.5, color: palette.placeholder }}>{detail}</Text> : null}
      </View>
      {has ? (
        <>
          <View style={{ flexDirection: 'row', paddingLeft: 6 }}>
            {shown.map((person) => {
              const tint = avatarTint(person.seed);
              return (
                <View key={person.seed} style={{ width: 26, height: 26, borderRadius: 13, marginLeft: -6, borderWidth: 2, borderColor: palette.surface, alignItems: 'center', justifyContent: 'center', backgroundColor: tint.wash }}>
                  <Text style={{ fontSize: 9.5, fontWeight: '700', color: tint.ink }}>{memberInitials(person.name)}</Text>
                </View>
              );
            })}
          </View>
          <Text style={{ fontSize: 12.5, color: palette.placeholder, fontVariant: ['tabular-nums'] }}>{th ? `${people.length} คน` : `${people.length}`}</Text>
        </>
      ) : (
        <Text style={{ fontSize: 12.5, fontWeight: '600', color: palette.warning }}>{th ? 'ยังไม่มีใคร' : 'Nobody yet'}</Text>
      )}
      {onPress ? <AppIcon name="chevron-forward" size={15} color={palette.placeholder} /> : <View style={{ width: 15 }} />}
    </Pressable>
  );
}
