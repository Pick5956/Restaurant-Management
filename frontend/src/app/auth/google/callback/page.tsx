"use client";

// Landing page for the Google OAuth tab. Google redirects here with the
// id_token in the URL fragment; this page hands it back to the tab that opened
// it and closes itself. See src/lib/googleOAuth.ts for the whole flow.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import AppLogo from "@/src/components/shared/AppLogo";
import AppWordmark from "@/src/components/shared/AppWordmark";
import { useLanguage } from "@/src/providers/LanguageProvider";
import { googleLogin } from "@/src/lib/auth";
import { authRepository } from "@/src/app/repositories/authRepository";
import { safeInternalPath } from "@/src/lib/safeRedirect";
import {
  GOOGLE_AUTH_MESSAGE,
  clearPendingGoogleAuth,
  isGoogleCallbackTrusted,
  parseGoogleCallbackParams,
  readPendingGoogleAuth,
  type GoogleAuthMessage,
} from "@/src/lib/googleOAuth";

const DEFAULT_NEXT_PATH = "/restaurants";

type Phase = "working" | "done" | "error";

export default function GoogleCallbackPage() {
  const { language } = useLanguage();
  const [phase, setPhase] = useState<Phase>("working");
  const startedRef = useRef(false);

  const copy = language === "th"
    ? {
        working: "กำลังเข้าสู่ระบบด้วย Google...",
        workingHint: "อีกสักครู่ ระบบจะพากลับไปหน้าเดิมอัตโนมัติ",
        done: "เข้าสู่ระบบเรียบร้อยแล้ว",
        doneHint: "ปิดแท็บนี้แล้วกลับไปที่หน้าเดิมได้เลย",
        error: "เข้าสู่ระบบด้วย Google ไม่สำเร็จ",
        errorHint: "กรุณาปิดแท็บนี้แล้วลองกดเข้าสู่ระบบด้วย Google อีกครั้ง",
        backHome: "กลับหน้าแรก",
      }
    : {
        working: "Signing in with Google...",
        workingHint: "Hang on, we will take you back automatically.",
        done: "You are signed in",
        doneHint: "You can close this tab and go back to where you were.",
        error: "Google sign-in was not successful",
        errorHint: "Close this tab and start Google sign-in again.",
        backHome: "Back to home",
      };

  useEffect(() => {
    // React runs effects twice in development; the credential is consumed once.
    if (startedRef.current) return;
    startedRef.current = true;

    const params = parseGoogleCallbackParams(window.location.hash, window.location.search);
    // Drop the credential out of the address bar and session history before
    // anything else runs - it should not be reachable by pressing back.
    window.history.replaceState(null, "", window.location.pathname);

    let cancelled = false;

    const run = async () => {
      const opener = window.opener as Window | null;
      if (opener && !opener.closed) {
        const message: GoogleAuthMessage = {
          type: GOOGLE_AUTH_MESSAGE,
          state: params.state ?? "",
          idToken: params.idToken,
          error: params.error,
        };
        // Same-origin only: the opener is our own app, never Google.
        opener.postMessage(message, window.location.origin);
        // Allowed because this tab was opened by script. If a browser refuses,
        // the "you can close this tab" copy is what the user is left with.
        window.close();
        if (!cancelled) setPhase(params.idToken ? "done" : "error");
        return;
      }

      // No opener: the tab could not be opened, so sign-in ran as a full-page
      // redirect. Finish the exchange here and land the user back in the app.
      const pending = readPendingGoogleAuth();
      clearPendingGoogleAuth();
      if (!isGoogleCallbackTrusted(params, pending)) {
        if (!cancelled) setPhase("error");
        return;
      }

      const next = safeInternalPath(pending?.next) ?? DEFAULT_NEXT_PATH;
      try {
        const res = await googleLogin(params.idToken as string);
        if (cancelled) return;
        if (!res?.data?.token) {
          setPhase("error");
          return;
        }
        authRepository.setToken(res.data.token, "Bearer");
        window.location.replace(next);
      } catch {
        if (!cancelled) setPhase("error");
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-6 py-16 dark:bg-gray-950">
      <div className="w-full max-w-sm rounded-md border border-gray-200 bg-white p-8 text-center dark:border-gray-800 dark:bg-gray-900">
        <div className="flex items-center justify-center gap-2">
          <AppLogo decorative size={28} />
          <AppWordmark height={14} className="text-gray-900 dark:text-white" />
        </div>

        <div className="mt-6 flex items-center justify-center gap-2 text-[13px] font-semibold text-gray-900 dark:text-gray-100">
          {phase === "working" && <Loader2 className="h-4 w-4 animate-spin text-orange-600" aria-hidden="true" />}
          <span>{phase === "working" ? copy.working : phase === "done" ? copy.done : copy.error}</span>
        </div>

        <p className="mt-2 text-[12px] text-gray-500 dark:text-gray-400">
          {phase === "working" ? copy.workingHint : phase === "done" ? copy.doneHint : copy.errorHint}
        </p>

        {phase === "error" && (
          <Link
            href="/"
            className="mt-6 inline-flex h-10 w-full items-center justify-center rounded-md bg-orange-700 text-[13px] font-semibold text-white transition-colors hover:bg-orange-800"
          >
            {copy.backHome}
          </Link>
        )}
      </div>
    </main>
  );
}
