'use client';

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Menu } from 'lucide-react';
import { useSidebar } from '@/src/providers/SidebarProvider';
import { useLanguage } from '@/src/providers/LanguageProvider';

// Phones and tablets below lg: a tab sticking out of the left edge, with the
// three-line menu icon, opens the menu. It replaced the 56px top bar on
// 19 ก.ย. 2569 — the owner wanted that height back for the page; the bar's bell
// did nothing, and the account menu now sits at the foot of the menu, the same
// place as on a computer.
//
// It starts at the top-left, where it covers the first control on some pages
// (a search box, "ทุกโซน"), so a long press lifts it and it can be dragged up
// or down. It stays on the left edge; the height is kept on this device.

const STORAGE_KEY = 'dishy.navHandleTop';
const HOLD_MS = 350;
const MOVE_CANCEL_PX = 8;
const EDGE_GAP = 8;
const HANDLE_H = 40;

function clampTop(top: number) {
  const max = window.innerHeight - HANDLE_H - EDGE_GAP;
  return Math.round(Math.min(Math.max(top, EDGE_GAP), Math.max(EDGE_GAP, max)));
}

export default function MobileNavHandle() {
  const { mobileOpen, setMobileOpen } = useSidebar();
  const { language } = useLanguage();
  // The dragged height is written straight onto the element: no re-render per
  // frame, and the server render keeps the default place (top-left, below the
  // safe area) so it matches the first client render.
  const buttonRef = useRef<HTMLButtonElement>(null);
  const placeAt = (top: number) => {
    if (buttonRef.current) buttonRef.current.style.top = `${clampTop(top)}px`;
  };
  const [dragging, setDragging] = useState(false);
  const press = useRef<{ id: number; startY: number; offset: number; timer: number | null; lifted: boolean } | null>(null);
  const swallowClick = useRef(false);

  useEffect(() => {
    try {
      const saved = Number(window.localStorage.getItem(STORAGE_KEY));
      if (saved > 0) placeAt(saved);
    } catch {
      // No storage (private mode): the default place is fine.
    }
    const onResize = () => {
      const current = buttonRef.current?.style.top;
      if (current) placeAt(parseFloat(current));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const endPress = () => {
    const current = press.current;
    if (current?.timer) window.clearTimeout(current.timer);
    press.current = null;
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const target = event.currentTarget;
    const pointerId = event.pointerId;
    press.current = {
      id: pointerId,
      startY: event.clientY,
      offset: event.clientY - rect.top,
      lifted: false,
      timer: window.setTimeout(() => {
        if (!press.current) return;
        press.current.lifted = true;
        press.current.timer = null;
        try {
          target.setPointerCapture(pointerId);
        } catch {
          // The pointer already left; the drag simply does not start.
        }
        setDragging(true);
        navigator.vibrate?.(10);
      }, HOLD_MS),
    };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = press.current;
    if (!current || current.id !== event.pointerId) return;
    if (!current.lifted) {
      // Moved before the hold finished: a scroll or a slip, not a drag.
      if (Math.abs(event.clientY - current.startY) > MOVE_CANCEL_PX) endPress();
      return;
    }
    placeAt(event.clientY - current.offset);
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = press.current;
    if (!current || current.id !== event.pointerId) return;
    if (current.lifted) {
      swallowClick.current = true;
      setDragging(false);
      // style.top, not the measured box: the lifted tab is still scaled up here.
      const placed = parseFloat(event.currentTarget.style.top);
      try {
        if (placed > 0) window.localStorage.setItem(STORAGE_KEY, String(Math.round(placed)));
      } catch {
        // Not kept past this visit; still moved for now.
      }
    }
    endPress();
  };

  const onPointerCancel = () => {
    if (press.current?.lifted) setDragging(false);
    endPress();
  };

  return (
    <button
      type="button"
      onClick={() => {
        if (swallowClick.current) {
          swallowClick.current = false;
          return;
        }
        setMobileOpen(true);
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onContextMenu={(event) => event.preventDefault()}
      aria-label={language === 'th' ? 'เปิดเมนู' : 'Open menu'}
      aria-hidden={mobileOpen}
      tabIndex={mobileOpen ? -1 : undefined}
      ref={buttonRef}
      className={`fixed left-0 top-[max(0.75rem,env(safe-area-inset-top))] z-30 flex origin-left h-10 w-11 touch-none select-none items-center justify-center rounded-r-xl border border-l-0 bg-white/90 text-gray-500 backdrop-blur transition-[opacity,box-shadow,transform,border-color] duration-200 [-webkit-touch-callout:none] active:bg-gray-100 dark:bg-gray-900/90 dark:text-gray-300 lg:hidden ${
        dragging
          ? 'scale-110 border-orange-300 shadow-xl dark:border-orange-700'
          : 'border-gray-200 shadow-md dark:border-gray-800'
      } ${mobileOpen ? 'pointer-events-none opacity-0' : 'opacity-100'}`}
    >
      <Menu className="h-5 w-5" strokeWidth={2.25} />
    </button>
  );
}
