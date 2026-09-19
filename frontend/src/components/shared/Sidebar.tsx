'use client';

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
  id: 'work' | 'management' | 'general';
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
          icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5"><path d="M4 9h16"/><path d="M5 9l1-5h12l1 5"/><path d="M6 9v10a1 1 0 001 1h10a1 1 0 001-1V9"/><path d="M9 13h6"/><path d="M9 17h4"/></svg>,
        },
        {
          label: language === 'th' ? 'จอครัว' : 'Kitchen',
          href: '/kitchen',
          permission: 'view_kitchen',
          icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5"><path d="M6 2v20"/><path d="M18 2v20"/><path d="M6 8h12"/><path d="M6 16h12"/><path d="M9 5h6"/><path d="M9 19h6"/></svg>,
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
          icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="M9 12h6M9 16h4"/></svg>,
        },
        {
          label: language === 'th' ? 'ผังโต๊ะ' : 'Tables',
          href: '/tables',
          permission: ['manage_table', 'view_tables'],
          icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5"><rect x="3" y="3" width="18" height="4" rx="1"/><path d="M5 7v13M19 7v13M8 20h8"/></svg>,
        },
        {
          label: language === 'th' ? 'คลังออเดอร์' : 'Order archive',
          href: '/orders',
          permission: ['view_orders', 'take_order'],
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
    {
      id: 'general',
      items: [
        {
          label: language === 'th' ? 'ตั้งค่า' : 'Settings',
          href: '/settings',
          icon: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>,
          subItems: [
            {
              label: language === 'th' ? 'ข้อมูลบัญชี' : 'My Account',
              href: '/settings/account',
            },
            {
              label: language === 'th' ? 'จัดการร้านและภาษี' : 'Restaurant & Taxes',
              href: '/settings/restaurant',
              permission: 'manage_restaurant_settings',
            },
            {
              label: language === 'th' ? 'ภาษาและการแสดงผล' : 'Display settings',
              href: '/settings/display',
            },
          ] as const,
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

  return (
    <nav className="sidebar-nav-scroll flex-1 overflow-y-auto overscroll-contain px-3 py-3 [@media(max-height:760px)]:py-2">
      {visibleNav.map(({ id, items }, groupIndex) => (
        <div key={id}>
          {groupIndex > 0 && (
            <div
              role="separator"
              aria-orientation="horizontal"
              className="mx-1 my-2 border-t border-[var(--rail-border)] [@media(max-height:760px)]:my-1.5"
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

              const itemClassName = `relative flex w-full items-center rounded-md px-2.5 py-2 text-[12px] font-medium transition-[background-color,border-color,box-shadow,color,gap] duration-200 ease-out motion-reduce:transition-none [@media(max-height:760px)]:py-1.5 ${
                active
                  ? 'border border-transparent bg-[var(--rail-active-bg)] text-[var(--rail-active-fg)] shadow-[0_0_6px_rgba(15,23,42,0.18)] active:shadow-[0_0_3px_rgba(15,23,42,0.16)] dark:border-orange-700 dark:shadow-[0_0_7px_rgba(249,115,22,0.24)] dark:active:shadow-[0_0_3px_rgba(249,115,22,0.18)]'
                  : 'border border-transparent text-[var(--rail-fg)] hover:border-[var(--rail-border)] hover:bg-[var(--rail-hover-bg)] hover:text-[var(--rail-hover-fg)]'
              } ${collapsed ? 'justify-center gap-0' : 'gap-2.5'} ${comingSoon ? 'cursor-default opacity-50 hover:bg-transparent hover:text-[var(--rail-fg-dim)]' : ''}`;

              const content = (
                <>
                  <span className={`grid h-5 w-5 shrink-0 place-items-center ${active ? 'text-[var(--rail-active-fg)]' : 'text-[var(--rail-fg-muted)]'}`}>{icon}</span>
                  <span
                    className={`flex min-w-0 flex-1 items-center justify-between gap-2 transition-all duration-300 ${
                      collapsed ? 'w-0 opacity-0 pointer-events-none overflow-hidden' : 'w-auto opacity-100'
                    }`}
                  >
                    <span className="truncate leading-[1.6]">{label}</span>
                    {comingSoon && <span className="shrink-0 text-[10px] font-medium text-[var(--rail-fg-dim)]">{language === 'th' ? 'เร็วๆ นี้' : 'Soon'}</span>}
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
                              className={`flex items-center rounded-md px-2.5 py-1.5 text-[12px] font-medium transition-colors ${
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

function useOpenState() {
  const { activeMembership } = useAuth();
  const { language } = useLanguage();
  const openTime = activeMembership?.restaurant?.open_time ?? '';
  const closeTime = activeMembership?.restaurant?.close_time ?? '';
  if (!/^\d{2}:\d{2}$/.test(openTime) || !/^\d{2}:\d{2}$/.test(closeTime)) return null;
  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes();
  const toMinutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
  const open = toMinutes(openTime);
  const close = toMinutes(closeTime);
  // A close time earlier than the open time means the shift runs past midnight.
  const isOpen = close > open ? minutes >= open && minutes < close : minutes >= open || minutes < close;
  return language === 'th'
    ? `${isOpen ? 'เปิดอยู่' : 'ปิดอยู่'} · ${isOpen ? 'ปิด' : 'เปิด'} ${isOpen ? closeTime : openTime}`
    : `${isOpen ? 'Open' : 'Closed'} · ${isOpen ? 'closes' : 'opens'} ${isOpen ? closeTime : openTime}`;
}

function RestaurantSwitcherCard({ collapsed }: { collapsed: boolean }) {
  const { activeMembership } = useAuth();
  const { language } = useLanguage();
  const name = activeMembership?.restaurant?.name ?? (language === 'th' ? 'เลือกร้าน' : 'Select restaurant');
  const detail = useOpenState();
  const initial = name.trim().charAt(0) || '?';

  return (
    <Link
      href="/restaurants"
      title={collapsed ? name : undefined}
      aria-label={language === 'th' ? 'เปลี่ยนร้าน' : 'Switch restaurant'}
      className={`flex min-w-0 items-center rounded-md border border-transparent transition-colors hover:border-[var(--rail-border)] hover:bg-[var(--rail-hover-bg)] ${collapsed ? 'justify-center p-1' : 'min-w-0 flex-1 gap-2 p-1.5'}`}
    >
      <span
        aria-hidden="true"
        className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-md text-[15px] font-bold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]"
        style={{ background: 'linear-gradient(135deg,#f97316,#c2410c)' }}
      >
        {initial}
      </span>
      {!collapsed && (
        <>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[12px] font-bold leading-[1.6] text-[var(--rail-fg)]">{name}</span>
            {detail && <span className="truncate text-[11px] leading-[1.6] text-[var(--rail-fg-muted)] [@media(max-height:760px)]:hidden">{detail}</span>}
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
  const mobileDrawerRef = useRef<HTMLElement>(null);
  const mobileBackdrop = useBackdropClose(() => setMobileOpen(false));
  const collapseTitle = collapsed
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
      {mobileOpen && (
        <div
          {...mobileBackdrop}
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden"
        />
      )}

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
        className={`
          fixed left-0 top-0 z-[var(--z-modal)] flex h-dvh w-64 flex-col border-r border-[var(--rail-border)] bg-[var(--rail-bg)] shadow-2xl transition-transform duration-300 ease-in-out will-change-transform lg:hidden
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full pointer-events-none'}
        `}
      >
        <div className="dashboard-shell-row border-b border-[var(--rail-border)] flex shrink-0 items-center justify-between gap-2 px-3">
          <Link
            href={restaurantPageHref("/home")}
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

        {/* The restaurant and the person at the foot, as on a computer. The
            account menu used to be the avatar on the phone top bar. */}
        <div className="flex shrink-0 flex-col gap-0.5 border-t border-[var(--rail-border)] px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          <RestaurantSwitcherCard collapsed={false} />
          <DashboardAccountMenu variant="rail" />
        </div>
      </aside>

      <aside
        data-nav-rail=""
        className={`
          dashboard-shell-border-r fixed left-0 top-0 z-30 hidden h-dvh flex-col overflow-hidden bg-[var(--rail-bg)] lg:flex
          transition-[width] duration-300 ease-in-out will-change-[width]
          ${collapsed ? 'w-[68px]' : 'w-[220px]'}
        `}
      >
        <div className="flex h-[62px] shrink-0 flex-col justify-center px-3">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setCollapsed(!collapsed)}
              /* 44px wide with the icon centred puts its axis at x=34, the same
                 place the collapsed rail centres every nav icon. Widening rather
                 than re-aligning keeps the left edge fixed, so the icon does not
                 shift when the rail collapses. */
              className="inline-flex h-9 w-11 shrink-0 items-center justify-center rounded-md text-[var(--rail-fg-muted)] transition-colors hover:bg-[var(--rail-hover-bg)]"
              title={collapseTitle}
              aria-label={collapseTitle}
              aria-expanded={!collapsed}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="h-5 w-5" aria-hidden="true">
                <line x1="4" y1="6" x2="20" y2="6" />
                <line x1="4" y1="12" x2="20" y2="12" />
                <line x1="4" y1="18" x2="20" y2="18" />
              </svg>
            </button>
            <Link
              href={restaurantPageHref("/home")}
              aria-label="Dishy"
              tabIndex={collapsed ? -1 : undefined}
              className={`flex min-w-0 items-center gap-2 overflow-hidden transition-all duration-300 ease-in-out ${
                collapsed ? 'w-0 opacity-0 pointer-events-none' : 'w-auto opacity-100'
              }`}
            >
              <AppLogo size={32} />
              <AppWordmark height={22} className="shrink-0 text-[var(--rail-fg)]" />
            </Link>
          </div>
        </div>

        <NavLinks collapsed={collapsed} />

        <div className={`shrink-0 border-t border-[var(--rail-border)] px-3 py-2 flex flex-col ${collapsed ? 'items-center gap-1' : 'gap-0.5'}`}>
          <RestaurantSwitcherCard collapsed={collapsed} />
          <DashboardAccountMenu variant={collapsed ? 'icon' : 'rail'} />
        </div>
      </aside>
    </>
  );
}
