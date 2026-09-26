'use client';

import { useEffect, useRef } from 'react';
import { RAIL_FULL_QUERY, RAIL_ICONS_QUERY, RAIL_ICONS_WIDTH } from '@/src/lib/navRail';

export default function ContentWrapper({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const html = document.documentElement;
    const full = window.matchMedia(RAIL_FULL_QUERY);
    const icons = window.matchMedia(RAIL_ICONS_QUERY);

    const update = () => {
      if (!ref.current) return;
      if (full.matches) {
        // Read CSS variable set imperatively by SidebarProvider (no React re-render needed)
        ref.current.style.marginLeft = html.style.getPropertyValue('--sidebar-w') || '235px';
      } else if (icons.matches) {
        ref.current.style.marginLeft = RAIL_ICONS_WIDTH;
      } else {
        ref.current.style.marginLeft = '0px';
      }
    };

    // Watch for CSS variable changes on <html> style attribute
    const observer = new MutationObserver(update);
    observer.observe(html, { attributes: true, attributeFilter: ['style'] });

    full.addEventListener('change', update);
    icons.addEventListener('change', update);
    update();

    return () => {
      observer.disconnect();
      full.removeEventListener('change', update);
      icons.removeEventListener('change', update);
    };
  }, []);

  return (
    <div
      ref={ref}
      className="flex-1 flex min-w-0 max-w-full flex-col overflow-x-clip transition-[margin-left] duration-300 ease-in-out"
    >
      {children}
    </div>
  );
}
