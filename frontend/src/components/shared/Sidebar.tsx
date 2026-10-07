'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRestaurantNav } from '@/src/hooks/useRestaurantNav';
import { useSidebar } from '@/src/providers/SidebarProvider';
import { useAuth } from '@/src/providers/AuthProvider';
import DashboardAccountMenu from '@/src/components/shared/DashboardAccountMenu';
import { useLanguage } from '@/src/providers/LanguageProvider';
import AppLogo from '@/src/components/shared/AppLogo';
import AppWordmark from '@/src/components/shared/AppWordmark';
import { useBackdropClose } from '@/src/hooks/useBackdropClose';
import { can, TEAM_MANAGEMENT_PERMISSIONS } from '@/src/lib/rbac';
import { getDefaultWorkspaceRoute } from '@/src/lib/workMode';
import { branchLabel } from '@/src/lib/branchLabel';
import { useMediaQuery } from '@/src/lib/useMediaQuery';
import { RAIL_ICONS_QUERY } from '@/src/lib/navRail';
import type { Permission } from '@/src/types/auth';

type SubItem = {
  label: string;
  href: string;
  permission?: Permission | Permission[];
};

type NavItem = {
  label: string;
  href: string;
  icon: React.ReactNode;
  badge?: string;
  comingSoon?: boolean;
  permission?: Permission | Permission[];
  ownerOnly?: boolean;
  subItems?: readonly SubItem[];
};

type NavGroup = {
  id: 'work' | 'management';
  items: NavItem[];
};

function buildNav(language: 'th' | 'en'): NavGroup[] {
  return [
    {
      id: 'work',
      items: [
        {
          label: language === 'th' ? 'ภาพรวม' : 'Overview',
          href: '/home',
          permission: 'view_dashboard',
          icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>,
        },
        {
          label: language === 'th' ? 'รับออเดอร์' : 'Take orders',
          href: '/pos/tables',
          permission: 'take_order',
          // An order slip: taking an order is writing one.
          icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 12h6M9 16h4"/></svg>,
        },
        {
          label: language === 'th' ? 'จอครัว' : 'Kitchen',
          href: '/kitchen',
          permission: 'view_kitchen',
          // lucide `ChefHat`.
          icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5"><path d="M17 21a1 1 0 0 0 1-1v-5.35c0-.457.316-.844.727-1.041a4 4 0 0 0-2.134-7.589 5 5 0 0 0-9.186 0 4 4 0 0 0-2.134 7.588c.411.198.727.585.727 1.041V20a1 1 0 0 0 1 1Z"/><path d="M6 17h12"/></svg>,
        },
      ],
    },
    {
      id: 'management',
      items: [
        {
          label: language === 'th' ? 'เมนูอาหาร' : 'Menu',
          href: '/menu',
          permission: ['view_menu', 'manage_menu'],
          // lucide `UtensilsCrossed`.
          icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5"><path d="m16 2-2.3 2.3a3 3 0 0 0 0 4.2l1.8 1.8a3 3 0 0 0 4.2 0L22 8"/><path d="M15 15 3.3 3.3a4.2 4.2 0 0 0 0 6l7.3 7.3c.7.7 2 .7 2.8 0L15 15Zm0 0 7 7"/><path d="m2.1 21.8 6.4-6.3"/><path d="m19 5-7 7"/></svg>,
        },
        {
          label: language === 'th' ? 'ผังโต๊ะ' : 'Tables',
          href: '/tables',
          permission: ['manage_table', 'view_tables'],
          // A floor plan: a square, a round and a long table seen from above.
          // The circle keeps it apart from the overview's four-square grid.
          icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5"><rect x="3" y="3" width="7" height="7" rx="1.5"/><circle cx="17.5" cy="6.5" r="3.5"/><rect x="3" y="14" width="18" height="7" rx="1.5"/></svg>,
        },
        {
          label: language === 'th' ? 'คลังออเดอร์' : 'Order archive',
          href: '/orders',
          // The archive lists paid orders, which the server answers only under
          // view_orders; take_order alone reads the live orders, not this list.
          permission: 'view_orders',
          icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg>,
        },
        {
          label: language === 'th' ? 'คลังวัตถุดิบ' : 'Inventory',
          href: '/inventory',
          permission: ['manage_inventory', 'view_inventory'],
          icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>,
        },
        {
          label: language === 'th' ? 'บันทึกรายจ่าย' : 'Expenses',
          href: '/expenses',
          permission: ['manage_expenses', 'view_reports'],
          icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5"><path d="M3 6h18v13H3z"/><path d="M16 11h5v4h-5a2 2 0 010-4z"/><path d="M3 6l13-3v3"/></svg>,
        },
        {
          label: 'Dishy AI',
          href: '/ai-assistant',
          ownerOnly: true,
          // Same sparkles as the account menu's AI row (lucide `Sparkles`).
          icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/></svg>,
        },
        {
          label: language === 'th' ? 'พนักงาน' : 'Staff',
          href: '/staff',
          permission: [...TEAM_MANAGEMENT_PERMISSIONS],
          icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>,
        },
        {
          label: language === 'th' ? 'รายได้และยอดขาย' : 'Revenue and sales',
          href: '/reports',
          permission: 'view_reports',
          icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>,
        },
      ],
    },
  ] as const;
}

function NavLinks({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  // Nav hrefs stay restaurant-relative ("/menu"); `pathname` here is the page
  // without its /r/<slug> prefix so every comparison below keeps working, and
  // `href` puts the prefix back on the way out.
  const { pagePath: pathname, href: restaurantPageHref } = useRestaurantNav();
  const { language } = useLanguage();
  const { activeMembership } = useAuth();
  const nav = buildNav(language);

  const [userExpanded, setUserExpanded] = useState<Record<string, boolean>>({});

  const toggleExpand = (href: string) => {
    const defaultVal = pathname.startsWith(href);
    const currentVal = userExpanded[href] ?? defaultVal;
    setUserExpanded(prev => ({ ...prev, [href]: !currentVal }));
  };

  const isActive = (href: string) => {
    if (href === "/pos/tables") return pathname.startsWith("/pos/");
    return pathname === href || pathname.startsWith(href + '/');
  };
  const canSee = (permission?: Permission | Permission[]) => {
    if (!permission) return true;
    const permissions = Array.isArray(permission) ? permission : [permission];
    return permissions.some((item) => can(activeMembership, item));
  };
  const visibleNav = nav
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => (!item.ownerOnly || activeMembership?.role?.name === 'owner') && canSee(item.permission)),
    }))
    .filter((section) => section.items.length > 0);

  // Collapsed, every item is a 44px square at 12px from the rail's edge, in px
  // like the 68px rail itself, so each icon sits on the rail's centre line
  // (x=34) — the same line as the menu button above. They used to fill the
  // row and centre the icon in it: when the rail is too short for every item,
  // its scrollbar took ~11px off the right of each row, every icon slid left
  // off the menu button's line, and the highlight came out 33px wide by 36px
  // tall instead of square (owner, 27 ก.ย. 2569). A fixed square leaves the
  // scrollbar its own strip on the right.
  return (
    <nav className={`sidebar-nav-scroll flex-1 overflow-y-auto overscroll-contain py-3 [@media(max-height:760px)]:py-2 ${collapsed ? 'px-[12px]' : 'px-3'}`}>
      {visibleNav.map(({ id, items }, groupIndex) => (
        <div key={id}>
          {groupIndex > 0 && (
            <div
              role="separator"
              aria-orientation="horizontal"
              className={`my-2 border-t border-[var(--rail-border)] [@media(max-height:760px)]:my-1.5 ${collapsed ? 'ml-[4px] w-[36px]' : 'mx-1'}`}
            />
          )}
          <div className="space-y-0.5">
            {items.map((item) => {
              const { label, href, icon, badge, comingSoon, subItems } = item;
              const visibleSubItems = subItems ? subItems.filter(sub => canSee(sub.permission)) : [];
              const visibleSubItemsCount = visibleSubItems.length;
              const hasSubItems = visibleSubItemsCount > 0;
              const isExpanded = userExpanded[href] ?? pathname.startsWith(href);

              // Active if either this parent href matches or one of its child sub-items matches
              const active = !comingSoon && (isActive(href) || (hasSubItems && visibleSubItems.some(sub => isActive(sub.href))));

              const itemClassName = `relative flex items-center rounded-md text-[14px] font-medium transition-[background-color,border-color,box-shadow,color,gap] duration-200 ease-out motion-reduce:transition-none ${
                collapsed
                  ? 'size-[44px] [@media(max-height:760px)]:ml-[2px] [@media(max-height:760px)]:size-[40px]'
                  : 'w-full px-2.5 py-2 [@media(max-height:760px)]:py-1.5'
              } ${
                active
                  ? 'border border-transparent bg-[var(--rail-active-bg)] text-[var(--rail-active-fg)] shadow-[0_0_6px_rgba(15,23,42,0.18)] active:shadow-[0_0_3px_rgba(15,23,42,0.16)] dark:border-orange-700 dark:shadow-[0_0_7px_rgba(249,115,22,0.24)] dark:active:shadow-[0_0_3px_rgba(249,115,22,0.18)]'
                  : 'border border-transparent text-[var(--rail-fg)] hover:border-[var(--rail-border)] hover:bg-[var(--rail-hover-bg)] hover:text-[var(--rail-hover-fg)]'
              } ${collapsed ? 'justify-center gap-0' : 'gap-2.5'} ${comingSoon ? 'cursor-default opacity-50 hover:bg-transparent hover:text-[var(--rail-fg-dim)]' : ''}`;

              const content = (
                <>
                  <span className={`grid h-5 w-5 shrink-0 place-items-center ${active ? 'text-[var(--rail-active-fg)]' : 'text-[var(--rail-fg-muted)]'}`}>{icon}</span>
                  <span
                    className={`flex min-w-0 items-center justify-between gap-2 transition-all duration-300 ${
                      collapsed ? 'w-0 flex-none opacity-0 pointer-events-none overflow-hidden' : 'w-auto flex-1 opacity-100'
                    }`}
                  >
                    <span className="truncate leading-[1.6]">{label}</span>
                    {comingSoon && <span className="shrink-0 text-[11px] font-medium text-[var(--rail-fg-dim)]">{language === 'th' ? 'เร็วๆ นี้' : 'Soon'}</span>}
                    {hasSubItems && (
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        className={`h-3.5 w-3.5 transition-transform duration-200 ${active ? 'text-[var(--rail-active-fg)]' : 'text-[var(--rail-fg-muted)]'} ${isExpanded ? 'rotate-90' : ''}`}
                      >
                        <polyline points="9 18 15 12 9 6"/>
                      </svg>
                    )}
                  </span>
                  {badge && (
                    <span
                      className={`flex h-5 shrink-0 items-center justify-center rounded-full bg-white text-orange-900 transition-all duration-300 ${
                        collapsed 
                          ? 'absolute right-1 top-1 h-2 w-2 p-0 text-[0px] overflow-hidden' 
                          : 'min-w-5 px-1.5 text-[10px] font-semibold'
                      }`}
                    >
                      {collapsed ? '' : badge}
                    </span>
                  )}
                </>
              );

              return (
                <div key={href} className="w-full">
                  {hasSubItems && !collapsed ? (
                    <button
                      type="button"
                      onClick={() => toggleExpand(href)}
                      className={itemClassName}
                    >
                      {content}
                    </button>
                  ) : comingSoon ? (
                    <span title={collapsed ? `${label} (${language === 'th' ? 'เร็วๆ นี้' : 'Soon'})` : undefined} className={itemClassName}>
                      {content}
                    </span>
                  ) : (
                    <Link
                      href={restaurantPageHref(href)}
                      onClick={onNavigate}
                      title={collapsed ? label : undefined}
                      className={itemClassName}
                    >
                      {content}
                    </Link>
                  )}

                  {/* Collapsible Sub-items */}
                  {hasSubItems && !collapsed && (
                    <div
                      style={{ 
                        maxHeight: isExpanded ? `${visibleSubItemsCount * 36 + 8}px` : '0px',
                        transitionProperty: 'max-height',
                        transitionDuration: '300ms',
                        transitionTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)'
                      }}
                      className={`overflow-hidden will-change-[max-height] ${
                        isExpanded ? '' : 'pointer-events-none'
                      }`}
                    >
                      <div className="relative ml-5 border-l border-[var(--rail-border)] pl-3 space-y-0.5 pt-1 pb-1">
                        {visibleSubItems.map(sub => {
                          const subActive = isActive(sub.href);
                          return (
                            <Link
                              key={sub.href}
                              href={restaurantPageHref(sub.href)}
                              onClick={onNavigate}
                              tabIndex={isExpanded ? 0 : -1}
                              className={`flex items-center rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors ${
                                subActive
                                  ? 'bg-[var(--rail-active-bg)] text-[var(--rail-active-fg)]'
                                  : 'text-[var(--rail-fg)] hover:bg-[var(--rail-hover-bg)] hover:text-[var(--rail-hover-fg)]'
                              }`}
                            >
                              {sub.label}
                            </Link>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

function RestaurantSwitcherCard({ collapsed }: { collapsed: boolean }) {
  const { activeMembership } = useAuth();
  const { language } = useLanguage();
  const name = activeMembership?.restaurant?.name ?? (language === 'th' ? 'เลือกร้าน' : 'Select restaurant');
  // The branch, not the opening hours: the owner asked for it on 2026-09-21.
  const detail = activeMembership?.restaurant ? branchLabel(activeMembership.restaurant.branch_name, language) : null;
  const initial = name.trim().charAt(0) || '?';
  const logo = activeMembership?.restaurant?.logo?.trim();

  return (
    <Link
      href="/restaurants"
      title={collapsed ? name : undefined}
      aria-label={language === 'th' ? 'เปลี่ยนร้าน' : 'Switch restaurant'}
      className={`flex min-w-0 items-center rounded-md border border-transparent transition-colors hover:border-[var(--rail-border)] hover:bg-[var(--rail-hover-bg)] ${collapsed ? 'justify-center p-1' : 'min-w-0 flex-1 gap-2 p-1.5'}`}
    >
      {/* The uploaded logo when there is one; the name's first letter otherwise. */}
      {logo ? (
        <Image
          src={logo}
          alt=""
          width={34}
          height={34}
          unoptimized
          className="h-[34px] w-[34px] shrink-0 rounded-md bg-white object-cover"
        />
      ) : (
        <span
          aria-hidden="true"
          className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-md text-[15px] font-bold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]"
          style={{ background: 'linear-gradient(135deg,#f97316,#c2410c)' }}
        >
          {initial}
        </span>
      )}
      {!collapsed && (
        <>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[14px] font-bold leading-[1.6] text-[var(--rail-fg)]">{name}</span>
            {detail && <span className="truncate text-[12px] leading-[1.6] text-[var(--rail-fg-muted)] [@media(max-height:760px)]:hidden">{detail}</span>}
          </span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 shrink-0 text-[var(--rail-fg-muted)]" aria-hidden="true">
            <path d="m7 15 5 5 5-5M7 9l5-5 5 5" />
          </svg>
        </>
      )}
    </Link>
  );
}

export default function Sidebar() {
  const { href: restaurantPageHref, pagePath } = useRestaurantNav();
  const { mobileOpen, setMobileOpen, collapsed, setCollapsed } = useSidebar();
  const { language } = useLanguage();
  const { activeMembership } = useAuth();
  // The logo goes to the member's default workspace, not a hard-coded overview
  // a chef cannot open — the same resolver the restaurant entry redirect uses.
  const landingHref = getDefaultWorkspaceRoute(activeMembership);
  const mobileDrawerRef = useRef<HTMLElement>(null);
  const mobileBackdrop = useBackdropClose(() => setMobileOpen(false));
  // An iPad held upright (744px up to lg) gets the rail as icons only; there is
  // no room to push the page over for the labels, so its menu button opens the
  // full menu over the page instead of widening the rail (owner, 27 ก.ย. 2569).
  const iconsOnly = useMediaQuery(RAIL_ICONS_QUERY);
  const railCollapsed = collapsed || iconsOnly;
  const collapseTitle = iconsOnly
    ? language === 'th' ? 'เปิดเมนู' : 'Open menu'
    : collapsed
    ? language === 'th' ? 'ขยายแถบด้านข้าง' : 'Expand sidebar'
    : language === 'th' ? 'ย่อแถบด้านข้าง' : 'Collapse sidebar';

  // Any page change closes the phone menu, including the account menu's own
  // links, which do not go through NavLinks' onNavigate.
  useEffect(() => {
    setMobileOpen(false);
  }, [pagePath, setMobileOpen]);

  useEffect(() => {
    if (mobileOpen) return;
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement && mobileDrawerRef.current?.contains(activeElement)) {
      activeElement.blur();
    }
  }, [mobileOpen]);

  return (
    <>
      {/* Always mounted so it fades with the slide; it used to mount and
          unmount, so the dark layer snapped on and off and the open/close read
          as a pop rather than a slide (19 ก.ย. 2569). */}
      <div
        {...mobileBackdrop}
        aria-hidden="true"
        className={`fixed inset-0 z-40 bg-black/50 transition-[opacity,visibility] duration-300 ease-out lg:hidden ${
          mobileOpen ? 'visible opacity-100' : 'pointer-events-none invisible opacity-0'
        }`}
      />

      <aside
        data-nav-rail=""
        ref={mobileDrawerRef}
        role="dialog"
        aria-modal={mobileOpen}
        aria-label={language === 'th' ? 'เมนูนำทาง' : 'Navigation menu'}
        inert={!mobileOpen}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setMobileOpen(false);
        }}
        /* Hidden (visibility) once it has slid away, not only moved off
           screen. iPhone Safari (iOS 26) colours its status bar and toolbar
           from fixed boxes at the screen edges; the orange drawer, merely
           translated away, kept both bars orange after it closed
           (19 ก.ย. 2569). Opening shows it at once (visibility is not
           transitioned then); closing keeps it visible until the slide out
           ends, so the motion is unchanged.
           The transition names `translate`, not `transform`: Tailwind v4's
           translate-x-* set the translate property, so with `transform` listed
           the drawer never slid at all — it jumped in and out. */
        className={`
          fixed left-0 top-0 z-[var(--z-modal)] flex h-dvh w-64 flex-col border-r border-[var(--rail-border)] bg-[var(--rail-bg)] will-change-transform lg:hidden
          ${mobileOpen
            ? 'visible translate-x-0 shadow-2xl transition-[translate,box-shadow] duration-[340ms] ease-[cubic-bezier(0.32,0.72,0,1)]'
            : 'invisible -translate-x-full pointer-events-none shadow-none transition-[translate,box-shadow,visibility] duration-[260ms] ease-[cubic-bezier(0.4,0,1,1)]'}
        `}
      >
        <div className="dashboard-shell-row border-b border-[var(--rail-border)] flex shrink-0 items-center justify-between gap-2 px-3">
          <Link
            href={restaurantPageHref(landingHref)}
            aria-label="Dishy"
            onClick={() => setMobileOpen(false)}
            className="flex min-w-0 items-center gap-2 px-1.5"
          >
            <AppLogo size={32} />
            <AppWordmark height={22} className="shrink-0 text-[var(--rail-fg)]" />
          </Link>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setMobileOpen(false)}
              aria-label={language === 'th' ? 'ปิดเมนู' : 'Close menu'}
              className="rounded-md p-1.5 text-[var(--rail-fg-muted)] transition-colors hover:bg-[var(--rail-hover-bg)]"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="h-5 w-5">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </div>

        <NavLinks collapsed={false} onNavigate={() => setMobileOpen(false)} />

        {/* The restaurant and the person at the foot, as on a computer. On a
            phone the person is in the top bar again (28 ก.ย. 2569), so only an
            iPad opening this drawer from its rail shows them here. */}
        <div className="flex shrink-0 flex-col gap-0.5 border-t border-[var(--rail-border)] px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          <RestaurantSwitcherCard collapsed={false} />
          {/* Keyed on the drawer: closing the drawer remounts it, which shuts an
              open account menu too. The menu is portalled to body, so it stayed
              on screen after the drawer slid away (19 ก.ย. 2569). */}
          <div className="hidden tablet:block">
            <DashboardAccountMenu key={mobileOpen ? 'drawer-open' : 'drawer-closed'} variant="rail" />
          </div>
        </div>
      </aside>

      {/* tablet:max-lg:w-[68px] holds the icon width in CSS as well, so the rail
          is never drawn full width on an iPad before iconsOnly is known. */}
      <aside
        data-nav-rail=""
        className={`
          dashboard-shell-border-r fixed left-0 top-0 z-30 hidden h-dvh flex-col overflow-hidden bg-[var(--rail-bg)] tablet:flex
          transition-[width] duration-300 ease-in-out will-change-[width]
          ${railCollapsed ? 'w-[68px]' : 'w-[235px]'} tablet:max-lg:w-[68px]
        `}
      >
        <div className="flex h-[62px] shrink-0 flex-col justify-center px-[12px]">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => (iconsOnly ? setMobileOpen(true) : setCollapsed(!collapsed))}
              /* A 44px square at 12px from the edge puts its axis at x=34, the
                 same line as every collapsed nav item below. In px, as they are:
                 it was w-11/px-3, which are rem and grow with the browser's
                 font size while the 68px rail does not, so with a bigger font
                 the button drifted right of the icons (27 ก.ย. 2569). The left
                 edge stays put, so the icon does not shift when the rail
                 collapses. */
              className="inline-flex size-[44px] shrink-0 items-center justify-center rounded-md text-[var(--rail-fg-muted)] transition-colors hover:bg-[var(--rail-hover-bg)]"
              title={collapseTitle}
              aria-label={collapseTitle}
              aria-expanded={iconsOnly ? mobileOpen : !collapsed}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="h-5 w-5" aria-hidden="true">
                <line x1="4" y1="6" x2="20" y2="6" />
                <line x1="4" y1="12" x2="20" y2="12" />
                <line x1="4" y1="18" x2="20" y2="18" />
              </svg>
            </button>
            <Link
              href={restaurantPageHref(landingHref)}
              aria-label="Dishy"
              tabIndex={railCollapsed ? -1 : undefined}
              className={`flex min-w-0 items-center gap-2 overflow-hidden transition-all duration-300 ease-in-out ${
                railCollapsed ? 'w-0 opacity-0 pointer-events-none' : 'w-auto opacity-100'
              }`}
            >
              <AppLogo size={32} />
              <AppWordmark height={22} className="shrink-0 text-[var(--rail-fg)]" />
            </Link>
          </div>
        </div>

        <NavLinks collapsed={railCollapsed} />

        <div className={`shrink-0 border-t border-[var(--rail-border)] px-3 py-2 flex flex-col ${railCollapsed ? 'items-center gap-1' : 'gap-0.5'}`}>
          <RestaurantSwitcherCard collapsed={railCollapsed} />
          <DashboardAccountMenu variant={railCollapsed ? 'icon' : 'rail'} />
        </div>
      </aside>
    </>
  );
}
