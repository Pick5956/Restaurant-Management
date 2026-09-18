"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { TriangleAlert } from "lucide-react";

// A modal confirmation for the one kind of action that cannot be undone.
//
// The inline version this replaced grew out of the message list, which was fine
// until it scrolled: on a phone the question could sit above the fold while the
// thread it was about to delete filled the screen. A modal cannot be scrolled
// away from, and that is the entire reason to use one here — not decoration.
//
// Three details are load-bearing rather than polish:
//
//   * It renders through a portal. The floating chat panel sits inside a
//     transformed, overflow-hidden container, and `position: fixed` inside a
//     transformed ancestor is positioned against that ancestor, not the
//     viewport — the dialog would have been clipped into the chat panel.
//   * Focus starts on the SAFE button and returns to whatever opened the dialog
//     when it closes. A confirm dialog that opens with the destructive button
//     focused turns a reflexive Enter into a deleted conversation.
//   * Tab is trapped. Without it, Tab walks into the page behind the backdrop,
//     where a screen-reader user cannot tell they have left the question.

/** Matches the warm-dialog-*-out keyframes in globals.css. */
const EXIT_MS = 200;

type Props = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
  /**
   * The dialog began as the one place that asks before destroying something.
   * Renaming a chat wanted the same frame with a field in it and a button that
   * is not red, so the frame took three small options: content between the
   * text and the buttons, a tone for the confirm button, and the icon. Every
   * existing caller passes none and gets the warning it always had.
   */
  children?: ReactNode;
  tone?: "danger" | "primary";
  icon?: ReactNode;
  /** Where focus lands on open: the cancel button (default) or the content slot. */
  initialFocus?: "cancel" | "content";
};

export default function WarmConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  busy = false,
  children,
  tone = "danger",
  icon,
  initialFocus = "cancel",
}: Props) {
  const titleId = useId();
  const bodyId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  // Remembered on open so focus can go back where it came from. Without this
  // the caret lands on <body> after closing and the next Tab starts from the
  // top of the page.
  const openerRef = useRef<HTMLElement | null>(null);
  const slotRef = useRef<HTMLDivElement | null>(null);

  // The dialog used to vanish the frame `open` went false — it popped in and
  // simply disappeared. It now stays mounted for the length of the exit
  // animation. Derived during render rather than in an effect, so the closing
  // frame is the very next paint; the timer (not animationend) ends it, so
  // reduced-motion, where the animation is all but zero, cannot strand an
  // invisible backdrop over the page.
  const [prevOpen, setPrevOpen] = useState(open);
  const [closing, setClosing] = useState(false);
  if (open !== prevOpen) {
    setPrevOpen(open);
    setClosing(!open);
  }
  useEffect(() => {
    if (!closing) return;
    const timer = window.setTimeout(() => setClosing(false), EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [closing]);


  const focusables = useCallback(() => {
    const root = dialogRef.current;
    if (!root) return [] as HTMLElement[];
    return Array.from(
      root.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex='-1'])"),
    );
  }, []);

  useEffect(() => {
    if (!open) return;
    openerRef.current = document.activeElement as HTMLElement | null;
    // Deferred a frame: the element is being animated in and is not focusable
    // in the same tick it is inserted.
    const timer = window.setTimeout(() => {
      const field = initialFocus === "content"
        ? slotRef.current?.querySelector<HTMLElement>("input, textarea, button")
        : null;
      (field ?? cancelRef.current)?.focus();
      if (field instanceof HTMLInputElement) field.select();
    }, 0);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      // Wrapping by hand rather than relying on the browser, which would walk
      // out of the dialog and into the page underneath.
      if (event.shiftKey && (active === first || !dialogRef.current?.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);

    // The page behind a modal should not scroll under it.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      openerRef.current?.focus?.();
    };
  }, [open, focusables, onCancel, initialFocus]);

  // No DOM to portal into while the server renders. Nothing is lost by
  // returning null there: the dialog is always closed on first paint, so the
  // server and the client agree.
  if ((!open && !closing) || typeof document === "undefined") return null;

  return createPortal(
    <div
      className={`warm-dialog-backdrop${closing ? " is-closing" : ""}`}
      // Clicking away from a destructive question means "no". Guarded on the
      // target so a click that starts inside the dialog and drifts onto the
      // backdrop does not count as a dismissal.
      onMouseDown={(event) => {
        if (!closing && event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        className="warm-dialog"
      >
        <span className="warm-dialog-icon" aria-hidden="true">
          {icon ?? <TriangleAlert size={28} strokeWidth={2.75} />}
        </span>
        <h2 id={titleId} className="warm-dialog-title">
          {title}
        </h2>
        <p id={bodyId} className="warm-dialog-body">
          {description}
        </p>
        {children ? (
          <div ref={slotRef} className="warm-dialog-slot">
            {children}
          </div>
        ) : null}
        <div className="warm-dialog-actions">
          <button
            type="button"
            className={`warm-dialog-btn ${tone === "primary" ? "warm-dialog-btn-primary" : "warm-dialog-btn-danger"}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {confirmLabel}
          </button>
          <button
            ref={cancelRef}
            type="button"
            className="warm-dialog-btn warm-dialog-btn-ghost"
            onClick={onCancel}
            disabled={busy}
          >
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
