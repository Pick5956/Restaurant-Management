import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { AppIcon, type AppIconName } from '@/src/components/app-icon';
import { AppText as Text } from '@/src/components/app-text';
import { insightKey } from '@/src/lib/ai-insight-key';
import type { DisplayLanguage } from '@/src/lib/display-preferences';
import type { AIInsight } from '@/src/types/ai';

import { BottomSheet } from './chrome';
import { ai } from './theme';

// "ควรรู้วันนี้": the proactive cards, a port of the web's AIInsightsPanel.
// Tone is carried by a word label and an icon tile, never by colour alone.
//
// A card that stands for several things — nineteen ingredients to reorder —
// opens to list them, exactly as it does on the web. Tapping a card does
// nothing else: it never sends a question on the owner's behalf.

// Moved to src/lib/ai-insight-key.ts so the hub can count unseen insights
// without this module; re-exported for the assistant screen.
export { insightKey };

function toneFor(severity: AIInsight['severity'], kind: string) {
  if (severity === 'critical') return { ...ai.rose, label: 'ด่วน', labelEn: 'Urgent' };
  if (severity === 'warning') return { ...ai.amberTone, label: 'ต้องดู', labelEn: 'Watch' };
  if (kind === 'sales_up') return { ...ai.emerald, label: '', labelEn: '' };
  return { ...ai.neutral, label: '', labelEn: '' };
}

function iconFor(kind: string): AppIconName {
  switch (kind) {
    case 'ingredient_low': return 'cube-outline';
    case 'dead_stock': return 'archive-outline';
    case 'sales_drop': return 'trending-down-outline';
    case 'sales_up': return 'trending-up-outline';
    case 'plowhorse': return 'restaurant-outline';
    default: return 'cash-outline';
  }
}

export function InsightsSheet({
  open,
  onClose,
  insights,
  loading,
  language,
}: {
  open: boolean;
  onClose: () => void;
  insights: AIInsight[] | null;
  loading: boolean;
  language: DisplayLanguage;
}) {
  const t = (th: string, en: string) => (language === 'th' ? th : en);
  const [opened, setOpened] = useState<string[]>([]);
  const urgent = insights?.filter((insight) => insight.severity === 'critical').length ?? 0;
  const count = insights?.length ?? 0;

  useEffect(() => {
    if (!open) setOpened([]);
  }, [open]);

  return (
    <BottomSheet open={open} onClose={onClose} heightFraction={0.66} label={t('ปิด', 'Close')} showClose>
      <View style={{ paddingHorizontal: 16, paddingBottom: 8, paddingRight: 62 }}>
        <Text style={{ fontSize: 15, fontWeight: '700', color: '#0a0a0a', letterSpacing: -0.15 }}>{t('ควรรู้วันนี้', "Today's insights")}</Text>
        {count > 0 ? (
          <Text style={{ fontSize: 12, color: ai.faded, marginTop: 1 }}>
            {urgent > 0 ? <Text style={{ color: '#be123c', fontWeight: '600' }}>{t(`${urgent} เรื่องด่วน`, `${urgent} urgent`)}</Text> : null}
            {urgent > 0 ? ' · ' : ''}
            {t(`${count} เรื่อง`, `${count} items`)}
          </Text>
        ) : null}
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 28, gap: 10 }} keyboardShouldPersistTaps="handled">
        {loading && !insights ? (
          <Text style={{ fontSize: 13, color: ai.faint, paddingVertical: 12 }}>{t('กำลังตรวจข้อมูลร้าน', 'Checking the shop')}</Text>
        ) : count === 0 ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 16, backgroundColor: 'rgba(236,253,245,0.7)', paddingHorizontal: 16, paddingVertical: 16, borderWidth: 1, borderColor: '#d1fae5' }}>
            <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: '#d1fae5', alignItems: 'center', justifyContent: 'center' }}>
              <AppIcon name="checkmark" size={16} color="#065f46" />
            </View>
            <Text style={{ flex: 1, fontSize: 13, fontWeight: '500', color: '#065f46' }}>{t('ทุกอย่างปกติ ไม่มีเรื่องต้องรีบวันนี้', 'All clear, nothing urgent today')}</Text>
          </View>
        ) : (
          insights?.map((insight) => {
            const tone = toneFor(insight.severity, insight.kind);
            const label = language === 'th' ? tone.label : tone.labelEn;
            const key = insightKey(insight);
            const items = insight.items ?? [];
            const canOpen = items.length > 1;
            const isOpen = opened.includes(key);
            const card = (
              <View
                style={{
                  flexDirection: 'row',
                  gap: 10,
                  borderRadius: 16,
                  padding: 12,
                  backgroundColor: tone.bg,
                  borderWidth: 1,
                  borderColor: tone.ring,
                }}
              >
                <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: tone.chip, alignItems: 'center', justifyContent: 'center' }}>
                  <AppIcon name={iconFor(insight.kind)} size={18} color={tone.fg} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  {label ? (
                    <View style={{ alignSelf: 'flex-start', borderRadius: 999, backgroundColor: tone.chip, paddingHorizontal: 7, paddingVertical: 1, marginBottom: 3 }}>
                      <Text style={{ fontSize: 10.5, fontWeight: '600', color: tone.fg }}>{label}</Text>
                    </View>
                  ) : null}
                  <Text style={{ fontSize: 14.5, lineHeight: 19, fontWeight: '600', color: ai.ink, letterSpacing: -0.15 }}>{insight.title}</Text>
                  <Text style={{ fontSize: 12.5, lineHeight: 18, color: ai.faint, marginTop: 2 }}>
                    {insight.metric ? <Text style={{ fontWeight: '600', color: tone.fg === ai.neutral.fg ? ai.body : tone.fg, fontVariant: ['tabular-nums'] }}>{insight.metric} </Text> : null}
                    {insight.detail}
                  </Text>

                  {canOpen && !isOpen ? (
                    <Text style={{ fontSize: 12, color: ai.faded, marginTop: 3 }} numberOfLines={2}>
                      {items.map((item) => item.name).join(' · ')}
                      {insight.more ? t(` · อีก ${insight.more} อย่าง`, ` · ${insight.more} more`) : ''}
                    </Text>
                  ) : null}

                  {canOpen && isOpen ? (
                    <View style={{ marginTop: 8, gap: 7 }}>
                      {items.map((item) => (
                        <View key={item.title} style={{ borderTopWidth: 1, borderTopColor: tone.ring, paddingTop: 7 }}>
                          <Text style={{ fontSize: 13, lineHeight: 18, fontWeight: '600', color: ai.body }}>{item.title}</Text>
                          {item.detail ? (
                            <Text style={{ fontSize: 12, lineHeight: 17, color: ai.faded, fontVariant: ['tabular-nums'] }}>{item.detail}</Text>
                          ) : null}
                        </View>
                      ))}
                      {insight.more ? (
                        <Text style={{ fontSize: 12, color: ai.faded }}>
                          {t(`ยังมีอีก ${insight.more} อย่างที่ไม่ได้แสดง`, `${insight.more} more not listed`)}
                        </Text>
                      ) : null}
                    </View>
                  ) : null}

                  {canOpen ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8 }}>
                      <Text style={{ fontSize: 12.5, fontWeight: '600', color: tone.fg }}>
                        {isOpen ? t('ย่อรายการ', 'Show less') : t('ดูรายการทั้งหมด', 'See all')}
                      </Text>
                      <AppIcon name={isOpen ? 'chevron-up' : 'chevron-down'} size={14} color={tone.fg} />
                    </View>
                  ) : null}
                </View>
              </View>
            );

            if (!canOpen) return <View key={key}>{card}</View>;
            return (
              <Pressable
                key={key}
                accessibilityRole="button"
                accessibilityLabel={isOpen ? t('ย่อรายการ', 'Show less') : t('ดูรายการทั้งหมด', 'See all')}
                onPress={() => setOpened((current) => (current.includes(key) ? current.filter((one) => one !== key) : [...current, key]))}
                style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
              >
                {card}
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </BottomSheet>
  );
}
