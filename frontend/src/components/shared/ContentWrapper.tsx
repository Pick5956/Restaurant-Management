'use client';

import { useEffect, useRef } from 'react';

export default function ContentWrapper({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const html = document.documentElement;
    const mq = window.matchMedia('(min-width: 1024px)');

    const update = () => {
      if (!ref.current) return;
      if (!mq.matches) {
        ref.current.style.marginLeft = '0px';
        return;
      }
      // Read CSS variable set imperatively by SidebarProvider (no React re-render needed)
      const w = html.style.getPropertyValue('--sidebar-w') || '240px';
      ref.current.style.marginLeft = w;
    };

    // Watch for CSS variable changes on <html> style attribute
    const observer = new MutationObserver(update);
    observer.observe(html, { attributes: true, attributeFilter: ['style'] });

    mq.addEventListener('change', update);
    update();

    return () => {
      observer.disconnect();
      mq.removeEventListener('change', update);
    };
  }, []);

  return (
    <div
      ref={ref}
      className="flex-1 flex flex-col min-w-0"
      style={{ transition: 'margin-left 200ms ease-out' }}
    >
      {children}
    </div>
  );
}
