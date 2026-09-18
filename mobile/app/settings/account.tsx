import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { useWindowDimensions, View } from 'react-native';

import { updateProfile } from '@/src/api/auth';
import { AppIcon } from '@/src/components/app-icon';
import { AppScreen } from '@/src/components/app-shell';
import { AppText as Text } from '@/src/components/app-text';
import { Field, FieldRow, FORM_MAX_WIDTH, FormBody, FormCard, SaveDock } from '@/src/components/form/parts';
import { Button } from '@/src/components/ui';
import { memberInitials, userDisplayName } from '@/src/lib/staff-workflow';
import { useAuth } from '@/src/providers/auth-provider';
import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';
import { useToast } from '@/src/providers/toast-provider';
import { breakpoints, palette, spacing } from '@/src/theme';

// My account, redrawn on 15 ก.ย. 2569: who is being edited sits at the top as
// a circle of initials with the name and email under it, the fields live in
// one card, and the sign-in card says where the password lives.

export default function AccountSettingsScreen() {
  const { width } = useWindowDimensions();
  const { user, refreshProfile } = useAuth();
  const { copy, language } = useDisplayPreferences();
  const tablet = width >= breakpoints.tabletWorkspace;
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [nickname, setNickname] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  // Nothing on this form loads on its own, so every message is the outcome of
  // pressing Save — a toast (14 ก.ย.).
  const { showToast } = useToast();
  const setError = (detail: string) => showToast({ tone: 'error', title: copy('บันทึกไม่ได้', 'Unable to save'), message: detail });

  useEffect(() => {
    setFirstName(user?.first_name || '');
    setLastName(user?.last_name || '');
    setNickname(user?.nickname || '');
    setPhone(user?.phone || '');
  }, [user]);

  async function save() {
    if (!firstName.trim() || !lastName.trim()) {
      setError(copy(
        'กรอกชื่อและนามสกุลให้ครบ',
        'Enter both your first and last name',
      ));
      return;
    }
    setSaving(true);
    try {
      await updateProfile({
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        nickname: nickname.trim(),
        phone: phone.trim(),
      });
      await refreshProfile();
      showToast({ title: copy('บันทึกข้อมูลบัญชีแล้ว', 'Account information saved') });
    } catch (err) {
      setError(err instanceof Error
        ? err.message
        : copy('บันทึกบัญชีไม่สำเร็จ', 'Could not save account information'));
    } finally {
      setSaving(false);
    }
  }

  const name = userDisplayName(user, language);
  const google = user?.auth_provider === 'google';

  return (
    <AppScreen
      title={copy('บัญชีของฉัน', 'My account')}
      topLevel={false}
      centerTitle
      contentMaxWidth={tablet ? FORM_MAX_WIDTH : undefined}
      footer={!tablet ? <SaveDock label={copy('บันทึกบัญชี', 'Save account')} onPress={save} loading={saving} /> : undefined}
    >
      <View style={{ gap: spacing.lg }}>
        <View style={{ alignItems: 'center', gap: 6, paddingTop: 4 }}>
          <LinearGradient colors={[palette.primary, '#EF7A35']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 20, lineHeight: 28, fontWeight: '600', color: '#fff' }}>{memberInitials(name)}</Text>
          </LinearGradient>
          <View style={{ alignItems: 'center' }}>
            <Text numberOfLines={1} style={{ fontSize: 16, fontWeight: '700', color: palette.textStrong }}>{name}</Text>
            {user?.email ? <Text numberOfLines={1} style={{ fontSize: 12.5, color: palette.placeholder }}>{user.email}</Text> : null}
          </View>
        </View>

        <FormCard title={copy('ข้อมูลส่วนตัว', 'Personal information')} detail={copy('ชื่อที่ทีมและใบเสร็จเห็น', 'The name your team and receipts show')}>
          <FormBody>
            <FieldRow>
              <Field grow label={copy('ชื่อ', 'First name')} value={firstName} onChangeText={setFirstName} icon="person-outline" maxLength={100} autoCapitalize="words" />
              <Field grow label={copy('นามสกุล', 'Last name')} value={lastName} onChangeText={setLastName} maxLength={100} autoCapitalize="words" />
            </FieldRow>
            <Field label={copy('ชื่อเล่นในร้าน', 'Nickname in the shop')} value={nickname} onChangeText={setNickname} icon="id-card-outline" maxLength={100} placeholder={copy('ไม่ได้ตั้ง · ใช้ชื่อจริง', 'Not set · your real name is used')} />
            <Field label={copy('เบอร์โทร', 'Phone number')} value={phone} onChangeText={setPhone} keyboardType="phone-pad" icon="call-outline" maxLength={40} placeholder="08x-xxx-xxxx" />
            {tablet ? <Button icon="checkmark" label={copy('บันทึกบัญชี', 'Save account')} onPress={save} loading={saving} /> : null}
          </FormBody>
        </FormCard>

        <FormCard title={copy('การเข้าสู่ระบบ', 'Sign-in')}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingTop: 4, paddingBottom: 14 }}>
            <View style={{ width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.divider }}>
              <AppIcon name={google ? 'logo-google' : 'lock-closed-outline'} size={19} color={google ? '#4285F4' : palette.primaryInk} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={{ fontSize: 14.5, fontWeight: '600', color: palette.textStrong }}>{google ? copy('เข้าด้วย Google', 'Signed in with Google') : copy('อีเมลและรหัสผ่าน', 'Email and password')}</Text>
              <Text numberOfLines={1} style={{ fontSize: 12, color: palette.placeholder }}>
                {google ? copy(`${user?.email ?? ''} · เปลี่ยนรหัสผ่านที่ Google`, `${user?.email ?? ''} · password managed by Google`) : user?.email ?? ''}
              </Text>
            </View>
          </View>
        </FormCard>
      </View>
    </AppScreen>
  );
}
