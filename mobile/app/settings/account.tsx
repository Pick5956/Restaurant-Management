import { useEffect, useState } from 'react';
import { useWindowDimensions, View } from 'react-native';

import { updateProfile } from '@/src/api/auth';
import { AppScreen } from '@/src/components/app-shell';
import { ActionDock, Button, EdgeRow, EdgeSection, EdgeSectionHeader, TextField } from '@/src/components/ui';
import { useAuth } from '@/src/providers/auth-provider';
import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';
import { useToast } from '@/src/providers/toast-provider';
import { breakpoints, spacing } from '@/src/theme';

export default function AccountSettingsScreen() {
  const { width } = useWindowDimensions();
  const { user, refreshProfile } = useAuth();
  const { copy } = useDisplayPreferences();
  const tabletWorkspace = width >= breakpoints.tabletWorkspace;
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

  return (
    <AppScreen
      title={copy('บัญชีของฉัน', 'My account')}
      subtitle={user?.email || copy('ข้อมูลผู้ใช้งาน', 'User information')}
      topLevel={false}
      footer={!tabletWorkspace ? (
        <ActionDock>
          <Button
            icon="checkmark"
            label={copy('บันทึกบัญชี', 'Save account')}
            onPress={save}
            loading={saving}
          />
        </ActionDock>
      ) : undefined}
    >
      <View style={{ flexDirection: tabletWorkspace ? 'row' : 'column', alignItems: 'flex-start', gap: spacing.lg }}>
        <View style={{ width: tabletWorkspace ? undefined : '100%', minWidth: 0, flex: tabletWorkspace ? 1.45 : undefined, gap: spacing.sm }}>
          <EdgeSectionHeader title={copy('ข้อมูลส่วนตัว', 'Personal information')} />
          <EdgeSection style={{ gap: spacing.md, padding: spacing.lg }}>
          <View style={{ flexDirection: tabletWorkspace ? 'row' : 'column', gap: spacing.md }}>
            <View style={{ minWidth: 0, flex: 1 }}>
              <TextField label={copy('ชื่อ', 'First name')} value={firstName} onChangeText={setFirstName} icon="person-outline" maxLength={100} />
            </View>
            <View style={{ minWidth: 0, flex: 1 }}>
              <TextField label={copy('นามสกุล', 'Last name')} value={lastName} onChangeText={setLastName} maxLength={100} />
            </View>
          </View>
          <TextField label={copy('ชื่อเล่นในร้าน', 'Restaurant nickname')} value={nickname} onChangeText={setNickname} icon="id-card-outline" maxLength={100} />
          <TextField label={copy('เบอร์โทร', 'Phone number')} value={phone} onChangeText={setPhone} keyboardType="phone-pad" icon="call-outline" maxLength={40} />
          {tabletWorkspace ? (
            <Button icon="checkmark" label={copy('บันทึกบัญชี', 'Save account')} onPress={save} loading={saving} />
          ) : null}
          </EdgeSection>
        </View>
        <View style={{ width: tabletWorkspace ? undefined : '100%', minWidth: 0, flex: tabletWorkspace ? 0.8 : undefined, gap: spacing.sm }}>
          <EdgeSectionHeader title={copy('การเข้าสู่ระบบ', 'Sign-in')} />
          <EdgeSection>
            <EdgeRow
              detail={user?.auth_provider === 'google'
                ? copy('เชื่อมกับ Google', 'Connected to Google')
                : copy('ใช้อีเมลและรหัสผ่าน', 'Email and password')}
              icon={user?.auth_provider === 'google' ? 'logo-google' : 'lock-closed-outline'}
              title={copy('วิธีเข้าสู่ระบบ', 'Sign-in method')}
            />
          </EdgeSection>
        </View>
      </View>
    </AppScreen>
  );
}
