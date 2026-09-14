"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRestaurantRouter } from "@/src/hooks/useRestaurantNav";
import { Loader2, Mic, Plus, Receipt, X } from "lucide-react";
import { extractReceipt } from "@/src/lib/ai";
import HoverTip from "@/src/components/shared/HoverTip";

// Two optional AI input helpers, kept in ONE self-contained component so they are
// trivially removable — drop <AIInputTools/> into any chat input bar, delete the
// line to remove, or set NEXT_PUBLIC_AI_TOOLS=off to disable everywhere:
//   🎤 Voice   → browser Web Speech API (free, no server quota) → fills the input
//   📷 Receipt → Gemini vision reads a bill, then HANDS OFF to the existing
//                Expenses page (pre-filled Add dialog) so the owner saves it there.
// The receipt path deliberately does NOT write to the ledger itself — it only
// extracts and stashes a draft, then bounces to /expenses so the shop's own
// expense form owns the save (minimal coupling with that part of the system).

const AI_TOOLS_ENABLED = process.env.NEXT_PUBLIC_AI_TOOLS !== "off";
const PREFILL_KEY = "ai_expense_prefill";

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
  /** Which tools to render. Split the bar by mounting one instance per side —
   *  e.g. tools={["scan"]} on the left, tools={["voice"]} on the right. */
  tools?: Array<"voice" | "scan">;
};

// Shrink a photo to a modest JPEG before upload — smaller = faster + cheaper +
// well within request limits, and plenty sharp for OCR.
async function fileToDownscaledBase64(file: File, maxDim = 1400): Promise<{ base64: string; mime: string }> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(new Error("read failed"));
    fr.readAsDataURL(file);
  });
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const im = new window.Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error("decode failed"));
    im.src = dataUrl;
  });
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { base64: dataUrl.split(",")[1] ?? "", mime: file.type || "image/jpeg" };
  ctx.drawImage(img, 0, 0, w, h);
  const out = canvas.toDataURL("image/jpeg", 0.85);
  return { base64: out.split(",")[1] ?? "", mime: "image/jpeg" };
}

export default function AIInputTools({
  onInsertText,
  language,
  disabled,
  onListeningChange,
  onVoiceLevel,
  voiceControlsRef,
  tools = ["voice", "scan"],
}: Props) {
  const router = useRestaurantRouter();
  const [listening, setListening] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
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

  // Close the "+" menu on an outside tap or Escape. It holds the receipt scanner
  // (and anything added later), so it must not linger behind a tap meant for the
  // chat or the send button.
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

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

  const onPickImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    setError(null);
    setScanning(true);
    try {
      const { base64, mime } = await fileToDownscaledBase64(file);
      const { data } = await extractReceipt(base64, mime);
      const d = data.draft;
      const note = [d.vendor, d.note].filter(Boolean).join(" — ");
      // Stash the draft and bounce to the Expenses page — its own Add dialog opens
      // pre-filled so the owner reviews & saves there (we never write the ledger).
      try {
        sessionStorage.setItem(
          PREFILL_KEY,
          JSON.stringify({ category: d.category, amount: d.amount, spent_at: d.spent_at, note }),
        );
      } catch {
        /* ignore storage failure — the page just opens blank */
      }
      router.push("/expenses");
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const status = (err as any)?.response?.status;
      setError(
        status === 429
          ? t("โควตาสแกนเต็มชั่วคราว ลองใหม่ในสักครู่", "Scan quota is full right now — try again shortly")
          : t("อ่านบิลไม่สำเร็จ ลองถ่ายใหม่ให้ชัดขึ้น", "Couldn't read the receipt — try a clearer photo"),
      );
    } finally {
      setScanning(false);
    }
  };

  const iconBtn =
    "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-gray-400 transition-all hover:-translate-y-0.5 hover:bg-orange-50 hover:text-orange-600 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-orange-950/30 dark:hover:text-orange-400";
  const iconBtnActive =
    "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-orange-50 text-orange-600 transition-all dark:bg-orange-950/30 dark:text-orange-400";

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
      {tools.includes("scan") && (
      <div className="relative" ref={menuRef}>
        <HoverTip label={t("เพิ่มเติม", "More")}>
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            disabled={disabled || scanning}
            aria-label={t("เพิ่มเติม", "More")}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className={menuOpen ? iconBtnActive : iconBtn}
          >
            {scanning ? (
              <Loader2 className="h-4 w-4 animate-spin text-orange-500" />
            ) : (
              <Plus className={`h-4 w-4 transition-transform duration-200 ${menuOpen ? "rotate-45" : ""}`} />
            )}
          </button>
        </HoverTip>
        {menuOpen && (
          <div
            role="menu"
            className="absolute bottom-full left-0 z-50 mb-2 min-w-[168px] rounded-xl border border-gray-200 bg-white p-1.5 shadow-lg shadow-gray-950/10 dark:border-gray-800 dark:bg-gray-950"
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                fileRef.current?.click();
              }}
              disabled={disabled || scanning}
              className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium text-gray-700 transition-colors hover:bg-orange-50 hover:text-orange-700 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-200 dark:hover:bg-orange-950/30 dark:hover:text-orange-300"
            >
              <Receipt className="h-4 w-4 shrink-0" />
              <span>{t("สแกนบิล", "Scan bill")}</span>
            </button>
          </div>
        )}
      </div>
      )}
      </div>
      {tools.includes("scan") && (
        <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={onPickImage} className="hidden" />
      )}

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
