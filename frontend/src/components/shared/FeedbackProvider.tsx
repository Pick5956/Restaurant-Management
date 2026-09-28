"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { X } from "lucide-react";
import { useLanguage } from "@/src/providers/LanguageProvider";
import WarmConfirmDialog from "@/src/components/shared/WarmConfirmDialog";

type ToastTone = "success" | "error" | "warning" | "info";
type ConfirmTone = "default" | "danger" | "warning";

type ToastInput = {
  title: string;
  message?: string;
  tone?: ToastTone;
  duration?: number;
};

type Toast = ToastInput & {
  id: number;
  tone: ToastTone;
};

type ConfirmInput = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
};

type ConfirmState = ConfirmInput & {
  open: boolean;
  resolve: (confirmed: boolean) => void;
};

type ToastContextValue = {
  showToast: (toast: ToastInput) => void;
  dismissToast: (id: number) => void;
};

type ConfirmContextValue = {
  confirm: (input: ConfirmInput) => Promise<boolean>;
};

const ToastContext = createContext<ToastContextValue | null>(null);
const ConfirmContext = createContext<ConfirmContextValue | null>(null);

// Every tone shares one neutral surface and differs only in its accent bar and
// icon tile - the same vocabulary the table cards use (a white card, a w-1.5
// status bar, a soft tinted pill). The old table flooded the whole panel with
// the hue, which made the toast the only surface in the product that did that,
// and left `success` as a near-black card with no relation to green at all.
const TOAST_SURFACE =
  "border-gray-200 bg-white text-gray-900 dark:border-gray-800 dark:bg-gray-950 dark:text-white";

const toneTitleClassName: Record<ToastTone, string> = {
  success: "text-gray-900 dark:text-white",
  info: "text-gray-900 dark:text-white",
  warning: "text-amber-700 dark:text-amber-300",
  error: "text-red-700 dark:text-red-300",
};

export function FeedbackProvider({ children }: { children: React.ReactNode }) {
  const { language } = useLanguage();
  const [toasts, setToasts] = useState<Toast[]>([]);
  // The request stays after it is answered and only `open` goes false, so the
  // dialog keeps its words while it animates out instead of emptying first.
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback(
    (toast: ToastInput) => {
      const id = Date.now() + Math.round(Math.random() * 1000);
      const nextToast: Toast = { ...toast, id, tone: toast.tone ?? "success" };
      setToasts((current) => [...current, nextToast].slice(-4));
      window.setTimeout(() => dismissToast(id), toast.duration ?? 3600);
    },
    [dismissToast],
  );

  const confirm = useCallback((input: ConfirmInput) => {
    return new Promise<boolean>((resolve) => {
      setConfirmState({ ...input, open: true, resolve });
    });
  }, []);

  const toastValue = useMemo(() => ({ showToast, dismissToast }), [dismissToast, showToast]);
  const confirmValue = useMemo(() => ({ confirm }), [confirm]);

  const closeConfirm = (confirmed: boolean) => {
    if (!confirmState?.open) return;
    confirmState.resolve(confirmed);
    setConfirmState({ ...confirmState, open: false });
  };

  return (
    <ToastContext.Provider value={toastValue}>
      <ConfirmContext.Provider value={confirmValue}>
        {children}

        <div className="pointer-events-none fixed bottom-[calc(env(safe-area-inset-bottom)+1rem)] left-1/2 z-[var(--z-toast)] flex max-w-[calc(100dvw-1.5rem)] -translate-x-1/2 flex-col-reverse items-center gap-2 sm:bottom-6">
          {toasts.map((toast) => {
            const urgent = toast.tone === "error" || toast.tone === "warning";
            return (
              <div
                key={toast.id}
                className={`animate-slide-up pointer-events-auto flex min-h-11 max-w-full items-center gap-2 overflow-hidden rounded-xl border py-2 pl-4 pr-2 shadow-[0_2px_4px_rgba(15,23,42,0.06),0_16px_40px_rgba(15,23,42,0.14)] dark:shadow-[0_2px_4px_rgba(0,0,0,0.35),0_16px_40px_rgba(0,0,0,0.55)] ${TOAST_SURFACE}`}
                role={urgent ? "alert" : "status"}
                aria-live={urgent ? "assertive" : "polite"}
                aria-atomic="true"
              >
                <div className="min-w-0">
                  <p className={`text-[13px] font-semibold leading-5 ${toneTitleClassName[toast.tone]}`}>{toast.title}</p>
                  {toast.message && <p className="mt-0.5 text-[12px] leading-5 text-gray-500 dark:text-gray-400">{toast.message}</p>}
                </div>
                <button
                  type="button"
                  onClick={() => dismissToast(toast.id)}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 focus-visible:outline-none dark:text-gray-500 dark:hover:bg-gray-900 dark:hover:text-gray-300"
                  aria-label={language === "th" ? "ปิดแจ้งเตือน" : "Dismiss notification"}
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            );
          })}
        </div>

        {/* Every question in the app is the inventory's dialog: the round
            warning icon, the confirm button on top and "cancel" under it,
            focus on cancel. Red only when the caller says it destroys
            something; anything else gets the terracotta confirm. */}
        <WarmConfirmDialog
          open={confirmState?.open ?? false}
          title={confirmState?.title ?? ""}
          description={confirmState?.message ?? ""}
          confirmLabel={confirmState?.confirmLabel ?? (language === "th" ? "ยืนยัน" : "Confirm")}
          cancelLabel={confirmState?.cancelLabel ?? (language === "th" ? "ยกเลิก" : "Cancel")}
          tone={confirmState?.tone === "danger" ? "danger" : "primary"}
          onConfirm={() => closeConfirm(true)}
          onCancel={() => closeConfirm(false)}
        />
      </ConfirmContext.Provider>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used within FeedbackProvider");
  return context;
}

export function useConfirm() {
  const context = useContext(ConfirmContext);
  if (!context) throw new Error("useConfirm must be used within FeedbackProvider");
  return context.confirm;
}
