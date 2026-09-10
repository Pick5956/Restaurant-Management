import { LinearGradient } from 'expo-linear-gradient';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { forwardRef, useState } from 'react';
import { File as FileSystemFile } from 'expo-file-system';
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder } from 'expo-audio';
import { ActivityIndicator, Pressable, TextInput as NativeTextInput, View } from 'react-native';

import { extractReceipt, transcribeVoiceNote } from '@/src/api/ai';
import { AppIcon } from '@/src/components/app-icon';
import { AppText as Text } from '@/src/components/app-text';
import { AppTextInput as TextInput } from '@/src/components/app-text-input';
import { bytesToBase64, receiptDraftToCommand } from '@/src/lib/ai-chat';
import type { DisplayLanguage } from '@/src/lib/display-preferences';

import { GlassMenu, GlassSurface, type GlassMenuItem } from './chrome';
import { ai } from './theme';

// The composer is a capsule while the question fits one line, and grows upward
// into a rounded box once it wraps — the shape a phone keyboard expects.
// Attachments live behind "+" rather than sitting on the bar, so the row stays
// quiet and there is room for more of them later.
//
// Voice dictation from the web is left out: Expo Go has no speech-to-text.

/** One line of text plus its padding; above this the capsule becomes a box. */
const ONE_LINE = 46;

// Mono AAC in an m4a on both platforms. The stock low-quality preset records
// narrowband AMR in a .3gp on Android, which the transcription endpoint does not
// accept and which speech recognition reads poorly anyway.
const VOICE_NOTE = {
  ...RecordingPresets.LOW_QUALITY,
  extension: '.m4a',
  numberOfChannels: 1,
  bitRate: 64000,
  android: { outputFormat: 'mpeg4' as const, audioEncoder: 'aac' as const },
};

export const Composer = forwardRef<NativeTextInput, {
  value: string;
  onChange: (text: string) => void;
  onSend: () => void;
  onInsert: (text: string) => void;
  onNotice: (message: string, tone: 'error' | 'info') => void;
  sending: boolean;
  disabled?: boolean;
  language: DisplayLanguage;
}>(function Composer({ value, onChange, onSend, onInsert, onNotice, sending, disabled, language }, ref) {
  const [scanning, setScanning] = useState(false);
  const [focused, setFocused] = useState(false);
  const [contentHeight, setContentHeight] = useState(0);
  const [attachOpen, setAttachOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  // Speech goes to the shop's own backend, which runs it through Whisper; the
  // phone has no recogniser of its own inside Expo Go.
  const recorder = useAudioRecorder(VOICE_NOTE);
  const t = (th: string, en: string) => (language === 'th' ? th : en);
  const canSend = value.trim().length > 0 && !sending && !disabled;
  const tall = value.length > 0 && contentHeight > ONE_LINE;

  const scan = async () => {
    if (scanning || disabled) return;
    try {
      const picked = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: 'images',
        allowsEditing: false,
        allowsMultipleSelection: false,
        selectionLimit: 1,
        quality: 1,
      });
      if (picked.canceled) return;
      const asset = picked.assets[0];
      setScanning(true);
      const context = ImageManipulator.manipulate(asset.uri);
      if (asset.width && asset.width > 1280) context.resize({ width: 1280 });
      const rendered = await context.renderAsync();
      const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.8, base64: true });
      if (!saved.base64) throw new Error('no image data');
      const { draft } = await extractReceipt(saved.base64, 'image/jpeg');
      onInsert(receiptDraftToCommand(draft, language));
      onNotice(t('อ่านบิลแล้ว ตรวจข้อความแล้วกดส่งเพื่อบันทึก', 'Receipt read. Check the text, then send to record it'), 'info');
    } catch (error) {
      const status = typeof error === 'object' && error !== null && 'status' in error ? Number((error as { status?: number }).status) : 0;
      onNotice(
        status === 429
          ? t('โควตาสแกนเต็มชั่วคราว ลองใหม่ในสักครู่', 'Scan quota is full right now, try again shortly')
          : t('อ่านบิลไม่สำเร็จ ลองถ่ายใหม่ให้ชัดขึ้น', 'Could not read the receipt, try a clearer photo'),
        'error',
      );
    } finally {
      setScanning(false);
    }
  };

  const startListening = async () => {
    if (listening || transcribing || disabled) return;
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        onNotice(t('ยังไม่ได้อนุญาตให้ใช้ไมค์ เปิดได้ในตั้งค่าของเครื่อง', 'Microphone access is off. Turn it on in system settings'), 'error');
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setListening(true);
    } catch {
      onNotice(t('เริ่มอัดเสียงไม่ได้ ลองอีกครั้ง', 'Could not start recording, try again'), 'error');
    }
  };

  const stopListening = async () => {
    if (!listening) return;
    setListening(false);
    setTranscribing(true);
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) throw new Error('no recording');
      const bytes = await new FileSystemFile(uri).bytes();
      if (bytes.length < 2000) {
        onNotice(t('สั้นไป ลองพูดอีกครั้ง', 'Too short, try speaking again'), 'error');
        return;
      }
      const { text } = await transcribeVoiceNote(bytesToBase64(bytes), 'audio/m4a', language);
      // It lands in the box, not in the chat: the owner reads it and fixes what
      // was misheard before anything is asked.
      onInsert(value.trim() ? `${value.trim()} ${text}` : text);
    } catch (error) {
      const status = typeof error === 'object' && error !== null && 'status' in error ? Number((error as { status?: number }).status) : 0;
      onNotice(
        status === 429
          ? t('โควตาถอดเสียงเต็มชั่วคราว ลองใหม่ในสักครู่', 'Transcription quota is full right now, try again shortly')
          : t('ถอดเสียงไม่สำเร็จ ลองพูดใหม่ให้ชัดขึ้น', 'Could not read that, try speaking again'),
        'error',
      );
    } finally {
      setTranscribing(false);
      await setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
    }
  };

  const micButton = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={listening ? t('หยุดฟังแล้วแปลงเป็นข้อความ', 'Stop and transcribe') : t('พูดเพื่อพิมพ์', 'Speak to type')}
      disabled={transcribing || disabled}
      onPress={() => { void (listening ? stopListening() : startListening()); }}
      style={({ pressed }) => ({
        width: 46,
        height: 46,
        borderRadius: 23,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: listening ? '#ef4444' : pressed ? ai.orangeSoft : 'transparent',
        opacity: disabled ? 0.5 : 1,
      })}
    >
      {transcribing ? (
        <ActivityIndicator size="small" color={ai.orange} />
      ) : (
        <AppIcon name={listening ? 'stop' : 'mic-outline'} size={listening ? 20 : 24} color={listening ? '#ffffff' : ai.faint} />
      )}
    </Pressable>
  );

  const attachItems: GlassMenuItem[] = [
    {
      key: 'scan',
      icon: 'scan-outline',
      label: t('สแกนใบเสร็จ', 'Scan a receipt'),
      detail: t('อ่านยอดจากรูปแล้วเติมให้', 'Reads the total from a photo'),
      onPress: () => { void scan(); },
    },
  ];

  const plusButton = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('แนบเข้าคำถาม', 'Add to your question')}
      disabled={scanning || disabled}
      onPress={() => setAttachOpen((current) => !current)}
      style={({ pressed }) => ({
        width: 46,
        height: 46,
        borderRadius: 23,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed || scanning ? ai.orangeSoft : 'transparent',
        opacity: disabled ? 0.5 : 1,
      })}
    >
      {scanning ? <ActivityIndicator size="small" color={ai.orange} /> : <AppIcon name="add" size={24} color={ai.faint} />}
    </Pressable>
  );

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
        flex: tall ? undefined : 1,
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

  const menu = (
    <GlassMenu
      open={attachOpen}
      onClose={() => setAttachOpen(false)}
      items={attachItems}
      from="bottom-left"
      style={{ bottom: '100%', left: 0, marginBottom: 8 }}
    />
  );

  if (tall) {
    return (
      <View>
      {menu}
      <GlassSurface
        style={{ borderRadius: 28, paddingTop: 10, paddingBottom: 9, paddingHorizontal: 9, gap: 4, overflow: 'hidden' }}
        fallbackStyle={fallbackStyle}
      >
        {input}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          {plusButton}
          {scanning ? <Text style={{ fontSize: 12, color: ai.faint }}>{t('กำลังอ่านบิล…', 'Reading the receipt…')}</Text> : null}
          {listening ? <Text style={{ fontSize: 12, color: '#ef4444', fontWeight: '600' }}>{t('กำลังฟัง…', 'Listening…')}</Text> : null}
          <View style={{ flex: 1 }} />
          {micButton}
          {sendButton}
        </View>
      </GlassSurface>
      </View>
    );
  }

  return (
    <View>
      {menu}
      <GlassSurface
      style={{ borderRadius: 999, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 8, gap: 3, overflow: 'hidden' }}
      fallbackStyle={fallbackStyle}
    >
      {plusButton}
      {input}
      {micButton}
      {sendButton}
      </GlassSurface>
    </View>
  );
});
