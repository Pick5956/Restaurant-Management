import * as Haptics from 'expo-haptics';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { adjustStock, deleteIngredient, listIngredients, listTransactions } from '@/src/api/ingredient';
import { GlassButton } from '@/src/components/ai/chrome';
import { AppScreen } from '@/src/components/app-shell';
import { AppText as Text } from '@/src/components/app-text';
import {
  Card,
  CountSheet,
  DockButton,
  FloatingHeader,
  LevelBar,
  RestockSheet,
  StatusPill,
  dayHeading,
  dayKey,
  fmt,
  headerContentTop,
  shortDate,
  shortTime,
  statusColour,
} from '@/src/components/inventory/parts';
import { EmptyState, Feedback } from '@/src/components/ui';
import { money } from '@/src/lib/format';
import { countPayload, stockStatus } from '@/src/lib/inventory-list';
import { can } from '@/src/lib/rbac';
import { parsePositiveRouteId } from '@/src/lib/route-id';
import { useAuth } from '@/src/providers/auth-provider';
import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';
import { palette } from '@/src/theme';
import type { Ingredient, IngredientTransaction } from '@/src/types/ingredient';

/**
 * One ingredient: the big number answers "how much is left", the bar under it
 * "am I below the reorder point", then the secondary figures, the two things
 * you can do, and the history that says whether the kitchen used it or a
 * person restocked it. Editing the fields themselves lives in item.tsx.
 */
export default function IngredientDetailScreen() {
  const insets = useSafeAreaInsets();
  const { activeMembership } = useAuth();
  const { copy: t, language } = useDisplayPreferences();
  const locale = language === 'th' ? 'th-TH' : 'en-US';
  const { id } = useLocalSearchParams<{ id?: string }>();
  const route = parsePositiveRouteId(id);
  const itemId = route.kind === 'valid' ? route.id : null;
  const canManage = can(activeMembership, 'manage_inventory');
  const canView = can(activeMembership, 'view_inventory') || canManage;

  const [item, setItem] = useState<Ingredient | null>(null);
  const [transactions, setTransactions] = useState<IngredientTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<'none' | 'restock' | 'count'>('none');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!canView || itemId === null) { setLoading(false); return; }
    setError(null);
    try {
      const response = await listIngredients();
      const found = (response.ingredients || []).find((row) => row.ID === itemId) ?? null;
      setItem(found);
      setMissing(!found);
      if (found) {
        const history = await listTransactions(itemId);
        setTransactions(history.transactions || []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('โหลดข้อมูลวัตถุดิบไม่สำเร็จ', 'Could not load the ingredient.'));
    } finally {
      setLoading(false);
    }
  }, [canView, itemId, t]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const groups = useMemo(() => {
    const out: Array<{ key: string; heading: string; rows: IngredientTransaction[] }> = [];
    for (const row of transactions) {
      const key = dayKey(row.CreatedAt);
      const last = out[out.length - 1];
      if (last && last.key === key) last.rows.push(row);
      else out.push({ key, heading: dayHeading(row.CreatedAt, language), rows: [row] });
    }
    return out;
  }, [transactions, language]);

  const apply = async (payload: { type: 'in' | 'out' | 'adjust'; quantity: number } | null, done: string) => {
    if (!item || busy) return;
    if (!payload) { setSheet('none'); return; }
    setBusy(true);
    try {
      const next = await adjustStock(item.ID, payload);
      setItem((prev) => (prev ? { ...prev, ...next } : next));
      setSheet('none');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      try {
        const history = await listTransactions(item.ID);
        setTransactions(history.transactions || []);
      } catch {
        // The stock is saved; a stale history is the lesser problem.
      }
    } catch (err) {
      Alert.alert(done, err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  const menu = () => {
    if (!item) return;
    Alert.alert(item.name, undefined, [
      { text: t('แก้ไขข้อมูลวัตถุดิบ', 'Edit ingredient'), onPress: () => router.push({ pathname: '/inventory/item' as never, params: { id: String(item.ID) } } as never) },
      {
        text: t('ลบวัตถุดิบ', 'Delete ingredient'),
        style: 'destructive',
        onPress: () => Alert.alert(t(`ลบ ${item.name}?`, `Delete ${item.name}?`), t('ประวัติสต็อกของรายการนี้จะหายไปด้วย', 'Its stock history goes with it.'), [
          { text: t('ยกเลิก', 'Cancel'), style: 'cancel' },
          {
            text: t('ลบ', 'Delete'),
            style: 'destructive',
            onPress: async () => {
              try { await deleteIngredient(item.ID); router.back(); }
              catch (err) { Alert.alert(t('ลบไม่สำเร็จ', 'Could not delete'), err instanceof Error ? err.message : undefined); }
            },
          },
        ]),
      },
      { text: t('ยกเลิก', 'Cancel'), style: 'cancel' },
    ]);
  };

  if (!canView || route.kind !== 'valid') {
    return (
      <AppScreen title={t('รายละเอียดวัตถุดิบ', 'Ingredient details')} topLevel={false}>
        <EmptyState
          title={!canView ? t('ไม่มีสิทธิ์ดูวัตถุดิบ', 'Ingredient access unavailable') : t('ไม่พบวัตถุดิบ', 'Ingredient not found')}
          detail={!canView ? t('บัญชีนี้ต้องมีสิทธิ์ดูหรือจัดการคลังวัตถุดิบ', 'This account needs permission to view or manage inventory.') : t('ลิงก์นี้ไม่ชี้ไปที่วัตถุดิบรายการใด', 'This link does not point at an ingredient.')}
        />
      </AppScreen>
    );
  }

  const status = item ? stockStatus(item) : 'ok';
  const colour = statusColour(status);
  const daily = item?.days_left != null && item.days_left > 0 ? Number(item.stock) / item.days_left : null;

  return (
    <View style={{ flex: 1, backgroundColor: palette.canvas }}>
      <FloatingHeader
        backLabel={t('ย้อนกลับ', 'Back')}
        onBack={() => router.back()}
        title={item?.name ?? t('รายละเอียดวัตถุดิบ', 'Ingredient details')}
        subtitle={item ? (item.category?.name ?? t('ไม่มีหมวด', 'Uncategorised')) : undefined}
        trailing={canManage && item ? <GlassButton icon="ellipsis-horizontal" label={t('ตัวเลือก', 'Options')} onPress={menu} /> : undefined}
      />
      <ScrollView contentContainerStyle={{ paddingTop: headerContentTop(insets.top, false), paddingHorizontal: 12, paddingBottom: insets.bottom + 24, gap: 10 }}>
        {error ? <Feedback title={t('โหลดข้อมูลไม่ได้', 'Could not load')} detail={error} tone="danger" /> : null}
        {loading && !item ? <View style={{ paddingVertical: 48, alignItems: 'center' }}><ActivityIndicator color={palette.primary} /></View> : null}
        {missing ? <EmptyState title={t('ไม่พบวัตถุดิบ', 'Ingredient not found')} detail={t('อาจถูกลบไปแล้ว', 'It may have been deleted.')} /> : null}

        {item ? (
          <>
            <Card style={{ padding: 16 }}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                <Text style={{ fontSize: 40, fontWeight: '700', lineHeight: 48, color: status === 'ok' ? palette.textStrong : colour.ink, fontVariant: ['tabular-nums'] }}>{fmt(item.stock, locale)}</Text>
                <Text style={{ fontSize: 15, color: palette.muted }}>{item.unit}</Text>
                <View style={{ marginLeft: 'auto' }}><StatusPill status={status} language={language} /></View>
              </View>
              <LevelBar item={item} height={8} />
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}>
                <Text style={{ fontSize: 12.5, color: palette.muted }}>
                  {Number(item.min_stock) > 0 ? t(`ขั้นต่ำ ${fmt(item.min_stock, locale)} ${item.unit}`, `Reorder at ${fmt(item.min_stock, locale)} ${item.unit}`) : t('ยังไม่ตั้งขั้นต่ำ', 'No reorder level')}
                </Text>
                {item.days_left != null ? (
                  <Text style={{ fontSize: 12.5, color: palette.muted, fontVariant: ['tabular-nums'] }}>
                    {daily ? t(`ครัวใช้วันละ ~${fmt(daily, locale, 0)} · `, `~${fmt(daily, locale, 0)}/day · `) : ''}
                    {t(`พออีก ${fmt(item.days_left, locale, 1)} วัน`, `${fmt(item.days_left, locale, 1)} days left`)}
                  </Text>
                ) : null}
              </View>
            </Card>

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
              <Stat label={t('มูลค่าคงเหลือ', 'Stock value')} value={money(Number(item.stock) * Number(item.cost_per_unit), language)} />
              <Stat label={t('ราคา/หน่วย', 'Unit cost')} value={`฿${fmt(item.cost_per_unit, locale)} / ${item.unit}`} />
              <Stat label={t('หมวดหมู่', 'Category')} value={item.category?.name ?? t('ไม่มีหมวด', 'Uncategorised')} />
              <Stat label={t('เคลื่อนไหวล่าสุด', 'Last moved')} value={shortDate(item.UpdatedAt, language)} />
            </View>

            {canManage ? (
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 2 }}>
                <DockButton icon="add" label={t('เติมสต็อก', 'Restock')} onPress={() => setSheet('restock')} />
                <DockButton secondary icon="calculator-outline" label={t('ปรับยอด', 'Set count')} onPress={() => setSheet('count')} />
              </View>
            ) : null}

            <Text style={{ fontSize: 15, fontWeight: '700', color: palette.textStrong, marginTop: 10, marginLeft: 4 }}>{t('ประวัติการเคลื่อนไหว', 'History')}</Text>
            {!transactions.length ? (
              <Card style={{ padding: 16 }}>
                <Text style={{ fontSize: 13.5, color: palette.muted }}>{t('ยังไม่มีประวัติสต็อก', 'No stock history yet')}</Text>
              </Card>
            ) : (
              groups.map((group) => (
                <View key={group.key} style={{ gap: 6 }}>
                  <Text style={{ fontSize: 12, fontWeight: '600', color: palette.muted, marginLeft: 4, marginTop: 4 }}>{group.heading}</Text>
                  <Card style={{ paddingHorizontal: 14, paddingVertical: 4 }}>
                    {group.rows.map((row, index) => (
                      <HistoryRow key={row.ID} row={row} unit={item.unit} language={language} locale={locale} first={index === 0} />
                    ))}
                  </Card>
                </View>
              ))
            )}
          </>
        ) : null}
      </ScrollView>

      <RestockSheet
        item={item}
        open={sheet === 'restock'}
        onClose={() => setSheet('none')}
        onSubmit={(quantity) => void apply({ type: 'in', quantity }, t('เติมสต็อกไม่สำเร็จ', 'Could not restock'))}
        busy={busy}
        language={language}
        locale={locale}
      />
      <CountSheet
        item={item}
        open={sheet === 'count'}
        onClose={() => setSheet('none')}
        onSubmit={(payload) => void apply(payload, t('ปรับยอดไม่สำเร็จ', 'Could not save the count'))}
        busy={busy}
        language={language}
        locale={locale}
      />
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card style={{ flexBasis: '47%', flexGrow: 1, paddingHorizontal: 14, paddingVertical: 10 }} radius={18}>
      <Text style={{ fontSize: 11.5, color: palette.muted }}>{label}</Text>
      <Text numberOfLines={1} style={{ fontSize: 16, fontWeight: '600', color: palette.textStrong, marginTop: 2, fontVariant: ['tabular-nums'] }}>{value}</Text>
    </Card>
  );
}

function HistoryRow({ row, unit, language, locale, first }: { row: IngredientTransaction; unit: string; language: 'th' | 'en'; locale: string; first: boolean }) {
  const t = (th: string, en: string) => (language === 'th' ? th : en);
  const who = row.created_by_name || (row.created_by ? row.created_by.first_name : '');
  const kind = row.type === 'in' ? t('เติมสต็อก', 'restocked') : row.type === 'out' ? t('ตัดออก', 'removed') : t('นับจริง', 'counted');
  const line = [who, kind].filter(Boolean).join(' ') + (row.note ? ` · ${row.note}` : '');
  const sign = row.type === 'in' ? '+' : row.type === 'out' ? '−' : '=';
  const ink = row.type === 'in' ? palette.success : row.type === 'out' ? palette.danger : palette.textStrong;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderTopWidth: first ? 0 : 1, borderTopColor: palette.divider }}>
      <Text style={{ width: 42, fontSize: 12.5, color: palette.muted, fontVariant: ['tabular-nums'] }}>{shortTime(row.CreatedAt, language)}</Text>
      <Text numberOfLines={2} style={{ flex: 1, fontSize: 13.5, color: palette.text }}>{line}</Text>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={{ fontSize: 15, fontWeight: '600', color: ink, fontVariant: ['tabular-nums'] }}>{sign}{fmt(row.quantity, locale)} <Text style={{ fontSize: 11, fontWeight: '500', color: palette.muted }}>{unit}</Text></Text>
        <Text style={{ fontSize: 11.5, color: palette.placeholder, fontVariant: ['tabular-nums'] }}>{row.amount ? `฿${fmt(row.amount, locale, 0)}` : '—'}</Text>
      </View>
    </View>
  );
}
