import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';

import { GlassButton } from '@/src/components/ai/chrome';
import { AddRoomChip } from '@/src/components/table-plan/plan-floor';
import { GroupCard } from '@/src/components/table-plan/sheet-kit';
import { ToolRow } from '@/src/components/tool-row';
import { roomName, roomValue, type PlanLanguage, type PlanRoom } from '@/src/lib/table-plan';
import { palette } from '@/src/theme';

// The tablet's right column (from 900pt). The same bodies the phone shows in a
// sheet sit here inline, with a close button where the sheet has one; with
// nothing open it lists the rooms. No outer card - only a hairline down its
// left edge - because the bodies bring their own grouped cards.

const ROOM_LOOK = { wash: '#F3F0ED', ink: '#5B3A2B', title: palette.textStrong };

export function PlanInspector({ body, onClose, rooms, onRoom, onAddRoom, language, t }: {
  /** The open body, or null for the room list. */
  body: ReactNode | null;
  onClose: () => void;
  rooms: readonly PlanRoom[];
  onRoom: (room: PlanRoom) => void;
  onAddRoom: () => void;
  language: PlanLanguage;
  t: (th: string, en: string) => string;
}) {
  const zoned = rooms.filter((room) => room.zone !== null);
  return (
    <View style={{ flex: 0.9, minWidth: 0, minHeight: 0, borderLeftWidth: 1, borderLeftColor: '#EFE7DF', paddingLeft: 20 }}>
      {body ? (
        <View style={{ flexShrink: 1, minHeight: 0 }}>
          {body}
          <View style={{ position: 'absolute', top: 0, right: 0 }}>
            <GlassButton icon="close" label={t('ปิด', 'Close')} onPress={onClose} size={40} />
          </View>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
          {zoned.length ? (
            <GroupCard>
              {zoned.map((room, index) => (
                <ToolRow
                  detail={roomValue(room, language)}
                  first={index === 0}
                  icon="grid-outline"
                  key={String(room.key)}
                  look={ROOM_LOOK}
                  onPress={() => onRoom(room)}
                  title={roomName(room, language)}
                />
              ))}
            </GroupCard>
          ) : null}
          <AddRoomChip label={t('เพิ่มโซน', 'Add zone')} onPress={onAddRoom} />
        </ScrollView>
      )}
    </View>
  );
}
