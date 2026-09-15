import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';

import { AppIcon, type AppIconName } from '@/src/components/app-icon';
import { AppText as Text } from '@/src/components/app-text';
import { formatCountdown } from '@/src/lib/ai-chat';
import {
  confirmDestination,
  confirmKicker,
  confirmLabel,
  confirmLayout,
  confirmRowName,
  confirmSavedAt,
  readableFigure,
  type ConfirmItem,
  type ConfirmState,
} from '@/src/lib/ai-confirm';
import type { DisplayLanguage } from '@/src/lib/display-preferences';

import { ai } from './theme';

// The confirm card under a command — design A, chosen by the owner on
// 14 ก.ย. 2569. It replaced a white card with an orange edge nested inside the
// answer bubble, a 40px countdown ring on its left, and "1 นาที" said three
// times. Now the action is the bubble's own bottom part: a hairline, an orange
// wash, what changes laid out large, and two full-width buttons with the
// countdown on the confirm button only.
//
// Nothing is written until "ยืนยัน"; the server refuses every other command
// while a card is pending, so it always resolves one way. A resolved card stays
// in the bubble with its details and a one-line result, so scrolling back shows
// what was done.

export type { ConfirmItem, ConfirmState };

const WASH = '#fff7ed';
const HAIR = '#eef0f2';
const GREEN_WASH = '#ecfdf3';
const WARN = '#b45309';
const WARN_WASH = '#fffbeb';
const RED = '#c72c22';
const RED_WASH = '#fef2f2';
/** The bubble's padding, undone so the section reaches its edges. */
const BUBBLE_PAD_X = 14;
const BUBBLE_PAD_Y = 9;
const BUBBLE_RADIUS = 18;

function Flag({ tone, icon, text }: { tone: 'side' | 'bad'; icon: AppIconName; text: string }) {
  const colour = tone === 'side' ? WARN : RED;
  return (
    <View style={{ marginTop: 8, flexDirection: 'row', alignItems: 'flex-start', gap: 6, borderRadius: 10, borderCurve: 'continuous', paddingVertical: 6, paddingHorizontal: 9, backgroundColor: tone === 'side' ? WARN_WASH : RED_WASH }}>
      <View style={{ marginTop: 2 }}><AppIcon name={icon} size={15} color={colour} /></View>
      <Text style={{ flex: 1, fontSize: 12.5, lineHeight: 18, color: colour }}>{text}</Text>
    </View>
  );
}

function Facts({ facts, dim }: { facts: NonNullable<ConfirmItem['facts']>; dim: boolean }) {
  return (
    <View style={{ marginTop: 8, gap: 4, opacity: dim ? 0.7 : 1 }}>
      {facts.map((fact) => (
        <View key={fact.label} style={{ flexDirection: 'row', alignItems: 'baseline', gap: 12 }}>
          <Text style={{ fontSize: 13.5, color: ai.faint }}>{fact.label}</Text>
          <Text selectable style={{ flex: 1, textAlign: 'right', fontSize: 13.5, fontWeight: '600', color: ai.text, fontVariant: ['tabular-nums'] }}>{fact.value}</Text>
        </View>
      ))}
    </View>
  );
}

function Delta({ item, dim }: { item: ConfirmItem; dim: boolean }) {
  const up = item.delta?.startsWith('+');
  return (
    <View style={{ marginTop: 9, flexDirection: 'row', alignItems: 'center', gap: 8, opacity: dim ? 0.7 : 1 }}>
      <Text style={{ fontSize: 15, color: ai.faded, textDecorationLine: 'line-through', fontVariant: ['tabular-nums'] }}>{readableFigure(item.from ?? '')}</Text>
      <AppIcon name="arrow-forward" size={16} color={ai.faded} />
      <View style={{ flexShrink: 1, flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
        <Text selectable style={{ fontSize: 22, lineHeight: 28, fontWeight: '600', color: dim ? ai.muted : ai.deep, fontVariant: ['tabular-nums'] }}>{readableFigure(item.to ?? '')}</Text>
        {item.valueUnit ? <Text style={{ fontSize: 13, fontWeight: '500', color: ai.muted }}>{item.valueUnit}</Text> : null}
      </View>
      {item.delta ? (
        <View style={{ marginLeft: 'auto', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, backgroundColor: up ? GREEN_WASH : WARN_WASH }}>
          <Text style={{ fontSize: 12, fontWeight: '600', color: up ? ai.green : WARN, fontVariant: ['tabular-nums'] }}>{readableFigure(item.delta)}</Text>
        </View>
      ) : null}
    </View>
  );
}

function PlanRows({ items }: { items: ConfirmItem[] }) {
  return (
    <View style={{ marginTop: 8 }}>
      {items.map((item, index) => {
        const layout = confirmLayout(item);
        return (
          <View
            key={`${item.title}-${index}`}
            style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, paddingVertical: 6, borderTopWidth: index === 0 ? 0 : 1, borderTopColor: '#f1ebe4' }}
          >
            <Text numberOfLines={2} style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: '600', color: ai.text }}>{confirmRowName(item)}</Text>
            {layout === 'delta' ? (
              <Text style={{ flexShrink: 1, textAlign: 'right', fontSize: 13.5, color: ai.faint, fontVariant: ['tabular-nums'] }}>
                {readableFigure(item.from ?? '')} → <Text style={{ fontWeight: '600', color: ai.deep }}>{readableFigure(item.to ?? '')}{item.valueUnit ? ` ${item.valueUnit}` : ''}</Text>
              </Text>
            ) : (
              <Text style={{ flexShrink: 1, textAlign: 'right', fontSize: 13.5, color: ai.faint, fontVariant: ['tabular-nums'] }}>
                {layout === 'facts' ? item.facts!.map((fact) => fact.value).join(' · ') : `${item.change}${item.unit ? ` ${item.unit}` : ''}`}
              </Text>
            )}
          </View>
        );
      })}
    </View>
  );
}

export function ConfirmCard({
  summary,
  items,
  warnings,
  expiresAt,
  onConfirm,
  onCancel,
  onReissue,
  onResolved,
  onOpen,
  initialState = 'pending',
  resolvedAt,
  resultError,
  standalone = false,
  language,
}: {
  summary: string;
  items: ConfirmItem[];
  warnings?: string[];
  expiresAt?: string;
  onConfirm?: () => Promise<void>;
  onCancel?: () => void;
  onReissue?: () => void;
  onResolved?: (state: ConfirmState) => void;
  /** Opens the screen the saved change landed on. */
  onOpen?: (href: string) => void;
  initialState?: ConfirmState;
  /** When a resolved card was resolved, for "บันทึกลงระบบแล้ว 20:28". */
  resolvedAt?: number;
  /** Items that failed inside a plan that otherwise saved. */
  resultError?: string;
  /** No answer text above it in the bubble, so no hairline and no top gap. */
  standalone?: boolean;
  language: DisplayLanguage;
}) {
  const th = language === 'th';
  const [state, setState] = useState<ConfirmState>(initialState);
  const [error, setError] = useState<string | null>(null);
  const [doneAt, setDoneAt] = useState<number | undefined>(resolvedAt);
  const [now, setNow] = useState(() => Date.now());
  const startedAt = useRef(Date.now());
  const expiry = expiresAt ? new Date(expiresAt).getTime() : Number.NaN;
  const totalMs = Math.max(1000, expiry - startedAt.current);
  const remainingMs = Math.max(0, expiry - now);
  const live = state === 'pending' || state === 'confirming';

  useEffect(() => {
    if (state !== 'pending') return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [state]);

  useEffect(() => {
    if (state === 'pending' && Number.isFinite(expiry) && remainingMs <= 0) {
      setState('expired');
      onResolved?.('expired');
    }
  }, [expiry, onResolved, remainingMs, state]);

  const confirm = async () => {
    if (state !== 'pending' || !onConfirm) return;
    setState('confirming');
    setError(null);
    onResolved?.('confirming');
    try {
      await onConfirm();
      setDoneAt(Date.now());
      setState('done');
      onResolved?.('done');
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : (th ? 'ยืนยันไม่สำเร็จ ลองอีกครั้ง' : 'Could not confirm, try again'));
      setState('pending');
    }
  };

  const cancel = () => {
    if (state !== 'pending') return;
    setState('cancelled');
    onCancel?.();
    onResolved?.('cancelled');
  };

  const kicker = confirmKicker(items, state, language);
  const done = state === 'done';
  const off = state === 'cancelled' || state === 'expired';
  const kickerColour = done ? ai.green : off ? ai.faint : ai.deep;
  const progress = Math.min(1, Math.max(0, remainingMs / totalMs));
  const urgent = remainingMs < 10_000;
  const single = items.length === 1 ? items[0] : null;
  const layout = single ? confirmLayout(single) : null;
  const destination = done && onOpen ? confirmDestination(items) : null;
  const effects = items.flatMap((item) => item.sideEffects ?? []).slice(0, 2);

  return (
    <View
      style={{
        marginHorizontal: -BUBBLE_PAD_X,
        marginBottom: -BUBBLE_PAD_Y,
        marginTop: standalone ? -BUBBLE_PAD_Y : 10,
        borderTopWidth: standalone ? 0 : 1,
        borderTopColor: HAIR,
        borderBottomLeftRadius: BUBBLE_RADIUS - 1,
        borderBottomRightRadius: BUBBLE_RADIUS - 1,
        ...(standalone ? { borderTopLeftRadius: 5, borderTopRightRadius: BUBBLE_RADIUS - 1 } : null),
        overflow: 'hidden',
        backgroundColor: off ? '#fafafa' : ai.surface,
      }}
    >
      {off ? null : (
        <LinearGradient
          pointerEvents="none"
          colors={[done ? GREEN_WASH : WASH, ai.surface]}
          locations={[0, 0.7]}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        />
      )}
      <View style={{ paddingHorizontal: 14, paddingTop: 10, paddingBottom: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <AppIcon name={kicker.icon} size={16} color={kickerColour} />
          <Text style={{ fontSize: 12, fontWeight: '500', color: kickerColour }}>{kicker.text}</Text>
        </View>

        {single ? (
          <Text selectable numberOfLines={2} style={{ marginTop: 3, fontSize: 17, lineHeight: 22, fontWeight: '600', color: off ? ai.faint : ai.ink }}>{single.title}</Text>
        ) : null}

        {single && layout === 'facts' ? <Facts facts={single.facts!} dim={off} /> : null}
        {single && layout === 'delta' ? <Delta item={single} dim={off} /> : null}
        {single && layout === 'sentence' ? (
          <Text style={{ marginTop: 6, fontSize: 13.5, color: ai.muted, fontVariant: ['tabular-nums'] }}>
            {single.change}{single.unit ? ` ${single.unit}` : ''}
          </Text>
        ) : null}
        {items.length > 1 ? <PlanRows items={items} /> : null}

        {!off ? effects.map((effect) => <Flag key={effect} tone="side" icon="information-circle-outline" text={effect} />) : null}
        {live ? (warnings ?? []).slice(0, 2).map((warning) => <Flag key={warning} tone="bad" icon="alert-circle-outline" text={warning} />) : null}
        {error ? <Flag tone="bad" icon="alert-circle-outline" text={error} /> : null}
        {done && resultError ? <Flag tone="bad" icon="alert-circle-outline" text={resultError} /> : null}

        {live ? (
          <View style={{ marginTop: 12, flexDirection: 'row', gap: 8 }}>
            <Pressable
              accessibilityRole="button"
              disabled={state === 'confirming'}
              onPress={cancel}
              style={({ pressed }) => ({
                flex: 1,
                height: 44,
                borderRadius: 14,
                borderCurve: 'continuous',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: pressed ? '#e5e7eb' : '#f3f4f6',
                opacity: state === 'confirming' ? 0.5 : 1,
              })}
            >
              <Text style={{ fontSize: 15, fontWeight: '500', color: ai.body }}>{th ? 'ยกเลิก' : 'Cancel'}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={state === 'confirming'
                ? (th ? 'กำลังบันทึก' : 'Saving')
                : `${confirmLabel(items.length, language)} ${th ? `เหลือเวลา ${formatCountdown(remainingMs)}` : `${formatCountdown(remainingMs)} left`}`}
              disabled={state === 'confirming'}
              onPress={() => { void confirm(); }}
              style={({ pressed }) => ({
                flex: 1.6,
                height: 44,
                borderRadius: 14,
                borderCurve: 'continuous',
                overflow: 'hidden',
                opacity: state === 'confirming' ? 0.75 : pressed ? 0.88 : 1,
              })}
            >
              <LinearGradient
                colors={urgent && state === 'pending' ? ['#ea580c', '#d97706'] : [ai.orange, ai.amber]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}
              >
                {state === 'confirming' ? (
                  <>
                    <ActivityIndicator size="small" color="#ffffff" />
                    <Text style={{ fontSize: 15, fontWeight: '600', color: '#ffffff' }}>{th ? 'กำลังบันทึก' : 'Saving'}</Text>
                  </>
                ) : (
                  <>
                    <Text style={{ fontSize: 15, fontWeight: '600', color: '#ffffff' }}>{confirmLabel(items.length, language)}</Text>
                    {Number.isFinite(expiry) ? (
                      <Text style={{ fontSize: 15, fontWeight: '500', color: 'rgba(255,255,255,0.9)', fontVariant: ['tabular-nums'] }}>{formatCountdown(remainingMs)}</Text>
                    ) : null}
                  </>
                )}
                {state === 'pending' && Number.isFinite(expiry) ? (
                  <View style={{ position: 'absolute', left: 0, bottom: 0, height: 3, width: `${progress * 100}%`, backgroundColor: 'rgba(255,255,255,0.7)' }} />
                ) : null}
              </LinearGradient>
            </Pressable>
          </View>
        ) : (
          <View style={{ marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <AppIcon name={done ? 'checkmark-circle' : 'ban-outline'} size={18} color={done ? ai.greenIcon : ai.faint} />
            <Text style={{ flexShrink: 1, fontSize: 13, color: done ? ai.green : ai.faint, fontVariant: ['tabular-nums'] }}>
              {done
                ? `${th ? 'บันทึกลงระบบแล้ว' : 'Saved'}${doneAt ? ` ${confirmSavedAt(doneAt)}` : ''}`
                : (th ? 'ไม่มีการแก้ข้อมูล' : 'Nothing was changed')}
            </Text>
            {destination ? (
              <Pressable
                accessibilityRole="link"
                onPress={() => onOpen?.(destination.href)}
                hitSlop={6}
                style={({ pressed }) => ({ marginLeft: 'auto', borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12, backgroundColor: ai.orangeSoft, opacity: pressed ? 0.7 : 1 })}
              >
                <Text style={{ fontSize: 13, fontWeight: '500', color: ai.deep }}>{th ? destination.th : destination.en}</Text>
              </Pressable>
            ) : null}
            {!done && onReissue ? (
              <Pressable
                accessibilityRole="button"
                onPress={onReissue}
                hitSlop={6}
                style={({ pressed }) => ({ marginLeft: 'auto', borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12, backgroundColor: ai.orangeSoft, opacity: pressed ? 0.7 : 1 })}
              >
                <Text style={{ fontSize: 13, fontWeight: '500', color: ai.deep }}>{th ? 'ขอคำสั่งใหม่' : 'Ask again'}</Text>
              </Pressable>
            ) : null}
          </View>
        )}
      </View>
    </View>
  );
}
