import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { LayoutAnimation, useWindowDimensions, View, type TextInput } from 'react-native';

import { createRestaurant } from '@/src/api/restaurant';
import { AuthScreen } from '@/src/components/auth-screen';
import { Field, SwitchRow } from '@/src/components/form/parts';
import { useReducedMotion } from '@/src/components/motion';
import { ContactDisclosure } from '@/src/components/restaurant-setup/contact-disclosure';
import { GroupCard, KitBlock, KitField, ZoneChips } from '@/src/components/table-plan/sheet-kit';
import { Button } from '@/src/components/ui';
import { timeOrDefault, toInt } from '@/src/lib/forms';
import {
  DEFAULT_TABLE_COUNT,
  contactSummary,
  firstSetupProblem,
  normalizeClockInput,
  restaurantSetupFailureCode,
  restaurantSetupFailureToast,
  setupFieldMessage,
  setupFieldProblems,
  setupProblemsForFailure,
  type SetupField,
  type SetupProblems,
} from '@/src/lib/restaurant-setup-form';
import {
  DEFAULT_RESTAURANT_TYPE,
  restaurantTypeOptions,
} from '@/src/lib/restaurant-types';
import { getDefaultWorkspaceRoute } from '@/src/lib/work-mode';
import { useAuth } from '@/src/providers/auth-provider';
import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';
import { useToast } from '@/src/providers/toast-provider';
import { spacing } from '@/src/theme';
import type { Membership } from '@/src/types/restaurant';

const OPEN_DEFAULT = '10:00';
const CLOSE_DEFAULT = '22:00';

export default function CreateRestaurantScreen() {
  const { width } = useWindowDimensions();
  const { refreshMemberships, setActiveRestaurantFromMembership, user } = useAuth();
  const { copy, language } = useDisplayPreferences();
  const { showToast } = useToast();
  const reducedMotion = useReducedMotion();
  const [name, setName] = useState('');
  const [branch, setBranch] = useState(() => copy('สำนักงานใหญ่', 'Head office'));
  const [type, setType] = useState<string>(DEFAULT_RESTAURANT_TYPE);
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [open, setOpen] = useState(OPEN_DEFAULT);
  const [close, setClose] = useState(CLOSE_DEFAULT);
  // The server turns 0 into 12 tables, so 0 was never what got made.
  const [tables, setTables] = useState(String(DEFAULT_TABLE_COUNT));
  const [splitZones, setSplitZones] = useState<'yes' | 'no'>('yes');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [problems, setProblems] = useState<SetupProblems>({});
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  // The shop, once the POST has made it. Opening it on this phone is a second
  // step that can fail on its own; a retry then opens the same shop instead of
  // creating a duplicate.
  const createdRef = useRef<Membership | null>(null);

  const nameRef = useRef<TextInput>(null);
  const branchRef = useRef<TextInput>(null);
  const phoneRef = useRef<TextInput>(null);
  const openRef = useRef<TextInput>(null);
  const closeRef = useRef<TextInput>(null);
  const tablesRef = useRef<TextInput>(null);
  const fieldRefs: Record<SetupField, { current: TextInput | null }> = {
    name: nameRef,
    phone: phoneRef,
    open: openRef,
    close: closeRef,
    tables: tablesRef,
  };
  // Focus lands after the render that shows the problem: the phone field does
  // not exist until its section has opened.
  const focusNext = useRef<SetupField | null>(null);
  useEffect(() => {
    const field = focusNext.current;
    if (!field) return;
    focusNext.current = null;
    fieldRefs[field].current?.focus();
  });

  useEffect(() => {
    setBranch((current) => (
      current === 'สำนักงานใหญ่' || current === 'Head office'
        ? copy('สำนักงานใหญ่', 'Head office')
        : current
    ));
  }, [copy]);

  const problem = (field: SetupField) => (problems[field] ? setupFieldMessage(field, language) : null);
  const clearProblem = (field: SetupField) => setProblems((current) => (
    current[field] ? { ...current, [field]: undefined } : current
  ));

  function toggleContact() {
    if (!reducedMotion) LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setDetailsOpen((current) => !current);
  }

  function showProblems(found: SetupProblems) {
    const first = firstSetupProblem(found);
    if (!first) return false;
    // A phone problem is never left inside a closed section.
    if (found.phone) setDetailsOpen(true);
    focusNext.current = first;
    return true;
  }

  async function submit() {
    if (!user) {
      router.replace('/login');
      return;
    }
    if (savingRef.current) return;
    // A tap on the button does not blur the field, so the typed time is read
    // here too: "9:00" goes as 09:00, not silently as the 10:00 default.
    const openClock = normalizeClockInput(open) || OPEN_DEFAULT;
    const closeClock = normalizeClockInput(close) || CLOSE_DEFAULT;
    setOpen(openClock);
    setClose(closeClock);
    const found = setupFieldProblems({ name, open: openClock, close: closeClock, tables, phone });
    setProblems(found);
    if (showProblems(found)) return;

    savingRef.current = true;
    setSaving(true);
    try {
      let membership = createdRef.current;
      if (!membership) {
        const response = await createRestaurant({
          name: name.trim(),
          branch_name: branch.trim() || copy('สำนักงานใหญ่', 'Head office'),
          restaurant_type: type,
          phone: phone.trim(),
          address: address.trim(),
          open_time: timeOrDefault(openClock, OPEN_DEFAULT),
          close_time: timeOrDefault(closeClock, CLOSE_DEFAULT),
          table_count: toInt(tables, 0),
          split_zones: splitZones === 'yes',
        });
        membership = response.membership;
        createdRef.current = membership;
      }
      await setActiveRestaurantFromMembership(membership);
      await refreshMemberships().catch(() => undefined);
      router.replace(getDefaultWorkspaceRoute(membership));
    } catch (err) {
      // The server's words are only classified here, never shown.
      const raw = err instanceof Error ? err.message : '';
      const created = createdRef.current !== null;
      if (!created) {
        const fromServer = setupProblemsForFailure(restaurantSetupFailureCode(raw));
        setProblems((current) => ({ ...current, ...fromServer }));
        showProblems(fromServer);
      }
      showToast({ tone: 'error', ...restaurantSetupFailureToast(raw, language, created ? 'open' : 'create') });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  const inRow = width >= 360;
  const cell = inRow ? { flex: 1, minWidth: 0 } : null;

  return (
    <AuthScreen
      title={copy('สร้างร้าน', 'Create restaurant')}
      showBack
    >
      <View style={{ gap: spacing.md }}>
        <GroupCard>
          <View style={{ gap: 12, padding: 14 }}>
            <KitField
              ref={nameRef}
              error={problem('name')}
              label={copy('ชื่อร้าน', 'Restaurant name')}
              maxLength={120}
              onChangeText={(text) => {
                setName(text);
                clearProblem('name');
              }}
              onSubmitEditing={() => branchRef.current?.focus()}
              returnKeyType="next"
              value={name}
            />
            <KitField
              ref={branchRef}
              label={copy('สาขา', 'Branch')}
              maxLength={120}
              onChangeText={setBranch}
              returnKeyType="done"
              value={branch}
            />
          </View>
          <KitBlock title={copy('ประเภทร้าน', 'Restaurant type')}>
            <ZoneChips
              onChange={setType}
              options={restaurantTypeOptions(language).map((option) => ({ key: option.value, label: option.label }))}
              value={type}
            />
          </KitBlock>
          <ContactDisclosure
            detail={detailsOpen ? null : contactSummary(phone, address) ?? copy('ไม่ระบุ', 'Not set')}
            icon="call-outline"
            onToggle={toggleContact}
            open={detailsOpen}
            title={copy('เบอร์โทรและที่อยู่', 'Phone and address')}
          />
          {detailsOpen ? (
            <View style={{ gap: 12, paddingHorizontal: 14, paddingTop: 2, paddingBottom: 14 }}>
              <KitField
                ref={phoneRef}
                error={problem('phone')}
                keyboardType="phone-pad"
                label={copy('เบอร์โทรร้าน', 'Restaurant phone')}
                maxLength={40}
                onChangeText={(text) => {
                  setPhone(text);
                  clearProblem('phone');
                }}
                value={phone}
              />
              <Field
                label={copy('ที่อยู่', 'Address')}
                maxLength={500}
                multiline
                onChangeText={setAddress}
                value={address}
              />
            </View>
          ) : null}
        </GroupCard>

        <GroupCard>
          <View style={{ flexDirection: inRow ? 'row' : 'column', gap: 10, padding: 14 }}>
            <View style={cell}>
              <KitField
                ref={openRef}
                error={problem('open')}
                keyboardType="number-pad"
                label={copy('เวลาเปิด', 'Opens')}
                maxLength={5}
                onBlur={() => setOpen((current) => normalizeClockInput(current) || OPEN_DEFAULT)}
                onChangeText={(text) => {
                  setOpen(text);
                  clearProblem('open');
                }}
                selectTextOnFocus
                value={open}
              />
            </View>
            <View style={cell}>
              <KitField
                ref={closeRef}
                error={problem('close')}
                keyboardType="number-pad"
                label={copy('เวลาปิด', 'Closes')}
                maxLength={5}
                onBlur={() => setClose((current) => normalizeClockInput(current) || CLOSE_DEFAULT)}
                onChangeText={(text) => {
                  setClose(text);
                  clearProblem('close');
                }}
                selectTextOnFocus
                value={close}
              />
            </View>
            <View style={cell}>
              <KitField
                ref={tablesRef}
                error={problem('tables')}
                keyboardType="number-pad"
                label={copy('จำนวนโต๊ะ', 'Tables')}
                maxLength={3}
                onBlur={() => setTables((current) => current.trim() || String(DEFAULT_TABLE_COUNT))}
                onChangeText={(text) => {
                  setTables(text);
                  clearProblem('tables');
                }}
                selectTextOnFocus
                value={tables}
              />
            </View>
          </View>
          <SwitchRow
            onChange={(on) => setSplitZones(on ? 'yes' : 'no')}
            title={copy('แบ่งตามโซนตัวอย่าง', 'Create sample zones')}
            value={splitZones === 'yes'}
          />
        </GroupCard>
      </View>

      <Button
        icon="arrow-forward"
        label={copy('สร้างร้าน', 'Create restaurant')}
        onPress={submit}
        loading={saving}
      />
    </AuthScreen>
  );
}
