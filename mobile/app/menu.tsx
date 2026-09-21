import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, Switch, useWindowDimensions, View } from 'react-native';

import { listCategories, listMenuItems, setMenuItemAvailability } from '@/src/api/menu';
import { AppText as Text } from '@/src/components/app-text';
import { AppRefreshControl, AppScreen } from '@/src/components/app-shell';
import { MenuImage } from '@/src/components/menu-image';
import { Button, EmptyState, Feedback, SearchField, Select } from '@/src/components/ui';
import { money } from '@/src/lib/format';
import { can } from '@/src/lib/rbac';
import { useAuth } from '@/src/providers/auth-provider';
import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';
import { breakpoints, palette, spacing, typeScale } from '@/src/theme';
import type { Category, MenuItem } from '@/src/types/menu';

export default function MenuScreen() {
  const { width } = useWindowDimensions();
  const { activeMembership } = useAuth();
  const { copy, language } = useDisplayPreferences();
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canManage = can(activeMembership, 'manage_menu');
  const canView = canManage || can(activeMembership, 'view_menu');
  const tabletWorkspace = width >= breakpoints.tabletWorkspace;

  const load = useCallback(async () => {
    if (!canView) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [categoryResponse, itemResponse] = await Promise.all([listCategories(), listMenuItems()]);
      setCategories(categoryResponse.categories || []);
      setItems(itemResponse.menu_items || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : copy('โหลดเมนูไม่สำเร็จ', 'Could not load the menu'));
    } finally {
      setLoading(false);
    }
  }, [canView, copy]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return items.filter((item) => {
      const categoryMatch = category === 'all'
        || item.category_id === Number(category)
        || item.categories?.some((link) => link.category_id === Number(category));
      return categoryMatch
        && (!keyword || [item.name, item.description].some((value) => String(value || '').toLowerCase().includes(keyword)));
    });
  }, [category, items, search]);

  // The switch is controlled, so its thumb follows `is_available` - not the
  // finger. Flipping the row only after the server replied left a window where
  // Android had already slid the thumb across, the next render snapped it back
  // to the stale prop, and the reply slid it over again: a visible wobble on
  // every tap. Flip locally first and let the reply (or a failure) settle it.
  function setAvailability(id: number, available: boolean) {
    setItems((current) => current.map((entry) => (entry.ID === id ? { ...entry, is_available: available } : entry)));
  }

  async function toggle(item: MenuItem) {
    if (!canManage) return;
    const next = !item.is_available;
    setSavingId(item.ID);
    setError(null);
    setAvailability(item.ID, next);
    try {
      const updated = await setMenuItemAvailability(item.ID, next);
      setItems((current) => current.map((entry) => (entry.ID === updated.ID ? updated : entry)));
    } catch (err) {
      setAvailability(item.ID, !next);
      setError(err instanceof Error ? err.message : copy('เปลี่ยนสถานะเมนูไม่สำเร็จ', 'Could not change the menu status'));
    } finally {
      setSavingId(null);
    }
  }

  if (!canView) {
    return (
      <AppScreen title={copy('เมนูอาหาร', 'Menu')} topLevel={false}>
        <EmptyState
          title={copy('ไม่มีสิทธิ์ดูเมนู', 'Menu access unavailable')}
          detail={copy('บัญชีนี้ยังไม่ได้รับสิทธิ์ดูหรือจัดการเมนู', 'This account does not have permission to view or manage the menu.')}
        />
      </AppScreen>
    );
  }

  return (
    <AppScreen
      title={copy('เมนูอาหาร', 'Menu')}
      subtitle={copy(
        `${items.length.toLocaleString('th-TH')} เมนู · ${categories.length.toLocaleString('th-TH')} หมวด${canManage ? '' : ' · ดูอย่างเดียว'}`,
        `${items.length.toLocaleString('en-US')} items · ${categories.length.toLocaleString('en-US')} categories${canManage ? '' : ' · Read only'}`,
      )}
      topLevel={false}
      refreshControl={<AppRefreshControl onRefresh={load} />}
      action={canManage ? (
        <Button compact icon="add-outline" label={copy('เพิ่มเมนู', 'Add item')} onPress={() => router.push('/menu/item' as never)} />
      ) : undefined}
    >
      {error ? <Feedback title={copy('ทำรายการไม่ได้', 'Unable to complete the action')} detail={error} tone="danger" /> : null}

      <View style={{ gap: spacing.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <View style={{ minWidth: 0, flex: 1, justifyContent: 'center' }}>
            <SearchField
              accessibilityLabel={copy('ค้นหาชื่อเมนู', 'Search menu items')}
              clearLabel={copy('ล้างคำค้นหา', 'Clear search')}
              value={search}
              onChangeText={setSearch}
              placeholder={copy('ค้นหาเมนู', 'Search menu')}
            />
          </View>
          {canManage ? (
            <Button
              compact
              icon="folder-open-outline"
              variant="secondary"
              label={tabletWorkspace ? copy('จัดการหมวด', 'Categories') : copy('หมวด', 'Categories')}
              onPress={() => router.push('/menu/categories' as never)}
            />
          ) : null}
        </View>
        <Select
          label={copy('หมวดหมู่', 'Category')}
          value={category}
          onChange={setCategory}
          options={[
            { label: copy('ทุกหมวด', 'All categories'), value: 'all' },
            ...categories.filter((item) => item.is_active).map((item) => ({ label: item.name, value: String(item.ID) })),
          ]}
        />
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: spacing.md }}>
        {filtered.map((item) => (
          <View
            key={item.ID}
            style={{
              minWidth: 0,
              // Phones get an exact two-column grid. A grow factor here fights the
              // column width and stretches a lone card on the last row across the
              // screen, which reads as a different, more important item.
              width: tabletWorkspace ? undefined : '48%',
              flexGrow: 0,
              flexBasis: tabletWorkspace ? 240 : 'auto',
              maxWidth: tabletWorkspace ? 260 : undefined,
              gap: spacing.sm,
            }}
          >
            <Pressable
              accessibilityLabel={copy(`เมนู ${item.name}`, `Menu item ${item.name}`)}
              accessibilityRole={canManage ? 'button' : undefined}
              accessibilityState={{ disabled: !canManage }}
              disabled={!canManage}
              onPress={() => router.push({ pathname: '/menu/item' as never, params: { id: String(item.ID) } } as never)}
              style={({ pressed }) => ({ gap: spacing.sm, opacity: pressed ? 0.72 : 1 })}
            >
              <MenuImage
                accessibilityLabel={copy(`รูปเมนู ${item.name}`, `Photo of ${item.name}`)}
                imageUrl={item.image_url}
                variant="card"
              />
              <View style={{ gap: spacing.xs, paddingHorizontal: spacing.xs }}>
                <Text selectable numberOfLines={2} style={typeScale.cardTitle}>{item.name}</Text>
                <Text selectable style={typeScale.number}>{money(item.price, language)}</Text>
              </View>
            </Pressable>
            {/*
              The switch position is the status - a badge beside it would say the
              same thing twice. It stays rendered but disabled without manage
              rights, so a read-only account can still read availability.
            */}
            <View
              style={{
                minHeight: 44,
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.sm,
                paddingHorizontal: spacing.xs,
              }}
            >
              <Text
                numberOfLines={1}
                style={[typeScale.caption, { minWidth: 0, flex: 1, color: palette.muted, fontWeight: '700' }]}
              >
                {copy('พร้อมขาย', 'Available')}
              </Text>
              <Switch
                accessibilityLabel={copy(`พร้อมขาย ${item.name}`, `${item.name} available`)}
                disabled={!canManage || (savingId !== null && savingId !== item.ID)}
                onValueChange={() => void toggle(item)}
                value={item.is_available}
              />
            </View>
          </View>
        ))}
      </View>

      {!loading && !filtered.length ? (
        <EmptyState
          title={copy('ไม่พบเมนู', 'No menu items found')}
          detail={items.length
            ? copy('ลองเปลี่ยนตัวกรองหรือคำค้น', 'Try changing the filters or search term.')
            : canManage
              ? copy('เพิ่มเมนูแรกเพื่อเริ่มรับออเดอร์', 'Add your first item to start taking orders.')
              : copy('ร้านยังไม่มีเมนูที่เปิดให้ดู', 'The restaurant has not made any menu items visible yet.')}
        />
      ) : null}
    </AppScreen>
  );
}
