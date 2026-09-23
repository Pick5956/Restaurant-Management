import { router, useFocusEffect, useNavigation, type NativeStackNavigationProp } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { View, type TextInput } from 'react-native';

import { AuthScreen } from '@/src/components/auth-screen';
import { KitField } from '@/src/components/table-plan/sheet-kit';
import { Button } from '@/src/components/ui';
import { invitationTokenFrom } from '@/src/lib/staff-workflow';
import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';
import { spacing } from '@/src/theme';

// Only a fallback: the field normally takes focus when the push finishes.
const FOCUS_FALLBACK_MS = 650;

export default function ManualInviteScreen() {
  const { copy } = useDisplayPreferences();
  const navigation = useNavigation<NativeStackNavigationProp<Record<string, object | undefined>>>();
  const fieldRef = useRef<TextInput>(null);
  const navigatingRef = useRef(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  // One field is the whole screen, so it opens ready to paste into and the
  // keyboard takes the space below the button. Focus waits for the slide to
  // finish: focusing mid-transition stutters it on Android.
  useEffect(() => {
    let focused = false;
    const focus = () => {
      if (focused) return;
      focused = true;
      fieldRef.current?.focus();
    };
    const timer = setTimeout(focus, FOCUS_FALLBACK_MS);
    const unsubscribe = navigation.addListener('transitionEnd', (event) => {
      if (event.data?.closing) return;
      clearTimeout(timer);
      focus();
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [navigation]);

  // A quick double tap pushed the invitation twice.
  useFocusEffect(useCallback(() => {
    navigatingRef.current = false;
  }, []));

  function submit() {
    if (navigatingRef.current) return;
    const token = invitationTokenFrom(value);
    if (!token) {
      setError(value.trim()
        ? copy('ลิงก์หรือรหัสคำเชิญไม่ถูกต้อง', 'This invitation link or code is not valid')
        : copy('วางลิงก์คำเชิญก่อน', 'Paste the invitation link first'));
      fieldRef.current?.focus();
      return;
    }
    setError(null);
    navigatingRef.current = true;
    router.push({ pathname: '/invite/[token]', params: { token } } as never);
  }

  return (
    <AuthScreen title={copy('รับคำเชิญเข้าร่วมร้าน', 'Join a restaurant')} showBack>
      <View style={{ gap: spacing.lg }}>
        <KitField
          ref={fieldRef}
          autoCapitalize="none"
          error={error}
          keyboardType="url"
          label={copy('ลิงก์หรือรหัสคำเชิญ', 'Invitation link or code')}
          onChangeText={(text) => {
            setValue(text);
            if (error) setError(null);
          }}
          onSubmitEditing={submit}
          returnKeyType="done"
          value={value}
        />
        <Button
          icon="arrow-forward"
          label={copy('ตรวจคำเชิญ', 'Check invitation')}
          onPress={submit}
        />
      </View>
    </AuthScreen>
  );
}
