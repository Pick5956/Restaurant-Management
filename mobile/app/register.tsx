import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, useWindowDimensions, View } from 'react-native';

import { register } from '@/src/api/auth';
import { AppIcon } from '@/src/components/app-icon';
import { AuthScreen } from '@/src/components/auth-screen';
import { AppText as Text } from '@/src/components/app-text';
import { Button, EmptyState, TextField } from '@/src/components/ui';
import { authFailureToast } from '@/src/lib/auth-error';
import {
  validateRegistrationInput,
  type RegistrationValidation,
} from '@/src/lib/auth-validation';
import {
  registerAndSignIn,
  registrationFallbackLoginRoute,
  registrationInviteRoute,
} from '@/src/lib/registration-flow';
import { invitationTokenFrom } from '@/src/lib/staff-workflow';
import { useAuth } from '@/src/providers/auth-provider';
import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';
import { useToast } from '@/src/providers/toast-provider';
import { palette, radius, spacing } from '@/src/theme';

type RegistrationError = Exclude<RegistrationValidation, { valid: true }>['error'];

type Copy = (thai: string, english: string) => string;

function validationMessage(error: RegistrationError, copy: Copy): string {
  if (error === 'missing_required') {
    return copy(
      'กรอกชื่อ นามสกุล อีเมล รหัสผ่าน และยืนยันรหัสผ่านให้ครบ',
      'Enter your first name, last name, email, password, and password confirmation',
    );
  }
  if (error === 'password_mismatch') {
    return copy(
      'รหัสผ่านและยืนยันรหัสผ่านไม่ตรงกัน',
      'The passwords do not match',
    );
  }
  if (error === 'too_short') {
    return copy(
      'รหัสผ่านต้องมีอย่างน้อย 8 ไบต์',
      'Your password must be at least 8 bytes',
    );
  }
  return copy(
    'รหัสผ่านต้องไม่เกิน 72 ไบต์',
    'Your password must be no more than 72 bytes',
  );
}

export default function RegisterScreen() {
  const { width } = useWindowDimensions();
  const { inviteToken: rawInviteToken } = useLocalSearchParams<{ inviteToken?: string }>();
  const inviteToken = invitationTokenFrom(rawInviteToken || '');
  const { signIn } = useAuth();
  const { copy, language } = useDisplayPreferences();
  const { showToast } = useToast();

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [nickname, setNickname] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  // Only the field error stays on the page - it belongs to the box it is
  // under. Everything else the form has to say is a toast (16 ก.ย. 2569).
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [accountCreated, setAccountCreated] = useState(false);
  const [optionalOpen, setOptionalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  function goToLogin() {
    router.replace(registrationFallbackLoginRoute(inviteToken) as never);
  }

  function updatePassword(value: string) {
    setPassword(value);
    setConfirmError(null);
  }

  function updateConfirmPassword(value: string) {
    setConfirmPassword(value);
    setConfirmError(null);
  }

  async function submit() {
    const validation = validateRegistrationInput({
      firstName,
      lastName,
      email,
      password,
      confirmPassword,
    });
    if (!validation.valid) {
      const detail = validationMessage(validation.error, copy);
      if (validation.error === 'password_mismatch') {
        setConfirmError(detail);
        return;
      }
      showToast({
        tone: 'error',
        title: copy('ตรวจสอบข้อมูลอีกครั้ง', 'Check your information'),
        message: detail,
      });
      return;
    }

    const registrationInput = {
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      nickname: nickname.trim(),
      email: email.trim(),
      phone: phone.trim(),
      password,
    };

    setSubmitting(true);
    setConfirmError(null);
    const result = await registerAndSignIn(registrationInput, {
      registerAccount: register,
      signIn,
    });
    setSubmitting(false);

    if (result.status === 'signed_in') {
      const invitationRoute = registrationInviteRoute(inviteToken);
      if (invitationRoute) {
        router.replace(invitationRoute as never);
      }
      return;
    }

    if (result.status === 'register_failed') {
      showToast({
        tone: 'error',
        ...authFailureToast(result.error instanceof Error ? result.error.message : '', 'register', language),
      });
      return;
    }

    // The account exists; only the automatic sign-in did not happen, so the
    // screen becomes the one thing left to do and says why.
    setAccountCreated(true);
    showToast({ title: copy('สร้างบัญชีแล้ว', 'Account created') });
  }

  return (
    <AuthScreen
      title={copy('สร้างบัญชี', 'Create an account')}
      subtitle={inviteToken
        ? copy(
          'สร้างบัญชีเพื่อเปิดคำเชิญนี้',
          'Create an account to open this invitation.',
        )
        : undefined}
      showBack
    >
      <View style={{ gap: spacing.xl }}>
        {accountCreated ? (
          <>
            <EmptyState
              title={copy('สร้างบัญชีแล้ว', 'Account created')}
              detail={copy(
                'เข้าสู่ระบบด้วยอีเมลและรหัสผ่านเดิมได้เลย ไม่ต้องสมัครซ้ำ',
                'Sign in with the same email and password; there is no need to register again.',
              )}
            />
            <Button
              icon="log-in-outline"
              label={copy('ไปหน้าเข้าสู่ระบบ', 'Go to sign in')}
              onPress={goToLogin}
            />
          </>
        ) : (
          <>
            <View style={{ flexDirection: width >= 360 ? 'row' : 'column', gap: spacing.md }}>
              <View style={{ flex: 1 }}>
                <TextField
                  icon="person-outline"
                  label={copy('ชื่อ', 'First name')}
                  autoComplete="given-name"
                  textContentType="givenName"
                  value={firstName}
                  onChangeText={setFirstName}
                  maxLength={100}
                />
              </View>
              <View style={{ flex: 1 }}>
                <TextField
                  icon="person-outline"
                  label={copy('นามสกุล', 'Last name')}
                  autoComplete="family-name"
                  textContentType="familyName"
                  value={lastName}
                  onChangeText={setLastName}
                  maxLength={100}
                />
              </View>
            </View>
            <TextField
              icon="mail-outline"
              label={copy('อีเมล', 'Email')}
              autoComplete="email"
              textContentType="emailAddress"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              placeholder="you@example.com"
            />
            <TextField
              icon="lock-closed-outline"
              label={copy('รหัสผ่าน', 'Password')}
              autoComplete="new-password"
              textContentType="newPassword"
              value={password}
              onChangeText={updatePassword}
              secureTextEntry
              revealLabel={copy('แสดง', 'Show')}
              hideLabel={copy('ซ่อน', 'Hide')}
            />
            <TextField
              icon="shield-checkmark-outline"
              label={copy('ยืนยันรหัสผ่าน', 'Confirm password')}
              autoComplete="new-password"
              textContentType="newPassword"
              value={confirmPassword}
              onChangeText={updateConfirmPassword}
              secureTextEntry
              revealLabel={copy('แสดง', 'Show')}
              hideLabel={copy('ซ่อน', 'Hide')}
              error={confirmError}
            />

            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: optionalOpen }}
              onPress={() => setOptionalOpen((current) => !current)}
              style={({ pressed }) => ({
                minHeight: 48,
                flexDirection: 'row',
                alignItems: 'center',
                gap: spacing.sm,
                borderWidth: 1,
                borderColor: palette.border,
                borderRadius: radius.md,
                backgroundColor: pressed ? palette.surfaceStrong : palette.surfaceSubtle,
                paddingHorizontal: spacing.md,
                opacity: pressed ? 0.72 : 1,
              })}
            >
              <AppIcon color={palette.muted} name="add-circle-outline" size={19} />
              <Text style={{ flex: 1, color: palette.text, fontSize: 13, fontWeight: '700' }}>
                {copy('เพิ่มชื่อเล่นหรือเบอร์โทร', 'Add nickname or phone')}
              </Text>
              <Text style={{ color: palette.muted, fontSize: 12 }}>
                {copy('ไม่บังคับ', 'Optional')}
              </Text>
              <AppIcon color={palette.muted} name={optionalOpen ? 'chevron-up' : 'chevron-down'} size={17} />
            </Pressable>

            {optionalOpen ? (
              <View style={{ gap: spacing.md }}>
                <TextField
                  icon="happy-outline"
                  label={copy('ชื่อเล่น', 'Nickname')}
                  value={nickname}
                  onChangeText={setNickname}
                  maxLength={100}
                />
                <TextField
                  icon="call-outline"
                  label={copy('เบอร์โทร', 'Phone number')}
                  autoComplete="tel"
                  textContentType="telephoneNumber"
                  value={phone}
                  onChangeText={setPhone}
                  keyboardType="phone-pad"
                  maxLength={40}
                />
              </View>
            ) : null}

            <Button
              icon="arrow-forward"
              label={copy('สร้างบัญชี', 'Create account')}
              onPress={submit}
              loading={submitting}
            />

            <View style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
              <Text style={{ color: palette.muted, fontSize: 13 }}>
                {copy('มีบัญชีแล้ว?', 'Already have an account?')}
              </Text>
              <Pressable
                accessibilityRole="link"
                disabled={submitting}
                hitSlop={10}
                onPress={goToLogin}
                style={({ pressed }) => ({
                  minHeight: 44,
                  minWidth: 44,
                  justifyContent: 'center',
                  opacity: submitting ? 0.42 : pressed ? 0.58 : 1,
                })}
              >
                <Text style={{ color: palette.textStrong, fontSize: 13, fontWeight: '800' }}>
                  {copy('เข้าสู่ระบบ', 'Sign in')}
                </Text>
              </Pressable>
            </View>
          </>
        )}
      </View>
    </AuthScreen>
  );
}
