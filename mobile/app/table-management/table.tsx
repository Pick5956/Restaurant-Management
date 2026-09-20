import { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, Share, useWindowDimensions, View } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';

import {
  bulkCreateTables,
  deleteTable,
  listTables,
  listTableZones,
  moveTableZone,
  regenerateTableCustomerToken,
  updateTable,
} from '@/src/api/table';
import { AppIcon } from '@/src/components/app-icon';
import { AppScreen } from '@/src/components/app-shell';
import { AppText as Text } from '@/src/components/app-text';
import { ActionDock, Button, ChipGroup, EmptyState, Feedback, SectionHeader, StatusBadge, Surface, TextField } from '@/src/components/ui';
import { tableStatusLabel } from '@/src/lib/format';
import { toInt } from '@/src/lib/forms';
import { customerTableUrl } from '@/src/lib/public-web-url';
import { can } from '@/src/lib/rbac';
import { parsePositiveRouteId } from '@/src/lib/route-id';
import { canEditTableAvailability, tableEditorSaveStatus } from '@/src/lib/table-workflow';
import { useAuth } from '@/src/providers/auth-provider';
import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';
import { breakpoints, palette, spacing, typeScale } from '@/src/theme';
import type { RestaurantTable, TableStatus, TableZone } from '@/src/types/table';

type TableForm = {
  zoneId: number;
  capacity: string;
  count: string;
  status: TableStatus;
};

function emptyTableForm(): TableForm {
  return { zoneId: 0, capacity: '2', count: '1', status: 'free' };
}

export default function TableFormScreen() {
  const { width } = useWindowDimensions();
  const { activeMembership } = useAuth();
  const { copy, language } = useDisplayPreferences();
  const params = useLocalSearchParams<{ tableId?: string; mode?: string }>();
  const routeId = parsePositiveRouteId(params.tableId);
  const editingId = routeId.kind === 'valid' ? routeId.id : null;
  const isEditing = routeId.kind === 'valid';
  const invalidRoute = routeId.kind === 'invalid';
  const canManage = can(activeMembership, 'manage_table');
  const tabletWorkspace = width >= breakpoints.tabletWorkspace;

  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [zones, setZones] = useState<TableZone[]>([]);
  const [form, setForm] = useState<TableForm>(emptyTableForm());
  const [initialized, setInitialized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<'bulk' | 'delete' | 'qr' | null>(null);

  const editingTable = useMemo(
    () => (isEditing ? tables.find((table) => table.ID === editingId) ?? null : null),
    [editingId, isEditing, tables],
  );
  const activeZones = useMemo(() => zones.filter((zone) => zone.is_active), [zones]);
  const availabilityStatusEditable = !editingTable || canEditTableAvailability(editingTable.status);
  const statusOptions = useMemo<Array<{ label: string; value: TableStatus }>>(() => [
    { label: copy('เปิดใช้งาน', 'Active'), value: 'free' },
    { label: copy('ปิดใช้งาน', 'Inactive'), value: 'inactive' },
  ], [copy]);
  const zoneOptions = useMemo(() => [
    { label: copy('ไม่มีโซน', 'No zone'), value: 0 },
    ...activeZones.map((zone) => ({ label: `${zone.name}${zone.prefix ? ` (${zone.prefix})` : ''}`, value: zone.ID })),
  ], [activeZones, copy]);
  const bulkPreview = useMemo(() => {
    const count = Math.max(1, toInt(form.count, 1));
    const zone = activeZones.find((item) => item.ID === form.zoneId);
    const existing = tables.filter((table) => (form.zoneId ? table.zone_id === form.zoneId : !table.zone_id));
    const next = Math.max(0, ...existing.map((table) => table.sequence_number || 0)) + 1;
    const label = (sequence: number) => (zone ? `${zone.prefix || 'Z'}${String(sequence).padStart(2, '0')}` : `T${sequence}`);
    return count === 1 ? label(next) : `${label(next)}-${label(next + count - 1)}`;
  }, [activeZones, form.count, form.zoneId, tables]);
  const customerOrderLink = editingTable?.customer_token ? customerTableUrl(editingTable.customer_token) : '';

  const load = useCallback(async () => {
    if (!canManage || invalidRoute) {
      setLoading(false);
      return;
    }
    setError(null);
    try {
      const [tableResponse, zoneResponse] = await Promise.all([
        listTables(),
        listTableZones(),
      ]);
      setTables(tableResponse.tables ?? []);
      setZones(zoneResponse.zones ?? []);
    } catch (err) {
      setError(err instanceof Error
        ? err.message
        : copy('โหลดข้อมูลโต๊ะไม่สำเร็จ', 'Unable to load table data'));
    } finally {
      setLoading(false);
    }
  }, [canManage, copy, invalidRoute]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (initialized || loading) return;
    if (isEditing) {
      if (!editingTable) return;
      setForm({
        zoneId: editingTable.zone_id || 0,
        capacity: String(editingTable.capacity || 2),
        count: '1',
        status: editingTable.status,
      });
    } else {
      setForm(emptyTableForm());
    }
    setInitialized(true);
  }, [editingTable, initialized, isEditing, loading]);

  if (!activeMembership) return <Redirect href="/restaurants" />;
  if (invalidRoute) {
    return (
      <AppScreen title={copy('รายละเอียดโต๊ะ', 'Table details')} topLevel={false}>
        <EmptyState title={copy('ไม่พบโต๊ะ', 'Table not found')} detail={copy('ลิงก์โต๊ะนี้ไม่ถูกต้อง', 'This table link is invalid.')} />
      </AppScreen>
    );
  }
  if (!canManage) {
    return <AppScreen title={copy('จัดการโต๊ะ', 'Manage tables')} topLevel={false}><EmptyState title={copy('ไม่มีสิทธิ์จัดการโต๊ะ', 'No table management access')} /></AppScreen>;
  }
  if (isEditing && loading) {
    return (
      <AppScreen title={copy('รายละเอียดโต๊ะ', 'Table details')} topLevel={false}>
        <EmptyState title={copy('กำลังโหลดโต๊ะ', 'Loading table')} />
      </AppScreen>
    );
  }
  if (isEditing && error) {
    return (
      <AppScreen title={copy('รายละเอียดโต๊ะ', 'Table details')} topLevel={false}>
        <Feedback title={copy('โหลดโต๊ะไม่สำเร็จ', 'Unable to load table')} detail={error} tone="danger" />
      </AppScreen>
    );
  }
  if (isEditing && !editingTable) {
    return (
      <AppScreen title={copy('รายละเอียดโต๊ะ', 'Table details')} topLevel={false}>
        <EmptyState title={copy('ไม่พบโต๊ะ', 'Table not found')} detail={copy('โต๊ะนี้อาจถูกลบไปแล้ว', 'This table may have been deleted.')} />
      </AppScreen>
    );
  }

  async function persist() {
    if (!canManage || submitting || invalidRoute || (isEditing && !editingTable)) return;
    const safeCapacity = Math.min(50, Math.max(1, toInt(form.capacity, 2)));
    const safeCount = Math.min(200, Math.max(1, toInt(form.count, 1)));
    const payload = {
      zone_id: form.zoneId || null,
      capacity: safeCapacity,
      status: editingTable
        ? tableEditorSaveStatus(editingTable.status, form.status)
        : form.status,
    };

    setSubmitting(true);
    setFormError(null);
    try {
      if (editingTable) {
        let nextZone = editingTable.zone_id ?? null;
        if ((editingTable.zone_id || 0) !== form.zoneId) {
          const moved = await moveTableZone(editingTable.ID, { zone_id: payload.zone_id });
          nextZone = moved.zone_id ?? null;
        }
        await updateTable(editingTable.ID, { ...payload, zone_id: nextZone });
      } else {
        await bulkCreateTables({ ...payload, count: safeCount });
      }
      router.replace('/table-management' as never);
    } catch (err) {
      setFormError(err instanceof Error
        ? err.message
        : copy('บันทึกข้อมูลโต๊ะไม่สำเร็จ', 'Unable to save table data'));
    } finally {
      setSubmitting(false);
    }
  }

  async function saveTable() {
    if (invalidRoute || (isEditing && !editingTable)) return;
    if (!editingTable && Math.max(1, toInt(form.count, 1)) > 1) {
      if (confirmAction !== 'bulk') {
        setConfirmAction('bulk');
        setFormError(copy(
          'ตรวจจำนวนและตัวอย่างเลขโต๊ะ แล้วกดยืนยันสร้างโต๊ะอีกครั้ง',
          'Review the quantity and table-number preview, then confirm creation again.',
        ));
        return;
      }
      setConfirmAction(null);
      await persist();
      return;
    }
    await persist();
  }

  async function confirmDelete() {
    if (!canManage || !editingTable) return;
    if (confirmAction !== 'delete') { setConfirmAction('delete'); setFormError(copy('กดยืนยันอีกครั้งเพื่อลบโต๊ะนี้', 'Press confirm again to delete this table.')); return; }
    setSubmitting(true); setFormError(null);
    try { await deleteTable(editingTable.ID); router.replace('/table-management' as never); }
    catch (err) { setFormError(err instanceof Error ? err.message : copy('ลบโต๊ะไม่สำเร็จ', 'Unable to delete table')); }
    finally { setSubmitting(false); }
  }

  async function regenerateCustomerLink() {
    if (!canManage || !editingTable) return;
    if (confirmAction !== 'qr') { setConfirmAction('qr'); setFormError(copy('กดยืนยันอีกครั้งเพื่อสร้างลิงก์ใหม่ ลิงก์เดิมจะใช้ไม่ได้ทันที', 'Press confirm again to create a new link. The old link will stop working immediately.')); return; }
    setSubmitting(true); setFormError(null);
    try { const updated = await regenerateTableCustomerToken(editingTable.ID); setTables((current) => current.map((table) => (table.ID === updated.ID ? updated : table))); setConfirmAction(null); }
    catch (err) { setFormError(err instanceof Error ? err.message : copy('สร้างลิงก์ใหม่ไม่สำเร็จ', 'Unable to regenerate the link')); }
    finally { setSubmitting(false); }
  }

  async function shareCustomerLink() {
    if (!customerOrderLink) return;
    await Share.share({
      title: copy('ลิงก์เมนูลูกค้า', 'Customer menu link'),
      message: copy(
        `สแกนหรือเปิดลิงก์นี้เพื่อสั่งอาหารจากโต๊ะ\n${customerOrderLink}`,
        `Scan or open this link to order from the table.\n${customerOrderLink}`,
      ),
      url: customerOrderLink,
    });
  }

  async function openCustomerMenu() {
    if (!customerOrderLink) return;
    await Linking.openURL(customerOrderLink);
  }

  return (
    <AppScreen
      title={editingTable ? copy('แก้ไขโต๊ะ', 'Edit table') : copy('เพิ่มโต๊ะ', 'Add tables')}
      subtitle={editingTable
        ? editingTable.display_label || editingTable.table_number
        : copy(`ตัวอย่างเลข ${bulkPreview}`, `Number preview ${bulkPreview}`)}
      topLevel={false}
      footer={!tabletWorkspace && confirmAction !== 'delete' && confirmAction !== 'qr' ? (
        <ActionDock>
          <Button
            icon={confirmAction === 'bulk' ? 'checkmark-circle-outline' : 'checkmark'}
            label={confirmAction === 'bulk' ? copy('ยืนยันสร้างโต๊ะ', 'Confirm table creation') : editingTable ? copy('บันทึกโต๊ะ', 'Save table') : copy('เพิ่มโต๊ะ', 'Add tables')}
            onPress={saveTable}
            loading={submitting}
            disabled={isEditing && !editingTable}
          />
        </ActionDock>
      ) : undefined}
    >
      {error ? <Feedback title={copy('ทำรายการไม่ได้', 'Unable to complete action')} detail={error} tone="danger" /> : null}
      {formError ? <Feedback title={copy('ตรวจสอบอีกครั้ง', 'Check before continuing')} detail={formError} tone={confirmAction === 'delete' ? 'danger' : confirmAction ? 'warning' : 'danger'} /> : null}
      <View style={{ flexDirection: tabletWorkspace ? 'row' : 'column', alignItems: 'flex-start', gap: spacing.lg }}>
        <View style={{ width: tabletWorkspace ? undefined : '100%', minWidth: 0, flex: tabletWorkspace ? 1.15 : undefined, gap: spacing.lg }}>
          <Surface>
            <SectionHeader title={copy('ตั้งค่าโต๊ะ', 'Table settings')} action={<AppIcon color={palette.muted} name="restaurant-outline" size={22} />} />
            <ChipGroup label={copy('โซน', 'Zone')} value={form.zoneId} options={zoneOptions} onChange={(value) => setForm((current) => ({ ...current, zoneId: value }))} scrollable />
            <View style={{ flexDirection: tabletWorkspace ? 'row' : 'column', gap: spacing.md }}>
              {!editingTable ? <View style={{ flex: 1 }}><TextField keyboardType="numeric" label={copy('จำนวนโต๊ะ', 'Number of tables')} value={form.count} onChangeText={(value) => setForm((current) => ({ ...current, count: value }))} /></View> : null}
              <View style={{ flex: 1 }}><TextField keyboardType="numeric" label={copy('จำนวนที่นั่ง', 'Seating capacity')} value={form.capacity} onChangeText={(value) => setForm((current) => ({ ...current, capacity: value }))} /></View>
            </View>
            {availabilityStatusEditable ? (
              <ChipGroup label={copy('สถานะ', 'Status')} value={form.status} options={statusOptions} onChange={(value) => setForm((current) => ({ ...current, status: value }))} />
            ) : editingTable ? (
              <View style={{ gap: spacing.sm }}>
                <Text style={[typeScale.caption, { color: palette.muted }]}>{copy('สถานะปัจจุบัน', 'Current status')}</Text>
                <StatusBadge label={tableStatusLabel(editingTable.status, language)} tone={editingTable.status === 'reserved' ? 'info' : 'warning'} />
                <Text style={[typeScale.caption, { color: palette.muted }]}>{copy('สถานะนี้เปลี่ยนตามการจองหรือออเดอร์', 'This status follows the reservation or order.')}</Text>
              </View>
            ) : null}
            {tabletWorkspace && confirmAction !== 'delete' && confirmAction !== 'qr' ? <Button icon="checkmark" label={confirmAction === 'bulk' ? copy('ยืนยันสร้างโต๊ะ', 'Confirm table creation') : editingTable ? copy('บันทึกโต๊ะ', 'Save table') : copy('เพิ่มโต๊ะ', 'Add tables')} onPress={saveTable} loading={submitting} /> : null}
          </Surface>
        </View>

        {editingTable ? (
          <View style={{ width: tabletWorkspace ? undefined : '100%', minWidth: 0, flex: tabletWorkspace ? 0.85 : undefined, gap: spacing.lg }}>
            {customerOrderLink ? (
              <Surface>
                <SectionHeader title={copy('เมนูลูกค้า', 'Customer menu')} detail={copy('แชร์ลิงก์นี้ให้ลูกค้าที่โต๊ะ', 'Share this link with guests at the table.')} action={<AppIcon color={palette.muted} name="qr-code-outline" size={22} />} />
                <Text selectable numberOfLines={2} style={[typeScale.caption, { color: palette.muted }]}>{customerOrderLink}</Text>
                <Button icon="share-social-outline" variant="secondary" label={copy('แชร์ลิงก์', 'Share link')} onPress={() => { void shareCustomerLink(); }} />
                <Button icon="open-outline" label={copy('เปิดเมนูลูกค้า', 'Open customer menu')} onPress={() => { void openCustomerMenu(); }} />
                {confirmAction === 'qr' ? <Button variant="secondary" label={copy('ยกเลิก', 'Cancel')} onPress={() => { setConfirmAction(null); setFormError(null); }} /> : null}
                <Button icon="link-outline" variant={confirmAction === 'qr' ? 'danger' : 'ghost'} label={confirmAction === 'qr' ? copy('ยืนยันสร้างลิงก์ใหม่', 'Confirm new link') : copy('สร้างลิงก์ใหม่', 'Regenerate link')} onPress={() => { void regenerateCustomerLink(); }} loading={submitting} />
              </Surface>
            ) : null}
            <Surface>
              <SectionHeader title={copy('ลบโต๊ะ', 'Delete table')} detail={copy('ลบเมื่อโต๊ะไม่ได้ใช้งานแล้วเท่านั้น', 'Delete only when this table is no longer in use.')} />
              {confirmAction === 'delete' ? <Button variant="secondary" label={copy('ยกเลิก', 'Cancel')} onPress={() => { setConfirmAction(null); setFormError(null); }} /> : null}
              <Button icon="trash-outline" variant={confirmAction === 'delete' ? 'danger' : 'secondary'} label={confirmAction === 'delete' ? copy('ยืนยันลบโต๊ะ', 'Confirm delete table') : copy('ลบโต๊ะ', 'Delete table')} onPress={() => { void confirmDelete(); }} loading={submitting} />
            </Surface>
          </View>
        ) : null}
      </View>
    </AppScreen>
  );
}
