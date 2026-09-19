"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, X } from "lucide-react";
import HoverTip from "@/src/components/shared/HoverTip";

// The optional AI input helper, kept self-contained so it is trivially
// removable — drop <AIInputTools/> into any chat input bar, delete the line to
// remove, or set NEXT_PUBLIC_AI_TOOLS=off to disable everywhere:
//   🎤 Voice → browser Web Speech API (free, no server quota) → fills the input
// The receipt scanner (the "+" button, "สแกนบิล") was removed from the web on
// the owner's call, 19 Sep 2569. The server's receipt endpoint stays: the Expo
// app still uses it.

const AI_TOOLS_ENABLED = process.env.NEXT_PUBLIC_AI_TOOLS !== "off";

type Props = {
  onInsertText: (text: string) => void;
  language: "th" | "en";
  disabled?: boolean;
  /** Fires when the mic starts/stops so the caller can react (e.g. wake the orb). */
  onListeningChange?: (listening: boolean) => void;
  /** Live voice loudness 0..1 while listening; 0 once it stops. */
  onVoiceLevel?: (level: number) => void;
  /** Filled while listening so a caller can drive its own controls next to the
   *  input bar: `stop` keeps what was said, `cancel` throws it away. Null when idle. */
  voiceControlsRef?: React.RefObject<{ stop: () => void; cancel: () => void } | null>;
  /** Which tools to render. Voice is the only one left. */
  tools?: Array<"voice">;
};

export default function AIInputTools({
  onInsertText,
  language,
  disabled,
  onListeningChange,
  onVoiceLevel,
  voiceControlsRef,
  tools = ["voice"],
}: Props) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  // The loudness meter is a second, decorative mic tap alongside Web Speech —
  // it only drives the orb, so every failure path is silently ignored.
  const stopMeter = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    void audioCtxRef.current?.close().catch(() => undefined);
    audioCtxRef.current = null;
    onVoiceLevel?.(0);
  }, [onVoiceLevel]);

  const startMeter = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const AudioContextCtor =
        window.AudioContext
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ?? ((window as any).webkitAudioContext as typeof AudioContext | undefined);
      if (!AudioContextCtor) return;
      const context = new AudioContextCtor();
      audioCtxRef.current = context;
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      context.createMediaStreamSource(stream).connect(analyser);

      const samples = new Uint8Array(analyser.fftSize);
      let smoothed = 0;
      let lastReportedAt = 0;
      const tick = (timestamp: number) => {
        analyser.getByteTimeDomainData(samples);
        let sumSquares = 0;
        for (let i = 0; i < samples.length; i += 1) {
          const deviation = (samples[i] - 128) / 128;
          sumSquares += deviation * deviation;
        }
        // Speech RMS sits low, so scale it up before clamping to 0..1.
        const loudness = Math.min(1, Math.sqrt(sumSquares / samples.length) * 4.5);
        smoothed += (loudness - smoothed) * 0.28;
        // ~22 samples/sec: smooth enough for the orb and the waveform without
        // re-rendering the whole chat on every animation frame.
        if (timestamp - lastReportedAt >= 45) {
          lastReportedAt = timestamp;
          onVoiceLevel?.(smoothed);
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch {
      /* no mic permission or no meter — the orb still reacts to the listening state */
    }
  }, [onVoiceLevel]);

  useEffect(() => stopMeter, [stopMeter]);

  if (!AI_TOOLS_ENABLED) return null;

  const t = (th: string, en: string) => (language === "th" ? th : en);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const SpeechRecognition: any =
    typeof window !== "undefined"
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
      : undefined;

  const toggleVoice = () => {
    if (!SpeechRecognition) {
      setError(t("เบราว์เซอร์นี้ยังไม่รองรับการพูด (ลองใช้ Chrome / Android)", "Voice isn't supported here — try Chrome / Android"));
      return;
    }
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const rec = new SpeechRecognition();
    rec.lang = language === "th" ? "th-TH" : "en-US";
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    const finish = () => {
      setListening(false);
      onListeningChange?.(false);
      if (voiceControlsRef) voiceControlsRef.current = null;
      stopMeter();
    };
    rec.onstart = () => {
      setListening(true);
      onListeningChange?.(true);
      if (voiceControlsRef) {
        // stop() still delivers the transcript; abort() drops it on the floor.
        voiceControlsRef.current = { stop: () => rec.stop(), cancel: () => rec.abort() };
      }
      void startMeter();
    };
    rec.onerror = finish;
    rec.onend = finish;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (e: any) => {
      const text = e?.results?.[0]?.[0]?.transcript?.trim();
      if (text) onInsertText(text);
    };
    recognitionRef.current = rec;
    setError(null);
    rec.start();
  };

  const iconBtn =
    "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-gray-400 transition-all hover:-translate-y-0.5 hover:bg-orange-50 hover:text-orange-600 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-orange-950/30 dark:hover:text-orange-400";

  return (
    <>
      <div className="flex shrink-0 items-center gap-0.5">
      {tools.includes("voice") && (
      <HoverTip label={t("พูดเพื่อพิมพ์", "Speak to type")}>
        <button
          type="button"
          onClick={toggleVoice}
          disabled={disabled}
          aria-label={t("พูดเพื่อพิมพ์", "Speak to type")}
          className={
            listening
              ? "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-500 text-white shadow-sm shadow-red-500/40 animate-pulse"
              : iconBtn
          }
        >
          <Mic className="h-4 w-4" />
        </button>
      </HoverTip>
      )}
      </div>

      {error && (
        <div
          className="fixed bottom-24 left-1/2 -translate-x-1/2 rounded-full bg-gray-900 px-4 py-2 text-xs text-white shadow-lg dark:bg-white dark:text-gray-900"
          style={{ zIndex: 100 }}
        >
          <button type="button" onClick={() => setError(null)} className="flex items-center gap-2">
            {error} <X className="h-3.5 w-3.5 opacity-70" />
          </button>
        </div>
      )}
    </>
  );
}
