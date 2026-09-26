import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, useWindowDimensions, View } from 'react-native';

import { deleteRestaurant, getRestaurant, updateRestaurant } from '@/src/api/restaurant';
import { AppIcon, type AppIconName } from '@/src/components/app-icon';
import { AppScreen } from '@/src/components/app-shell';
import { AppText as Text } from '@/src/components/app-text';
import { ChoiceChips, DangerAction, Field, FieldRow, FormBody, FormCard, Note, SaveDock, SwitchRow } from '@/src/components/form/parts';
import { HeadingAction } from '@/src/components/heading-action';
import { Bone, ContentReveal, SkeletonReveal } from '@/src/components/skeleton';
import { Feedback } from '@/src/components/ui';
import { apiFailureDetail } from '@/src/lib/api-failure';
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

// Restaurant information, redrawn on 15 ก.ย. 2569. Twenty fields had run down
// one page in five fold-out sections, so finding the VAT rate meant scrolling
// and guessing. Now the five sections are chips under the title (a list down
// the left on a tablet) and one section shows at a time as a card; on/off
// choices are switches, numbers carry their unit, and Save writes every
// section whichever is open.

type Section = 'general' | 'hours' | 'ordering' | 'billing' | 'promptpay';

export default function RestaurantSettingsScreen() {
  const { width } = useWindowDimensions();
  const { activeMembership, refreshMemberships } = useAuth();
  const { copy, language } = useDisplayPreferences();
  const restaurantId = activeMembership?.restaurant_id;
  const canManageRestaurant = can(activeMembership, 'manage_restaurant_settings');
  const isOwner = activeMembership?.role?.name === 'owner';
  const tablet = width >= breakpoints.tabletWorkspace;

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
  const [serviceEnabled, setServiceEnabled] = useState(false);
  const [serviceRate, setServiceRate] = useState('10');
  const [vatEnabled, setVatEnabled] = useState(false);
  const [vatRate, setVatRate] = useState('7');
  const [promptpayName, setPromptpayName] = useState('');
  const [promptpayQr, setPromptpayQr] = useState('');
  const [geofenceEnabled, setGeofenceEnabled] = useState(false);
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [orderRadius, setOrderRadius] = useState('150');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{ detail?: string } | null>(null);
  // `error` is the restaurant failing to load. Save and delete report through a
  // toast (14 ก.ย.) — the form is long, and a bar at the top of it was out of
  // sight of the Save button that raised it.
  const { showToast } = useToast();
  const actionFailed = (detail: string) => showToast({ tone: 'error', title: copy('ทำรายการไม่ได้', 'Unable to complete action'), message: detail });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [section, setSection] = useState<Section>('general');

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
        setServiceEnabled(Boolean(restaurant.service_charge_enabled));
        setServiceRate(String(restaurant.service_charge_rate || 0));
        setVatEnabled(Boolean(restaurant.vat_enabled));
        setVatRate(String(restaurant.vat_rate || 0));
        setPromptpayName(restaurant.promptpay_name || '');
        setPromptpayQr(restaurant.promptpay_qr_image || '');
        const hasGeofence = Boolean(
          restaurant.order_radius_meters
          && restaurant.latitude != null
          && restaurant.longitude != null,
        );
        setGeofenceEnabled(hasGeofence);
        setLatitude(restaurant.latitude != null ? String(restaurant.latitude) : '');
        setLongitude(restaurant.longitude != null ? String(restaurant.longitude) : '');
        setOrderRadius(restaurant.order_radius_meters
          ? String(restaurant.order_radius_meters)
          : '150');
      })
      .catch((err) => setError({ detail: apiFailureDetail(err, language) }))
      .finally(() => setLoading(false));
  }, [canManageRestaurant, language, restaurantId]);

  async function save() {
    if (!restaurantId || !canManageRestaurant || saving) return;
    if (!name.trim() || !branch.trim()) {
      setSection('general');
      actionFailed(copy(
        'กรอกชื่อร้านและชื่อสาขาให้ครบ',
        'Enter both the restaurant and branch names',
      ));
      return;
    }
    const geofence = parseGeofenceSettings(geofenceEnabled, latitude, longitude, orderRadius);
    if (geofence.error) {
      setSection('ordering');
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
        service_charge_enabled: serviceEnabled,
        service_charge_rate: toFloat(serviceRate, 0),
        vat_enabled: vatEnabled,
        vat_rate: toFloat(vatRate, 0),
        promptpay_name: promptpayName.trim(),
        promptpay_qr_image: promptpayQr.trim(),
        ...geofence.value,
      });
      await refreshMemberships();
      showToast({ title: copy('บันทึกข้อมูลร้านแล้ว', 'Restaurant information saved') });
    } catch (err) {
      showToast({ tone: 'error', title: copy('บันทึกร้านไม่สำเร็จ', 'Could not save restaurant information'), message: apiFailureDetail(err, language) });
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!restaurantId || !isOwner || saving) return;
    setSaving(true);
    try {
      await deleteRestaurant(restaurantId);
      await refreshMemberships();
      router.replace('/restaurants');
    } catch (err) {
      showToast({ tone: 'error', title: copy('ลบร้านไม่สำเร็จ', 'Could not delete the restaurant'), message: apiFailureDetail(err, language) });
      setSaving(false);
    }
  }

  const title = copy('ข้อมูลร้าน', 'Restaurant');

  if (!canManageRestaurant) {
    return (
      <AppScreen title={title} topLevel={false} centerTitle>
        <Feedback
          title={copy('ไม่มีสิทธิ์แก้ไขข้อมูลร้าน', 'You do not have permission to edit restaurant information')}
          detail={copy('หน้านี้สำหรับเจ้าของร้านหรือผู้จัดการที่ได้รับสิทธิ์จัดการทีม', 'This page is for owners or managers who have team-management permission.')}
          tone="warning"
        />
      </AppScreen>
    );
  }

  // ---------------------------------------------------------------- sections

  const percent = (value: number) => `${Number(value).toLocaleString(language === 'th' ? 'th-TH' : 'en-US')}%`;
  const sections: { key: Section; icon: AppIconName; label: string; summary: string }[] = [
    { key: 'general', icon: 'storefront-outline', label: copy('ทั่วไป', 'General'), summary: name.trim() || copy('ยังไม่ตั้งชื่อ', 'No name yet') },
    { key: 'hours', icon: 'time-outline', label: copy('เวลาและโต๊ะ', 'Hours & tables'), summary: `${openTime}–${closeTime}` },
    { key: 'ordering', icon: 'qr-code-outline', label: copy('QR สั่งอาหาร', 'QR ordering'), summary: geofenceEnabled ? copy('ตรวจตำแหน่ง', 'Location checked') : copy('ไม่ตรวจตำแหน่ง', 'No location check') },
    { key: 'billing', icon: 'receipt-outline', label: copy('ค่าบริการ · VAT', 'Service · VAT'), summary: [serviceEnabled ? copy(`ค่าบริการ ${percent(toFloat(serviceRate, 0))}`, `Service ${percent(toFloat(serviceRate, 0))}`) : null, vatEnabled ? `VAT ${percent(toFloat(vatRate, 0))}` : null].filter(Boolean).join(' · ') || copy('ไม่คิด', 'Off') },
    { key: 'promptpay', icon: 'wallet-outline', label: 'PromptPay', summary: promptpayName.trim() || copy('ยังไม่ตั้ง', 'Not set') },
  ];

  const generalCard = (
    <FormCard icon="storefront-outline" title={copy('ข้อมูลทั่วไป', 'General')} detail={copy('ชื่อที่ขึ้นบนบิลและ QR', 'The name on bills and the ordering QR')}>
      <FormBody>
        {tablet ? (
          <FieldRow>
            <Field grow label={copy('ชื่อร้าน', 'Restaurant name')} value={name} onChangeText={setName} maxLength={120} />
            <Field grow label={copy('สาขา', 'Branch')} value={branch} onChangeText={setBranch} maxLength={120} />
          </FieldRow>
        ) : (
          <>
            <Field label={copy('ชื่อร้าน', 'Restaurant name')} value={name} onChangeText={setName} maxLength={120} />
            <Field label={copy('สาขา', 'Branch')} value={branch} onChangeText={setBranch} maxLength={120} />
          </>
        )}
        <View style={{ gap: 6 }}>
          <Text style={{ fontSize: 12.5, fontWeight: '600', color: palette.muted }}>{copy('ประเภทร้าน', 'Restaurant type')}</Text>
          <ChoiceChips options={restaurantTypeOptions(language, type).map((option) => ({ key: option.value, label: option.label }))} value={type} onChange={setType} />
        </View>
        <Field label={copy('ที่อยู่', 'Address')} value={address} onChangeText={setAddress} multiline maxLength={500} icon="location-outline" placeholder={copy('ยังไม่กรอก', 'Not filled in')} />
        <Field label={copy('เบอร์โทรร้าน', 'Restaurant phone')} value={phone} onChangeText={setPhone} keyboardType="phone-pad" maxLength={40} icon="call-outline" />
        <Field label={copy('ลิงก์โลโก้', 'Logo URL')} value={logo} onChangeText={setLogo} icon="image-outline" keyboardType="url" autoCapitalize="none" placeholder="https://" />
        <Field label={copy('ลิงก์ภาพปกร้าน', 'Cover image URL')} value={coverImage} onChangeText={setCoverImage} icon="image-outline" keyboardType="url" autoCapitalize="none" placeholder="https://" />
      </FormBody>
    </FormCard>
  );
  const hoursCard = (
    <FormCard icon="time-outline" title={copy('เวลาและโต๊ะ', 'Hours and tables')}>
      <FormBody>
        <FieldRow>
          <Field grow label={copy('เวลาเปิด', 'Opens')} value={openTime} onChangeText={setOpenTime} placeholder="09:00" keyboardType="numbers-and-punctuation" />
          <Field grow label={copy('เวลาปิด', 'Closes')} value={closeTime} onChangeText={setCloseTime} placeholder="22:00" keyboardType="numbers-and-punctuation" />
        </FieldRow>
        <Field label={copy('จำนวนโต๊ะตั้งต้น', 'Starting table count')} value={tableCount} onChangeText={setTableCount} keyboardType="number-pad" unit={copy('โต๊ะ', 'tables')} />
      </FormBody>
    </FormCard>
  );
  const orderingCard = (
    <FormCard icon="qr-code-outline" title={copy('QR สั่งอาหารในร้าน', 'In-store QR ordering')} detail={copy('ลูกค้าสแกนที่โต๊ะแล้วสั่งเอง', 'Customers scan at the table and order')}>
      <SwitchRow first title={copy('ตรวจตำแหน่งลูกค้า', 'Check customer location')} detail={copy('รับออเดอร์เฉพาะคนที่อยู่ใกล้ร้าน', 'Only take orders from near the shop')} value={geofenceEnabled} onChange={setGeofenceEnabled} />
      {geofenceEnabled ? (
        <FormBody style={{ paddingTop: 4 }}>
          <FieldRow>
            <Field grow label={copy('ละติจูด', 'Latitude')} value={latitude} onChangeText={setLatitude} keyboardType="decimal-pad" placeholder="13.736717" />
            <Field grow label={copy('ลองจิจูด', 'Longitude')} value={longitude} onChangeText={setLongitude} keyboardType="decimal-pad" placeholder="100.523186" />
          </FieldRow>
          <Field label={copy('รัศมีรับออเดอร์', 'Order radius')} value={orderRadius} onChangeText={setOrderRadius} keyboardType="number-pad" unit={copy('เมตร', 'm')} />
        </FormBody>
      ) : null}
    </FormCard>
  );
  const billingCard = (
    <FormCard icon="receipt-outline" title={copy('ค่าบริการและ VAT', 'Service charge and VAT')} detail={copy('คิดท้ายบิลอัตโนมัติ · บันทึกกับบิลตอนรับเงิน', 'Added at the end of the bill · saved with it at payment')}>
      <SwitchRow first title={copy('ค่าบริการ', 'Service charge')} detail={serviceEnabled ? copy(`คิด ${percent(toFloat(serviceRate, 0))}`, `Charging ${percent(toFloat(serviceRate, 0))}`) : copy('ไม่คิด', 'Off')} value={serviceEnabled} onChange={setServiceEnabled} />
      {serviceEnabled ? (
        <FormBody style={{ paddingTop: 0, paddingBottom: 10 }}>
          <Field label={copy('อัตราค่าบริการ', 'Service charge rate')} value={serviceRate} onChangeText={setServiceRate} keyboardType="decimal-pad" unit="%" />
        </FormBody>
      ) : null}
      <SwitchRow title="VAT" detail={vatEnabled ? copy(`คิด ${percent(toFloat(vatRate, 0))}`, `Charging ${percent(toFloat(vatRate, 0))}`) : copy('ไม่คิด', 'Off')} value={vatEnabled} onChange={setVatEnabled} />
      {vatEnabled ? (
        <FormBody style={{ paddingTop: 0 }}>
          <Field label={copy('อัตรา VAT', 'VAT rate')} value={vatRate} onChangeText={setVatRate} keyboardType="decimal-pad" unit="%" />
        </FormBody>
      ) : null}
    </FormCard>
  );
  const promptpayCard = (
    <FormCard icon="wallet-outline" title="PromptPay" detail={copy('ขึ้นบนบิลให้ลูกค้าสแกนจ่าย', 'Shown on the bill for customers to scan and pay')}>
      <FormBody>
        <Field label={copy('ชื่อบัญชี', 'Account name')} value={promptpayName} onChangeText={setPromptpayName} icon="person-outline" placeholder={copy('ชื่อที่ขึ้นตอนสแกน', 'The name shown when scanned')} />
        <Field label={copy('ลิงก์รูป QR PromptPay', 'PromptPay QR image URL')} value={promptpayQr} onChangeText={setPromptpayQr} icon="qr-code-outline" keyboardType="url" autoCapitalize="none" placeholder="https://" />
      </FormBody>
    </FormCard>
  );
  const cards: Record<Section, React.ReactNode> = { general: generalCard, hours: hoursCard, ordering: orderingCard, billing: billingCard, promptpay: promptpayCard };

  const deleteBlock = isOwner ? (
    <DangerAction
      icon="trash-outline"
      label={copy('ลบร้านนี้ออกจาก Dishy', 'Delete this restaurant from Dishy')}
      confirmLabel={copy('ยืนยันลบร้าน', 'Confirm deletion')}
      cancelLabel={copy('เก็บร้านไว้', 'Keep it')}
      message={copy('ร้านและข้อมูลทั้งหมด (เมนู ออเดอร์ สมาชิก) จะหายไป ทีมทุกคนจะเข้าร้านนี้ไม่ได้อีก', 'The restaurant and everything in it (menu, orders, members) will be gone, and nobody on the team can open it again')}
      open={confirmDelete}
      onOpen={() => setConfirmDelete(true)}
      onCancel={() => setConfirmDelete(false)}
      onConfirm={remove}
      loading={saving}
    />
  ) : null;

  const skeleton = (
    <SkeletonReveal label={copy('กำลังโหลดข้อมูลร้าน', 'Loading restaurant information')} style={{ gap: spacing.md }}>
      <Bone height={34} radius={999} />
      <Bone height={420} radius={18} />
    </SkeletonReveal>
  );

  return (
    <AppScreen
      title={title}
      topLevel={false}
      centerTitle
      contentMaxWidth={tablet ? 1180 : undefined}
      action={tablet ? <HeadingAction compact={false} icon="checkmark" label={copy('บันทึกข้อมูลร้าน', 'Save restaurant')} onPress={save} /> : undefined}
      footer={!tablet && !confirmDelete && !loading ? <SaveDock label={copy('บันทึกข้อมูลร้าน', 'Save restaurant')} onPress={save} loading={saving} /> : undefined}
    >
      {error ? <Feedback title={copy('โหลดข้อมูลร้านไม่สำเร็จ', 'Could not load restaurant information')} detail={error.detail} tone="danger" /> : null}
      {loading ? skeleton : tablet ? (
        <ContentReveal style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xl }}>
          <View style={{ width: 240, gap: 4 }}>
            {sections.map((item) => {
              const on = item.key === section;
              return (
                <Pressable key={item.key} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => setSection(item.key)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, backgroundColor: on ? palette.surfaceSubtle : pressed ? '#FAF7F4' : 'transparent' })}>
                  <AppIcon name={item.icon} size={18} color={on ? palette.primaryInk : palette.placeholder} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text numberOfLines={1} style={{ fontSize: 14, fontWeight: '600', color: on ? palette.primaryInk : palette.text }}>{item.label}</Text>
                    <Text numberOfLines={1} style={{ fontSize: 11.5, color: palette.placeholder }}>{item.summary}</Text>
                  </View>
                </Pressable>
              );
            })}
            <View style={{ paddingTop: spacing.lg }}>{deleteBlock}</View>
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: spacing.md }}>
            {cards[section]}
            {section === 'ordering' && !geofenceEnabled ? <Note text={copy('เปิดตรวจตำแหน่งแล้วใส่พิกัดร้านกับรัศมี ลูกค้าที่อยู่นอกรัศมีจะสั่งผ่าน QR ไม่ได้', 'Turn on the check and enter the shop coordinates and radius; customers outside it cannot order through the QR')} /> : null}
          </View>
        </ContentReveal>
      ) : (
        <ContentReveal style={{ gap: spacing.md }}>
          <ChoiceChips scroll options={sections.map((item) => ({ key: item.key, label: item.label, icon: item.icon }))} value={section} onChange={setSection} />
          {cards[section]}
          {section === 'promptpay' ? <View style={{ paddingTop: spacing.sm }}>{deleteBlock}</View> : null}
        </ContentReveal>
      )}
    </AppScreen>
  );
}
