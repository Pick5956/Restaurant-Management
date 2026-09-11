/**
 * expo-audio, reached for in a way that cannot take the screen down with it.
 *
 * `expo-audio` binds to a native module the moment it is imported. On a build
 * that predates it — an older Expo Go, or a dev client compiled before the
 * package was added — that import throws `Cannot find native module
 * 'ExpoAudio'`, and because the composer imports it at the top of the file the
 * throw happens while the AI screen is still being parsed: no mic, and no
 * conversation either. The screen is worth more than the microphone, so the
 * import happens here behind a guard and the rest of the app asks
 * `voiceRecordingSupported` before offering to record.
 *
 * The fix on the phone is still to rebuild the dev client (or update Expo Go)
 * so the native side exists. This only decides what the owner sees until then.
 */
import type * as ExpoAudio from 'expo-audio';

let audio: typeof ExpoAudio | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  audio = require('expo-audio') as typeof ExpoAudio;
} catch {
  audio = null;
}

/** False when this build has no audio native module — hide anything that records. */
export const voiceRecordingSupported = audio !== null;

/** The stock presets, or null on a build without the module. */
export const recordingPresets: typeof ExpoAudio.RecordingPresets | null = audio?.RecordingPresets ?? null;

export interface VoiceRecorder {
  uri: string | null;
  prepareToRecordAsync: () => Promise<void>;
  record: () => void;
  stop: () => Promise<void>;
}

const unsupported = () => {
  throw new Error('expo-audio is not available in this build');
};

const stub: VoiceRecorder = {
  uri: null,
  prepareToRecordAsync: unsupported,
  record: unsupported,
  stop: unsupported,
};

/**
 * A hook either way, so the hook order never depends on what the build has.
 * Which implementation is used is fixed at module load, not per render.
 */
export const useVoiceRecorder: (options: unknown) => VoiceRecorder = audio
  ? (audio.useAudioRecorder as unknown as (options: unknown) => VoiceRecorder)
  : () => stub;

export async function requestRecordingPermission(): Promise<boolean> {
  if (!audio) return false;
  const permission = await audio.requestRecordingPermissionsAsync();
  return permission.granted;
}

export async function enterRecordingMode(): Promise<void> {
  if (!audio) return;
  await audio.setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
}

export async function leaveRecordingMode(): Promise<void> {
  if (!audio) return;
  await audio.setAudioModeAsync({ allowsRecording: false });
}
