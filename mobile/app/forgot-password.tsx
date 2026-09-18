import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { requestPasswordReset } from '@/src/api/auth';
import { AuthScreen } from '@/src/components/auth-screen';
import { Button, EmptyState, TextField } from '@/src/components/ui';
import { authFailureToast } from '@/src/lib/auth-error';
import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';
import { useToast } from '@/src/providers/toast-provider';
import { spacing } from '@/src/theme';

export default function ForgotPasswordScreen() {
  const { copy, language } = useDisplayPreferences();
  const { showToast } = useToast();
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [emailMissing, setEmailMissing] = useState(false);
  const [sent, setSent] = useState(false);

  async function submit() {
    if (!email.trim()) {
      setEmailMissing(true);
      return;
    }
    setSaving(true);
    try {
      await requestPasswordReset(email.trim());
      setSent(true);
    } catch (err) {
      showToast({ tone: 'error', ...authFailureToast(err instanceof Error ? err.message : '', 'reset', language) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <AuthScreen
      title={copy('ลืมรหัสผ่าน', 'Forgot password')}
      subtitle={copy(
        'กรอกอีเมลเพื่อรับลิงก์ตั้งรหัสผ่านใหม่',
        'Enter your email to receive a reset link.',
      )}
      showBack
    >
      <View style={{ gap: spacing.xl }}>
        {sent ? (
          <>
            {/* The screen's own state once the request is away, not a banner
                stacked over the form it replaced. */}
            <EmptyState
              title={copy('ตรวจสอบอีเมล', 'Check your email')}
              detail={copy(
                'หากอีเมลนี้มีบัญชี คุณจะได้รับลิงก์ตั้งรหัสผ่านใหม่',
                'If an account uses this email, you will receive a reset link.',
              )}
            />
            <Button
              icon="arrow-back"
              label={copy('กลับไปเข้าสู่ระบบ', 'Back to sign in')}
              onPress={() => router.replace('/login')}
            />
          </>
        ) : (
          <>
            <TextField
              icon="mail-outline"
              label={copy('อีเมล', 'Email')}
              autoComplete="email"
              textContentType="emailAddress"
              value={email}
              onChangeText={(value) => {
                setEmail(value);
                setEmailMissing(false);
              }}
              keyboardType="email-address"
              placeholder="you@example.com"
              error={emailMissing ? copy('กรอกอีเมล', 'Enter your email') : null}
            />
            <Button
              icon="paper-plane-outline"
              label={copy('ส่งลิงก์', 'Send reset link')}
              onPress={submit}
              loading={saving}
            />
          </>
        )}
      </View>
    </AuthScreen>
  );
}
