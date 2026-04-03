'use client';

import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';

interface SidebarCtx {
  mobileOpen: boolean;
  setMobileOpen: (v: boolean) => void;
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
}

const SidebarContext = createContext<SidebarCtx>({
  mobileOpen: false, setMobileOpen: () => {},
  collapsed: false,  setCollapsed: () => {},
});

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    document.documentElement.style.setProperty('--sidebar-w', '240px');
  }, []);

  const handleSetCollapsed = useCallback((v: boolean) => {
    setCollapsed(v);
    document.documentElement.style.setProperty('--sidebar-w', v ? '68px' : '240px');
  }, []);

  return (
    <SidebarContext.Provider value={{ mobileOpen, setMobileOpen, collapsed, setCollapsed: handleSetCollapsed }}>
      {children}
    </SidebarContext.Provider>
  );
}

export const useSidebar = () => useContext(SidebarContext);
