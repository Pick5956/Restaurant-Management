import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { listAllTransactions } from '@/src/api/ingredient';
import { AppScreen } from '@/src/components/app-shell';
import { AppText as Text } from '@/src/components/app-text';
import {
  Card,
  FloatingHeader,
  SearchCapsule,
  Segmented,
  dayHeading,
  dayKey,
  fmt,
  headerContentTop,
  shortTime,
} from '@/src/components/inventory/parts';
import { EmptyState, Feedback } from '@/src/components/ui';
import { can } from '@/src/lib/rbac';
import { useAuth } from '@/src/providers/auth-provider';
import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';
import { palette } from '@/src/theme';
import type { IngredientTransaction } from '@/src/types/ingredient';

type Kind = 'all' | 'in' | 'out' | 'adjust';

const PAGE = 100;

/**
 * Every stock movement in the shop, newest first — the same log the detail
 * screen shows for one ingredient, without the ingredient. Filtering and
 * paging happen on the server: a busy kitchen writes thousands of these, and
 * the phone should never hold them all to show fifty.
 */
export default function InventoryHistoryScreen() {
  const insets = useSafeAreaInsets();
  const { activeMembership } = useAuth();
  const { copy: t, language } = useDisplayPreferences();
  const locale = language === 'th' ? 'th-TH' : 'en-US';
  const canManage = can(activeMembership, 'manage_inventory');
  const canView = can(activeMembership, 'view_inventory') || canManage;

  const [rows, setRows] = useState<IngredientTransaction[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [kind, setKind] = useState<Kind>('all');
  const [search, setSearch] = useState('');
  // What the API was last asked for. Typing should not fire a request per
  // keystroke; the settled term does.
  const [term, setTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setTerm(search.trim()), 350);
    return () => clearTimeout(timer);
  }, [search]);

  const load = useCallback(async (nextPage: number) => {
    if (!canView) { setLoading(false); return; }
    if (nextPage === 1) setLoading(true); else setMore(true);
    setError(null);
    try {
      const response = await listAllTransactions({
        type: kind === 'all' ? '' : kind,
        search: term,
        page: nextPage,
        limit: PAGE,
      });
      const list = response.transactions || [];
      setRows((prev) => (nextPage === 1 ? list : [...prev, ...list]));
      setTotal(response.total ?? list.length);
      setPage(nextPage);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('โหลดประวัติไม่สำเร็จ', 'Could not load the history.'));
    } finally {
      setLoading(false);
      setMore(false);
    }
  }, [canView, kind, term, t]);

  // A new filter is a new list, from the first page.
  useEffect(() => { void load(1); }, [load]);

  const groups = useMemo(() => {
    const out: Array<{ key: string; heading: string; rows: IngredientTransaction[] }> = [];
    for (const row of rows) {
      const key = dayKey(row.CreatedAt);
      const last = out[out.length - 1];
      if (last && last.key === key) last.rows.push(row);
      else out.push({ key, heading: dayHeading(row.CreatedAt, language), rows: [row] });
    }
    return out;
  }, [rows, language]);

  if (!canView) {
    return (
      <AppScreen title={t('ประวัติทั้งคลัง', 'Inventory history')} topLevel={false}>
        <EmptyState title={t('ไม่มีสิทธิ์ดูคลังวัตถุดิบ', 'Inventory access unavailable')} detail={t('บัญชีนี้ต้องมีสิทธิ์ดูหรือจัดการคลังวัตถุดิบ', 'This account needs permission to view or manage inventory.')} />
      </AppScreen>
    );
  }

  const bar = (
    <SearchCapsule
      value={search}
      onChangeText={setSearch}
      placeholder={t('ค้นหาชื่อวัตถุดิบ', 'Search ingredient name')}
      clearLabel={t('ล้างคำค้นหา', 'Clear search')}
    />
  );

  const rail = (
    <Segmented
      value={kind}
      onChange={setKind}
      options={[
        { value: 'all', label: t('ทั้งหมด', 'All') },
        { value: 'in', label: t('เติมเข้า', 'In') },
        { value: 'out', label: t('ตัดออก', 'Out') },
        { value: 'adjust', label: t('ปรับยอด', 'Set') },
      ]}
    />
  );

  return (
    <View style={{ flex: 1, backgroundColor: palette.canvas }}>
      <FloatingHeader
        centered
        title={t('ประวัติทั้งคลัง', 'Inventory history')}
        backLabel={t('ย้อนกลับ', 'Back')}
        onBack={() => router.back()}
        bar={bar}
        rail={rail}
      />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingTop: headerContentTop(insets.top, true, true), paddingHorizontal: 12, paddingBottom: insets.bottom + 24, gap: 10 }}
      >
        {error ? <Feedback title={t('โหลดประวัติไม่ได้', 'Could not load')} detail={error} tone="danger" /> : null}
        {loading ? <View style={{ paddingVertical: 48, alignItems: 'center' }}><ActivityIndicator color={palette.primary} /></View> : null}

        {!loading && !rows.length && !error ? (
          <EmptyState
            title={t('ไม่มีการเคลื่อนไหว', 'No movements')}
            detail={term || kind !== 'all' ? t('ลองเปลี่ยนคำค้นหรือประเภท', 'Try another search term or type.') : t('เมื่อมีการเติมหรือตัดสต็อก รายการจะมาอยู่ที่นี่', 'Restocks and deductions appear here.')}
          />
        ) : null}

        {groups.map((group) => (
          <View key={group.key} style={{ gap: 6 }}>
            <Text style={{ fontSize: 12, fontWeight: '600', color: palette.muted, marginLeft: 4, marginTop: 4 }}>{group.heading}</Text>
            <Card solid style={{ paddingHorizontal: 14, paddingVertical: 4 }}>
              {group.rows.map((row, index) => (
                <Row key={row.ID} row={row} language={language} locale={locale} first={index === 0} />
              ))}
            </Card>
          </View>
        ))}

        {!loading && rows.length < total ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => void load(page + 1)}
            disabled={more}
            style={({ pressed }) => ({ height: 48, borderRadius: 24, borderWidth: 1, borderColor: palette.border, backgroundColor: pressed ? palette.surfaceStrong : palette.surface, alignItems: 'center', justifyContent: 'center', marginTop: 4 })}
          >
            {more ? (
              <ActivityIndicator color={palette.primary} />
            ) : (
              <Text style={{ fontSize: 14.5, fontWeight: '600', color: palette.primaryInk }}>
                {t(`โหลดเพิ่ม · เหลืออีก ${(total - rows.length).toLocaleString(locale)}`, `Load more · ${(total - rows.length).toLocaleString(locale)} left`)}
              </Text>
            )}
          </Pressable>
        ) : null}

        {!loading && rows.length && rows.length >= total ? (
          <Text style={{ fontSize: 12, color: palette.placeholder, textAlign: 'center', marginTop: 6 }}>
            {t(`ทั้งหมด ${total.toLocaleString(locale)} รายการ`, `${total.toLocaleString(locale)} movements in all`)}
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

function Row({ row, language, locale, first }: { row: IngredientTransaction; language: 'th' | 'en'; locale: string; first: boolean }) {
  const t = (th: string, en: string) => (language === 'th' ? th : en);
  const unit = row.ingredient_unit || '';
  const who = row.created_by_name || (row.created_by ? row.created_by.first_name : '');
  const kind = row.type === 'in' ? t('เติมสต็อก', 'restocked') : row.type === 'out' ? t('ตัดออก', 'removed') : t('ปรับยอด', 'set');
  const line = [who, kind].filter(Boolean).join(' ') + (row.note ? ` · ${row.note}` : '');
  const sign = row.type === 'in' ? '+' : row.type === 'out' ? '−' : '=';
  const ink = row.type === 'in' ? palette.success : row.type === 'out' ? palette.danger : palette.textStrong;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderTopWidth: first ? 0 : 1, borderTopColor: palette.divider }}>
      <Text style={{ width: 42, fontSize: 12.5, color: palette.muted, fontVariant: ['tabular-nums'] }}>{shortTime(row.CreatedAt, language)}</Text>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 14.5, fontWeight: '600', color: palette.textStrong }}>
          {row.ingredient_name || t('วัตถุดิบที่ถูกลบแล้ว', 'Deleted ingredient')}
        </Text>
        <Text numberOfLines={1} style={{ fontSize: 12.5, color: palette.muted, marginTop: 1 }}>{line}</Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={{ fontSize: 15, fontWeight: '600', color: ink, fontVariant: ['tabular-nums'] }}>
          {sign}{fmt(row.quantity, locale)} <Text style={{ fontSize: 11, fontWeight: '500', color: palette.muted }}>{unit}</Text>
        </Text>
        <Text style={{ fontSize: 11.5, color: palette.placeholder, fontVariant: ['tabular-nums'] }}>{row.amount ? `฿${fmt(row.amount, locale, 0)}` : '—'}</Text>
      </View>
    </View>
  );
}
