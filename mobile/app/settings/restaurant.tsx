import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useWindowDimensions, View } from 'react-native';

import { deleteRestaurant, getRestaurant, updateRestaurant } from '@/src/api/restaurant';
import { AppIcon, type AppIconName } from '@/src/components/app-icon';
import { AppScreen } from '@/src/components/app-shell';
import {
  ActionDock,
  Button,
  ChipGroup,
  EdgeRow,
  EdgeSection,
  Feedback,
  SectionHeader,
  Surface,
  TextField,
} from '@/src/components/ui';
import { toFloat, toInt } from '@/src/lib/forms';
import { can } from '@/src/lib/rbac';
import { parseGeofenceSettings } from '@/src/lib/restaurant-settings';
import {
  DEFAULT_RESTAURANT_TYPE,
  normalizeRestaurantType,
  restaurantTypeOptions,
} from '@/src/lib/restaurant-types';
import { useAuth } from '@/src/providers/auth-provider';
import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';
import { useToast } from '@/src/providers/toast-provider';
import { breakpoints, palette, spacing } from '@/src/theme';

type RestaurantSection = 'general' | 'hours' | 'ordering' | 'billing' | 'promptpay';

function SettingsSection({
  children,
  collapsible,
  detail,
  expanded,
  icon,
  onToggle,
  title,
}: {
  children: React.ReactNode;
  collapsible: boolean;
  detail?: string;
  expanded: boolean;
  icon: AppIconName;
  onToggle: () => void;
  title: string;
}) {
  const { copy } = useDisplayPreferences();
  const content = (
    <>
      <EdgeRow
        accessibilityLabel={collapsible
          ? copy(`${title}, ${expanded ? 'เปิดอยู่' : 'ปิดอยู่'}`, `${title}, ${expanded ? 'expanded' : 'collapsed'}`)
          : title}
        detail={detail}
        icon={icon}
        onPress={collapsible ? onToggle : undefined}
        showChevron={false}
        title={title}
        trailing={collapsible ? (
          <AppIcon color={palette.muted} name={expanded ? 'chevron-up' : 'chevron-down'} size={18} />
        ) : undefined}
      />
      {expanded ? (
        <View style={{ gap: spacing.md, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.lg }}>
          {children}
        </View>
      ) : null}
    </>
  );

  if (collapsible) return <EdgeSection>{content}</EdgeSection>;

  return (
    <Surface style={{ gap: 0, padding: 0, overflow: 'hidden' }}>
      {content}
    </Surface>
  );
}

export default function RestaurantSettingsScreen() {
  const { width } = useWindowDimensions();
  const { activeMembership, refreshMemberships } = useAuth();
  const { copy, language } = useDisplayPreferences();
  const restaurantId = activeMembership?.restaurant_id;
  const canManageRestaurant = can(activeMembership, 'manage_restaurant_settings');
  const isOwner = activeMembership?.role?.name === 'owner';
  const tabletWorkspace = width >= breakpoints.tabletWorkspace;

  const [name, setName] = useState('');
  const [branch, setBranch] = useState('');
  const [type, setType] = useState<string>(DEFAULT_RESTAURANT_TYPE);
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [logo, setLogo] = useState('');
  const [coverImage, setCoverImage] = useState('');
  const [openTime, setOpenTime] = useState('09:00');
  const [closeTime, setCloseTime] = useState('22:00');
  const [tableCount, setTableCount] = useState('0');
  const [serviceEnabled, setServiceEnabled] = useState<'yes' | 'no'>('no');
  const [serviceRate, setServiceRate] = useState('10');
  const [vatEnabled, setVatEnabled] = useState<'yes' | 'no'>('no');
  const [vatRate, setVatRate] = useState('7');
  const [promptpayName, setPromptpayName] = useState('');
  const [promptpayQr, setPromptpayQr] = useState('');
  const [geofenceEnabled, setGeofenceEnabled] = useState<'yes' | 'no'>('no');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [orderRadius, setOrderRadius] = useState('150');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // `error` is the restaurant failing to load. Save and delete report through a
  // toast (14 ก.ย.) — the form is long, and a bar at the top of it was out of
  // sight of the Save button that raised it.
  const { showToast } = useToast();
  const actionFailed = (detail: string) => showToast({ tone: 'error', title: copy('ทำรายการไม่ได้', 'Unable to complete action'), message: detail });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [expandedSection, setExpandedSection] = useState<RestaurantSection>('general');

  function sectionProps(section: RestaurantSection) {
    return {
      collapsible: !tabletWorkspace,
      expanded: tabletWorkspace || expandedSection === section,
      onToggle: () => setExpandedSection((current) => current === section ? 'general' : section),
    };
  }

  useEffect(() => {
    if (!restaurantId || !canManageRestaurant) {
      setLoading(false);
      return;
    }
    setLoading(true);
    getRestaurant(restaurantId)
      .then((restaurant) => {
        setName(restaurant.name || '');
        setBranch(restaurant.branch_name || '');
        setType(normalizeRestaurantType(restaurant.restaurant_type));
        setAddress(restaurant.address || '');
        setPhone(restaurant.phone || '');
        setLogo(restaurant.logo || '');
        setCoverImage(restaurant.cover_image || '');
        setOpenTime(restaurant.open_time || '09:00');
        setCloseTime(restaurant.close_time || '22:00');
        setTableCount(String(restaurant.table_count || 0));
        setServiceEnabled(restaurant.service_charge_enabled ? 'yes' : 'no');
        setServiceRate(String(restaurant.service_charge_rate || 0));
        setVatEnabled(restaurant.vat_enabled ? 'yes' : 'no');
        setVatRate(String(restaurant.vat_rate || 0));
        setPromptpayName(restaurant.promptpay_name || '');
        setPromptpayQr(restaurant.promptpay_qr_image || '');
        const hasGeofence = Boolean(
          restaurant.order_radius_meters
          && restaurant.latitude != null
          && restaurant.longitude != null,
        );
        setGeofenceEnabled(hasGeofence ? 'yes' : 'no');
        setLatitude(restaurant.latitude != null ? String(restaurant.latitude) : '');
        setLongitude(restaurant.longitude != null ? String(restaurant.longitude) : '');
        setOrderRadius(restaurant.order_radius_meters
          ? String(restaurant.order_radius_meters)
          : '150');
      })
      .catch((err) => setError(err instanceof Error
        ? err.message
        : copy('โหลดข้อมูลร้านไม่สำเร็จ', 'Could not load restaurant information')))
      .finally(() => setLoading(false));
  }, [canManageRestaurant, copy, restaurantId]);

  async function save() {
    if (!restaurantId || !canManageRestaurant || saving) return;
    if (!name.trim() || !branch.trim()) {
      setExpandedSection('general');
      actionFailed(copy(
        'กรอกชื่อร้านและชื่อสาขาให้ครบ',
        'Enter both the restaurant and branch names',
      ));
      return;
    }
    const geofence = parseGeofenceSettings(
      geofenceEnabled === 'yes',
      latitude,
      longitude,
      orderRadius,
    );
    if (geofence.error) {
      setExpandedSection('ordering');
      actionFailed(geofence.error === 'coordinates'
        ? copy(
          'ละติจูดหรือลองจิจูดไม่ถูกต้อง',
          'The latitude or longitude is invalid',
        )
        : copy(
          'รัศมีรับออเดอร์ต้องอยู่ระหว่าง 20 ถึง 5,000 เมตร',
          'The order radius must be between 20 and 5,000 meters',
        ));
      return;
    }

    setSaving(true);
    try {
      await updateRestaurant(restaurantId, {
        name: name.trim(),
        branch_name: branch.trim(),
        restaurant_type: type,
        address: address.trim(),
        phone: phone.trim(),
        logo: logo.trim(),
        cover_image: coverImage.trim(),
        open_time: openTime.trim(),
        close_time: closeTime.trim(),
        table_count: toInt(tableCount, 0),
        service_charge_enabled: serviceEnabled === 'yes',
        service_charge_rate: toFloat(serviceRate, 0),
        vat_enabled: vatEnabled === 'yes',
        vat_rate: toFloat(vatRate, 0),
        promptpay_name: promptpayName.trim(),
        promptpay_qr_image: promptpayQr.trim(),
        ...geofence.value,
      });
      await refreshMemberships();
      showToast({ title: copy('บันทึกข้อมูลร้านแล้ว', 'Restaurant information saved') });
    } catch (err) {
      actionFailed(err instanceof Error
        ? err.message
        : copy('บันทึกร้านไม่สำเร็จ', 'Could not save restaurant information'));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!restaurantId || !isOwner || saving) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setSaving(true);
    try {
      await deleteRestaurant(restaurantId);
      await refreshMemberships();
      router.replace('/restaurants');
    } catch (err) {
      actionFailed(err instanceof Error
        ? err.message
        : copy('ลบร้านไม่สำเร็จ', 'Could not delete the restaurant'));
      setSaving(false);
    }
  }

  if (!canManageRestaurant) {
    return (
      <AppScreen title={copy('ข้อมูลร้าน', 'Restaurant information')} topLevel={false}>
        <Feedback
          title={copy(
            'ไม่มีสิทธิ์แก้ไขข้อมูลร้าน',
            'You do not have permission to edit restaurant information',
          )}
          detail={copy(
            'หน้านี้สำหรับเจ้าของร้านหรือผู้จัดการที่ได้รับสิทธิ์จัดการทีม',
            'This page is for owners or managers who have team-management permission.',
          )}
          tone="warning"
        />
      </AppScreen>
    );
  }

  return (
    <AppScreen
      title={copy('ข้อมูลร้าน', 'Restaurant information')}
      subtitle={copy('ใช้กับออเดอร์ บิล และ QR', 'Used for orders, bills and QR ordering')}
      topLevel={false}
      footer={!tabletWorkspace && !confirmDelete ? (
        <ActionDock>
          <Button icon="checkmark" label={copy('บันทึกข้อมูลร้าน', 'Save restaurant')} onPress={save} loading={saving} />
        </ActionDock>
      ) : undefined}
    >
      {error ? (
        <Feedback
          title={copy('โหลดข้อมูลร้านไม่สำเร็จ', 'Could not load restaurant information')}
          detail={error}
          tone="danger"
        />
      ) : null}
      {loading ? (
        <Feedback
          title={copy('กำลังโหลดข้อมูลร้าน', 'Loading restaurant information')}
          tone="info"
        />
      ) : null}

      <View style={{ flexDirection: tabletWorkspace ? 'row' : 'column', alignItems: 'flex-start', gap: spacing.lg }}>
        <View style={{ width: tabletWorkspace ? undefined : '100%', minWidth: 0, flex: tabletWorkspace ? 1 : undefined, gap: spacing.lg }}>
      <SettingsSection
        title={copy('ข้อมูลทั่วไป', 'General information')}
        icon="storefront-outline"
        {...sectionProps('general')}
      >
        <TextField
          label={copy('ชื่อร้าน', 'Restaurant name')}
          value={name}
          onChangeText={setName}
          maxLength={120}
        />
        <TextField
          label={copy('สาขา', 'Branch')}
          value={branch}
          onChangeText={setBranch}
          maxLength={120}
        />
        <ChipGroup
          label={copy('ประเภทร้าน', 'Restaurant type')}
          value={type}
          onChange={setType}
          options={restaurantTypeOptions(language, type)}
        />
        <TextField
          label={copy('ที่อยู่', 'Address')}
          value={address}
          onChangeText={setAddress}
          multiline
          maxLength={500}
        />
        <TextField
          label={copy('เบอร์โทรร้าน', 'Restaurant phone')}
          value={phone}
          onChangeText={setPhone}
          keyboardType="phone-pad"
          maxLength={40}
        />
        <TextField
          label={copy('ลิงก์โลโก้', 'Logo URL')}
          value={logo}
          onChangeText={setLogo}
        />
        <TextField
          label={copy('ลิงก์ภาพปกร้าน', 'Cover image URL')}
          value={coverImage}
          onChangeText={setCoverImage}
        />
      </SettingsSection>

      <SettingsSection
        title={copy('เวลาและโต๊ะ', 'Hours and tables')}
        icon="time-outline"
        {...sectionProps('hours')}
      >
        <View style={{ flexDirection: 'row', gap: spacing.md }}>
          <View style={{ flex: 1 }}>
            <TextField
              label={copy('เวลาเปิด', 'Opening time')}
              value={openTime}
              onChangeText={setOpenTime}
              placeholder="09:00"
            />
          </View>
          <View style={{ flex: 1 }}>
            <TextField
              label={copy('เวลาปิด', 'Closing time')}
              value={closeTime}
              onChangeText={setCloseTime}
              placeholder="22:00"
            />
          </View>
        </View>
        <TextField
          label={copy('จำนวนโต๊ะตั้งต้น', 'Initial table count')}
          value={tableCount}
          onChangeText={setTableCount}
          keyboardType="number-pad"
        />
      </SettingsSection>

      <SettingsSection
        title={copy('QR สั่งอาหารในร้าน', 'In-store QR ordering')}
        detail={copy('จำกัดการส่งออเดอร์ให้อยู่ใกล้ร้าน', 'Limit customer orders to the restaurant area.')}
        icon="qr-code-outline"
        {...sectionProps('ordering')}
      >
        <ChipGroup
          label={copy('ตรวจตำแหน่งลูกค้า', 'Check customer location')}
          value={geofenceEnabled}
          onChange={setGeofenceEnabled}
          options={[
            { label: copy('ไม่ตรวจตำแหน่ง', 'Do not check'), value: 'no' },
            { label: copy('ตรวจตำแหน่ง', 'Check location'), value: 'yes' },
          ]}
        />
        {geofenceEnabled === 'yes' ? (
          <>
            <View style={{ flexDirection: 'row', gap: spacing.md }}>
              <View style={{ flex: 1 }}>
                <TextField
                  label={copy('ละติจูด', 'Latitude')}
                  value={latitude}
                  onChangeText={setLatitude}
                  keyboardType="decimal-pad"
                  placeholder="13.736717"
                />
              </View>
              <View style={{ flex: 1 }}>
                <TextField
                  label={copy('ลองจิจูด', 'Longitude')}
                  value={longitude}
                  onChangeText={setLongitude}
                  keyboardType="decimal-pad"
                  placeholder="100.523186"
                />
              </View>
            </View>
            <TextField
              label={copy('รัศมีรับออเดอร์ (เมตร)', 'Order radius (meters)')}
              value={orderRadius}
              onChangeText={setOrderRadius}
              keyboardType="number-pad"
            />
          </>
        ) : null}
      </SettingsSection>
        </View>

        <View style={{ width: tabletWorkspace ? undefined : '100%', minWidth: 0, flex: tabletWorkspace ? 1 : undefined, gap: spacing.lg }}>

      <SettingsSection
        title={copy('ค่าบริการและ VAT', 'Service charge and VAT')}
        detail={copy('อัตราจะถูกบันทึกกับบิลเมื่อรับชำระ', 'Rates are saved with the bill when payment is taken.')}
        icon="receipt-outline"
        {...sectionProps('billing')}
      >
        <ChipGroup
          label={copy('ค่าบริการ', 'Service charge')}
          value={serviceEnabled}
          onChange={setServiceEnabled}
          options={[
            { label: copy('ไม่คิด', 'Off'), value: 'no' },
            { label: copy('คิดค่าบริการ', 'Charge service fee'), value: 'yes' },
          ]}
        />
        {serviceEnabled === 'yes' ? (
          <TextField
            label={copy('อัตราค่าบริการ %', 'Service charge rate %')}
            value={serviceRate}
            onChangeText={setServiceRate}
            keyboardType="decimal-pad"
          />
        ) : null}
        <ChipGroup
          label={copy('VAT', 'VAT')}
          value={vatEnabled}
          onChange={setVatEnabled}
          options={[
            { label: copy('ไม่คิด', 'Off'), value: 'no' },
            { label: copy('คิด VAT', 'Charge VAT'), value: 'yes' },
          ]}
        />
        {vatEnabled === 'yes' ? (
          <TextField
            label={copy('อัตรา VAT %', 'VAT rate %')}
            value={vatRate}
            onChangeText={setVatRate}
            keyboardType="decimal-pad"
          />
        ) : null}
      </SettingsSection>

      <SettingsSection
        title={copy('PromptPay', 'PromptPay')}
        icon="wallet-outline"
        {...sectionProps('promptpay')}
      >
        <TextField
          label={copy('ชื่อบัญชี', 'Account name')}
          value={promptpayName}
          onChangeText={setPromptpayName}
        />
        <TextField
          label={copy('ลิงก์รูป QR PromptPay', 'PromptPay QR image URL')}
          value={promptpayQr}
          onChangeText={setPromptpayQr}
        />
      </SettingsSection>

      {tabletWorkspace ? <Surface>
        <Button
          icon="checkmark"
          label={copy('บันทึกข้อมูลร้าน', 'Save restaurant information')}
          onPress={save}
          loading={saving}
        />
      </Surface> : null}

      {isOwner ? (
        <Surface style={{ borderColor: confirmDelete ? palette.danger : palette.border }}>
          <SectionHeader
            title={copy('ลบร้าน', 'Delete restaurant')}
            detail={confirmDelete
              ? copy(
                'แตะยืนยันอีกครั้ง การลบร้านมีผลกับสมาชิกและข้อมูลทั้งหมด',
                'Tap confirm again. Deleting the restaurant affects every member and all restaurant data.',
              )
              : copy(
                'ใช้เมื่อไม่ต้องการร้านนี้ในระบบอีกต่อไป',
                'Use this only when you no longer need this restaurant in Dishy.',
              )}
          />
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            {confirmDelete ? (
              <Button
                variant="secondary"
                label={copy('ยกเลิก', 'Cancel')}
                onPress={() => setConfirmDelete(false)}
                style={{ flex: 1 }}
              />
            ) : null}
            <Button
              variant={confirmDelete ? 'danger' : 'secondary'}
              label={confirmDelete
                ? copy('ยืนยันลบร้าน', 'Confirm deletion')
                : copy('ลบร้าน', 'Delete restaurant')}
              onPress={remove}
              loading={saving}
              style={{ flex: 1 }}
            />
          </View>
        </Surface>
      ) : null}
        </View>
      </View>
    </AppScreen>
  );
}
