import { useWindowDimensions, View } from 'react-native';

import { AppScreen } from '@/src/components/app-shell';
import { CheckRow, FORM_MAX_WIDTH, FormCard, Note } from '@/src/components/form/parts';
import type { DisplayLanguage } from '@/src/lib/display-preferences';
import { useDisplayPreferences } from '@/src/providers/display-preferences-provider';
import { breakpoints, spacing } from '@/src/theme';

// Display, redrawn on 15 ก.ย. 2569: the language is a pair of rows with a
// tick, not two chips, and the page says plainly that the choice is this
// device's alone.

export default function DisplaySettingsScreen() {
  const { width } = useWindowDimensions();
  const { copy, language, persistenceStatus, setLanguage } = useDisplayPreferences();
  const tablet = width >= breakpoints.tabletWorkspace;

  const languages: { value: DisplayLanguage; label: string; detail: string }[] = [
    { value: 'th', label: 'ไทย', detail: copy('ค่าเริ่มต้นของร้าน', 'The shop default') },
    { value: 'en', label: 'English', detail: '' },
  ];

  const status = persistenceStatus === 'loading'
    ? { tone: 'info' as const, text: copy('กำลังอ่านค่าจากเครื่องนี้', 'Reading the saved choice on this device') }
    : persistenceStatus === 'saving'
      ? { tone: 'info' as const, text: copy('กำลังบันทึกลงเครื่อง', 'Saving on this device') }
      : persistenceStatus === 'memory-only'
        ? { tone: 'warning' as const, text: copy('บันทึกถาวรไม่ได้ ใช้ได้ในรอบนี้ แต่อาจกลับเป็นค่าเดิมเมื่อปิดแอป', 'Could not save permanently: this works for now but may reset when the app closes') }
        : null;

  return (
    <AppScreen
      title={copy('การแสดงผล', 'Display')}
      subtitle={copy('ใช้เฉพาะเครื่องนี้ · เครื่องอื่นตั้งแยก', 'This device only · other devices keep their own')}
      topLevel={false}
      centerTitle
      contentMaxWidth={tablet ? FORM_MAX_WIDTH : undefined}
    >
      <View style={{ gap: spacing.md }}>
        <FormCard icon="language-outline" title={copy('ภาษา', 'Language')} detail={copy('เมนู ปุ่ม และข้อความในแอป', 'Menus, buttons and messages in the app')}>
          {languages.map((item, index) => (
            <CheckRow key={item.value} first={index === 0} title={item.label} detail={item.detail || undefined} checked={language === item.value} onPress={() => setLanguage(item.value)} />
          ))}
        </FormCard>
        {status ? <Note icon={status.tone === 'warning' ? 'alert-circle-outline' : 'time-outline'} tone={status.tone} text={status.text} /> : null}
        <Note text={copy('ใบเสร็จและ QR สั่งอาหารใช้ภาษาที่ตั้งในข้อมูลร้าน ไม่ตามค่านี้', 'Receipts and the ordering QR follow the shop settings, not this choice')} />
      </View>
    </AppScreen>
  );
}
