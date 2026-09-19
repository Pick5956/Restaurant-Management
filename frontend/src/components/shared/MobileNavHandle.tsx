'use client';

import { useEffect, useRef, useState } from 'react';
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
//
// Touch goes through native touch listeners that cancel the browser's own
// handling from the first touch. With pointer events alone, iPhone Safari
// claimed the long press for itself and the drag never started (found on the
// owner's phone the same day). Mouse uses pointer events and click.

const STORAGE_KEY = 'dishy.navHandleTop';
const HOLD_MS = 350;
const MOVE_CANCEL_PX = 8;
const EDGE_GAP = 8;
const HANDLE_H = 40;

function clampTop(top: number) {
  const max = window.innerHeight - HANDLE_H - EDGE_GAP;
  return Math.round(Math.min(Math.max(top, EDGE_GAP), Math.max(EDGE_GAP, max)));
}

type Press = { startY: number; offset: number; timer: number | null; lifted: boolean; cancelled: boolean };

export default function MobileNavHandle() {
  const { mobileOpen, setMobileOpen } = useSidebar();
  const { language } = useLanguage();
  const [dragging, setDragging] = useState(false);
  // The dragged height is written straight onto the element: no re-render per
  // frame, and the server render keeps the default place (top-left, below the
  // safe area) so it matches the first client render.
  const buttonRef = useRef<HTMLButtonElement>(null);
  const swallowClick = useRef(false);
  const openMenu = useRef(setMobileOpen);
  useEffect(() => {
    openMenu.current = setMobileOpen;
  }, [setMobileOpen]);

  useEffect(() => {
    const button = buttonRef.current;
    if (!button) return;
    let press: Press | null = null;

    const placeAt = (top: number) => {
      button.style.top = `${clampTop(top)}px`;
    };
    const save = () => {
      // style.top, not the measured box: the lifted tab is still scaled up here.
      const placed = parseFloat(button.style.top);
      try {
        if (placed > 0) window.localStorage.setItem(STORAGE_KEY, String(Math.round(placed)));
      } catch {
        // Not kept past this visit; still moved for now.
      }
    };
    const begin = (clientY: number) => {
      const rect = button.getBoundingClientRect();
      const current: Press = { startY: clientY, offset: clientY - rect.top, lifted: false, cancelled: false, timer: null };
      current.timer = window.setTimeout(() => {
        current.timer = null;
        if (current.cancelled) return;
        current.lifted = true;
        setDragging(true);
        navigator.vibrate?.(10);
      }, HOLD_MS);
      press = current;
    };
    const move = (clientY: number) => {
      const current = press;
      if (!current || current.cancelled) return;
      if (!current.lifted) {
        // Moved before the hold finished: a slip, neither a tap nor a drag.
        if (Math.abs(clientY - current.startY) > MOVE_CANCEL_PX) current.cancelled = true;
        return;
      }
      placeAt(clientY - current.offset);
    };
    // Ends the press; "tap" when it was a plain short touch, "drag" when it
    // moved the tab.
    const finish = (): 'tap' | 'drag' | 'none' => {
      const current = press;
      press = null;
      if (!current) return 'none';
      if (current.timer) window.clearTimeout(current.timer);
      if (current.lifted) {
        setDragging(false);
        save();
        return 'drag';
      }
      return current.cancelled ? 'none' : 'tap';
    };

    try {
      const saved = Number(window.localStorage.getItem(STORAGE_KEY));
      if (saved > 0) placeAt(saved);
    } catch {
      // No storage (private mode): the default place is fine.
    }

    const onTouchStart = (event: TouchEvent) => {
      event.preventDefault();
      begin(event.touches[0].clientY);
    };
    const onTouchMove = (event: TouchEvent) => {
      event.preventDefault();
      move(event.touches[0].clientY);
    };
    const onTouchEnd = (event: TouchEvent) => {
      event.preventDefault();
      if (finish() === 'tap') openMenu.current(true);
    };
    const onTouchCancel = () => {
      finish();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' || event.button !== 0) return;
      begin(event.clientY);
      const onMove = (moveEvent: PointerEvent) => move(moveEvent.clientY);
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        if (finish() === 'drag') swallowClick.current = true;
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    };
    const onResize = () => {
      if (button.style.top) placeAt(parseFloat(button.style.top));
    };

    button.addEventListener('touchstart', onTouchStart, { passive: false });
    button.addEventListener('touchmove', onTouchMove, { passive: false });
    button.addEventListener('touchend', onTouchEnd, { passive: false });
    button.addEventListener('touchcancel', onTouchCancel);
    button.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('resize', onResize);
    return () => {
      button.removeEventListener('touchstart', onTouchStart);
      button.removeEventListener('touchmove', onTouchMove);
      button.removeEventListener('touchend', onTouchEnd);
      button.removeEventListener('touchcancel', onTouchCancel);
      button.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return (
    <button
      ref={buttonRef}
      type="button"
      // Mouse and keyboard only: a touch never makes a click here, because
      // touchstart is cancelled; a tap opens the menu from touchend instead.
      onClick={() => {
        if (swallowClick.current) {
          swallowClick.current = false;
          return;
        }
        setMobileOpen(true);
      }}
      onContextMenu={(event) => event.preventDefault()}
      aria-label={language === 'th' ? 'เปิดเมนู' : 'Open menu'}
      aria-hidden={mobileOpen}
      tabIndex={mobileOpen ? -1 : undefined}
      className={`fixed left-0 top-[max(0.75rem,env(safe-area-inset-top))] z-30 flex h-10 w-11 origin-left touch-none select-none items-center justify-center rounded-r-xl border border-l-0 bg-white/90 text-gray-500 backdrop-blur transition-[opacity,box-shadow,transform,border-color] duration-200 [-webkit-touch-callout:none] active:bg-gray-100 dark:bg-gray-900/90 dark:text-gray-300 lg:hidden ${
        dragging
          ? 'scale-110 border-orange-300 shadow-xl dark:border-orange-700'
          : 'border-gray-200 shadow-md dark:border-gray-800'
      } ${mobileOpen ? 'pointer-events-none opacity-0' : 'opacity-100'}`}
    >
      <Menu className="h-5 w-5" strokeWidth={2.25} />
    </button>
  );
}
