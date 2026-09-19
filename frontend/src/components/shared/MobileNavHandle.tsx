'use client';

import { ChevronRight } from 'lucide-react';
import { useSidebar } from '@/src/providers/SidebarProvider';
import { useLanguage } from '@/src/providers/LanguageProvider';

// Phones and tablets below lg: a small tab on the left edge opens the menu.
// It replaced the 56px top bar on 19 ก.ย. 2569 — the owner wanted that height
// back for the page; the bar's bell did nothing, and the account menu now
// sits at the foot of the menu, the same place as on a computer.
export default function MobileNavHandle() {
  const { mobileOpen, setMobileOpen } = useSidebar();
  const { language } = useLanguage();

  return (
    <button
      type="button"
      onClick={() => setMobileOpen(true)}
      aria-label={language === 'th' ? 'เปิดเมนู' : 'Open menu'}
      aria-hidden={mobileOpen}
      tabIndex={mobileOpen ? -1 : undefined}
      className={`fixed left-0 top-1/2 z-30 flex h-16 w-6 -translate-y-1/2 items-center justify-center rounded-r-xl border border-l-0 border-gray-200 bg-white/90 text-gray-500 shadow-md backdrop-blur transition-opacity duration-200 active:bg-gray-100 dark:border-gray-800 dark:bg-gray-900/90 dark:text-gray-300 lg:hidden ${
        mobileOpen ? 'pointer-events-none opacity-0' : 'opacity-100'
      }`}
    >
      <ChevronRight className="h-4 w-4" strokeWidth={2.5} />
    </button>
  );
}
