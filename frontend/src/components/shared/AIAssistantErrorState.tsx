"use client";

import { AlertTriangle } from "lucide-react";

type AIAssistantErrorStateProps = {
  language: "th" | "en";
  onRetry: () => void;
  onStartNewChat: () => void;
};

export default function AIAssistantErrorState({
  language,
  onRetry,
  onStartNewChat,
}: AIAssistantErrorStateProps) {
  const copy = language === "th"
    ? {
        title: "แชทสะดุดชั่วคราว",
        detail: "ลองเปิดแชทเดิมอีกครั้ง หรือเริ่มแชทใหม่ได้ครับ หากเพิ่งยืนยันการเปลี่ยนแปลง ให้ตรวจสอบสถานะล่าสุดก่อนทำซ้ำ",
        retry: "ลองอีกครั้ง",
        newChat: "เริ่มแชทใหม่",
      }
    : {
        title: "The chat hit a temporary snag",
        detail: "Try opening the same chat again, or start a new chat. If you just confirmed a change, check its latest status before repeating it.",
        retry: "Try again",
        newChat: "Start new chat",
      };

  return (
    <main className="flex min-h-dvh w-full items-center justify-center px-4 py-8 sm:px-6 lg:min-h-[calc(100dvh-var(--dashboard-shell-row))] lg:px-8">
      <section
        role="alert"
        aria-labelledby="ai-assistant-error-title"
        className="w-full max-w-lg rounded-md border border-gray-200 bg-white p-6 text-center dark:border-gray-800 dark:bg-gray-950 sm:p-8"
      >
        <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-md bg-red-50 text-red-600 dark:bg-red-950/30 dark:text-red-300">
          <AlertTriangle className="h-5 w-5" aria-hidden="true" />
        </span>
        <h1 id="ai-assistant-error-title" className="mt-4 text-lg font-semibold text-gray-950 dark:text-white">
          {copy.title}
        </h1>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-gray-600 dark:text-gray-400">
          {copy.detail}
        </p>
        <div className="mt-6 flex flex-col-reverse justify-center gap-2 sm:flex-row">
          <button
            type="button"
            onClick={onStartNewChat}
            className="inline-flex min-h-11 items-center justify-center rounded-md border border-gray-200 px-4 py-2.5 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-900"
          >
            {copy.newChat}
          </button>
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex min-h-11 items-center justify-center rounded-md bg-orange-700 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-orange-800 dark:bg-orange-700 dark:text-white dark:hover:bg-orange-800"
          >
            {copy.retry}
          </button>
        </div>
      </section>
    </main>
  );
}
