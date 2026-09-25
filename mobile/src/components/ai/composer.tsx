import { LinearGradient } from 'expo-linear-gradient';
import { forwardRef, useState } from 'react';
import { ActivityIndicator, Pressable, TextInput as NativeTextInput } from 'react-native';

import { AppIcon } from '@/src/components/app-icon';
import { AppTextInput as TextInput } from '@/src/components/app-text-input';
import type { DisplayLanguage } from '@/src/lib/display-preferences';

import { GlassSurface } from './chrome';
import { ai } from './theme';

// The composer is a capsule while the question fits one line, and grows upward
// into a rounded box once it wraps — the shape a phone keyboard expects.
//
// Only the text and send (22 ก.ย. 2569, the owner's call): the mic and the "+"
// that scanned a receipt are gone from the app. To speak a question,
// use the dictation key on the phone's own keyboard: it types straight into
// this box, in any language the phone knows, with no recording, upload or
// transcription quota on our side.

/** One line of text plus its padding; above this the capsule becomes a box. */
const ONE_LINE = 46;

export const Composer = forwardRef<NativeTextInput, {
  value: string;
  onChange: (text: string) => void;
  onSend: () => void;
  sending: boolean;
  disabled?: boolean;
  language: DisplayLanguage;
}>(function Composer({ value, onChange, onSend, sending, disabled, language }, ref) {
  const [focused, setFocused] = useState(false);
  const [contentHeight, setContentHeight] = useState(0);
  const t = (th: string, en: string) => (language === 'th' ? th : en);
  const canSend = value.trim().length > 0 && !sending && !disabled;
  const tall = value.length > 0 && contentHeight > ONE_LINE;

  const sendButton = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('ถาม AI', 'Ask AI')}
      disabled={!canSend}
      onPress={onSend}
      style={({ pressed }) => ({ opacity: !canSend ? 0.5 : pressed ? 0.85 : 1 })}
    >
      <LinearGradient
        colors={[ai.orange, ai.amber]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', shadowColor: ai.orange, shadowOpacity: 0.35, shadowRadius: 3, shadowOffset: { width: 0, height: 1 } }}
      >
        {sending ? <ActivityIndicator size="small" color="#ffffff" /> : <AppIcon name="arrow-up" size={24} color="#ffffff" />}
      </LinearGradient>
    </Pressable>
  );

  const input = (
    <TextInput
      ref={ref}
      accessibilityLabel={t('คำถามสำหรับผู้ช่วย', 'Question for the assistant')}
      // This composer is pinned to the bottom of a KeyboardAvoidingView, so it
      // already sits directly on the keyboard with its own send button. A Done bar
      // would slide in underneath it: two bars, the useful one further away.
      omitKeyboardDoneBar
      multiline
      maxLength={800}
      value={value}
      onChangeText={onChange}
      onContentSizeChange={(event) => setContentHeight(event.nativeEvent.contentSize.height)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      editable={!disabled}
      placeholder={t('พิมพ์คำถามของคุณที่นี่...', 'Type your question here...')}
      placeholderTextColor={ai.faint}
      style={{
        flex: 1,
        minHeight: 42,
        maxHeight: 150,
        paddingHorizontal: 10,
        paddingVertical: 9,
        fontSize: 16,
        lineHeight: 24,
        color: ai.ink,
        textAlignVertical: tall ? 'top' : 'center',
      }}
    />
  );

  const fallbackStyle = {
    borderWidth: 1,
    borderColor: focused ? '#fdba74' : '#e5e7eb',
    backgroundColor: ai.surface,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  };

  // One row in both shapes. A long question used to drop the send button onto
  // a line of its own under the text; with only the send button left it sits
  // beside the text and stays on the last line as it grows (22 ก.ย. 2569).
  // 14px on the left where the "+" used to sit, so the text does not start
  // against the capsule's curve.
  return (
    <GlassSurface
      style={{
        borderRadius: tall ? 28 : 999,
        flexDirection: 'row',
        alignItems: tall ? 'flex-end' : 'center',
        paddingLeft: 14,
        paddingRight: 8,
        paddingVertical: 8,
        gap: 3,
        overflow: 'hidden',
      }}
      fallbackStyle={fallbackStyle}
    >
      {input}
      {sendButton}
    </GlassSurface>
  );
});
