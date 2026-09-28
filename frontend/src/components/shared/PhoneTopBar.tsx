'use client';

import Link from 'next/link';
import { Menu } from 'lucide-react';
import { useRestaurantNav } from '@/src/hooks/useRestaurantNav';
import { useSidebar } from '@/src/providers/SidebarProvider';
import { useAuth } from '@/src/providers/AuthProvider';
import { useLanguage } from '@/src/providers/LanguageProvider';
import AppLogo from '@/src/components/shared/AppLogo';
import AppWordmark from '@/src/components/shared/AppWordmark';
import DashboardAccountMenu from '@/src/components/shared/DashboardAccountMenu';
import { getDefaultWorkspaceRoute } from '@/src/lib/workMode';

// The phone's top bar (below the tablet breakpoint, 744px), back on
// 28 ก.ย. 2569 in the shape the owner pointed at (MangaDex): the menu button,
// then the Dishy mark, and the person on the right with their name. No search.
// It replaces the tab that stuck out of the left edge, and the account menu
// left the menu drawer's foot for it.
//
// Its height is --phone-bar-h (globals.css), which also moves every page's own
// pinned toolbar ([data-shell-sticky]) down to sit under it. Frosted like
// those toolbars, so the two read as one surface.
export default function PhoneTopBar() {
  const { href: restaurantPageHref } = useRestaurantNav();
  const { setMobileOpen } = useSidebar();
  const { activeMembership } = useAuth();
  const { language } = useLanguage();
  // The mark goes where the menu's own mark goes: the member's workspace.
  const landingHref = getDefaultWorkspaceRoute(activeMembership);

  return (
    <>
      <header className="fixed inset-x-0 top-0 z-30 border-b border-[color:var(--dashboard-shell-border)] bg-white/82 pt-[env(safe-area-inset-top)] backdrop-blur-md dark:bg-[#0f0f0f]/82 tablet:hidden">
        <div className="flex h-14 items-center gap-1 px-2">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            aria-label={language === 'th' ? 'เปิดเมนู' : 'Open menu'}
            className="ui-press grid h-10 w-10 shrink-0 place-items-center rounded-full text-gray-700 transition-colors hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            <Menu className="h-[22px] w-[22px]" aria-hidden="true" />
          </button>
          <Link
            href={restaurantPageHref(landingHref)}
            aria-label="Dishy"
            className="flex min-w-0 shrink-0 items-center gap-2 rounded-md px-1"
          >
            <AppLogo size={30} />
            <AppWordmark height={20} className="shrink-0 text-gray-950 dark:text-white" />
          </Link>
          <div className="ml-auto flex min-w-0 justify-end">
            <DashboardAccountMenu variant="bar" />
          </div>
        </div>
      </header>
      {/* Holds the bar's place in the page, so content starts under it. */}
      <div aria-hidden="true" className="h-[var(--phone-bar-h)] tablet:hidden" />
    </>
  );
}
