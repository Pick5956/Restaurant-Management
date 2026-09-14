'use client';

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { User } from '../types/auth';
import { Membership } from '../types/restaurant';
import { getCurrentUser } from '../lib/auth';
import { getMyMemberships } from '../lib/restaurant';
import { authRepository } from '../app/repositories/authRepository';
import { restaurantRepository } from '../app/repositories/restaurantRepository';
import AuthModal from '../components/auth/AuthModal';
import { useConfirm } from '../components/shared/FeedbackProvider';
import { useLanguage } from './LanguageProvider';
import { safeInternalPath } from '../lib/safeRedirect';

interface AuthContextType {
  user: User | null;
  memberships: Membership[];
  activeMembership: Membership | null;
  loading: boolean;
  logout: () => void;
  openLoginModal: (redirectTo?: string) => void;
  closeLoginModal: () => void;
  updateUser: (user: User) => void;
  setActiveRestaurant: (restaurantId: number) => void;
  refreshMemberships: () => Promise<Membership[]>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  memberships: [],
  activeMembership: null,
  loading: true,
  logout: () => {},
  openLoginModal: () => {},
  closeLoginModal: () => {},
  updateUser: () => {},
  setActiveRestaurant: () => {},
  refreshMemberships: async () => [],
});

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const confirm = useConfirm();
  const { language } = useLanguage();
  const [user, setUser] = useState<User | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [loginRedirectTo, setLoginRedirectTo] = useState<string | undefined>(undefined);

  const applyMemberships = useCallback((list: Membership[]) => {
    setMemberships(list);
    const stored = restaurantRepository.getActiveId();
    const inList = list.find((m) => m.restaurant_id === stored);
    if (inList) {
      setActiveId(inList.restaurant_id);
    } else if (list.length === 1) {
      restaurantRepository.setActiveId(list[0].restaurant_id, list[0].restaurant?.slug);
      setActiveId(list[0].restaurant_id);
    } else {
      restaurantRepository.clearActiveId();
      setActiveId(null);
    }
  }, []);

  const refreshMemberships = useCallback(async () => {
    try {
      const res = await getMyMemberships();
      const list = res?.data?.memberships ?? [];
      applyMemberships(list);
      return list;
    } catch {
      applyMemberships([]);
      return [];
    }
  }, [applyMemberships]);

  const fetchUser = useCallback(async () => {
    const token = authRepository.getToken();
    if (!token) {
      setUser(null);
      setMemberships([]);
      setActiveId(null);
      setLoading(false);
      return null;
    }

    try {
      const res = await getCurrentUser();
      if (res && res.data) {
        setUser(res.data);
        await refreshMemberships();
        return res.data;
      }
    } catch {
      authRepository.clearToken();
      restaurantRepository.clearActiveId();
      setUser(null);
      setMemberships([]);
      setActiveId(null);
    } finally {
      setLoading(false);
    }
    return null;
  }, [refreshMemberships]);

  useEffect(() => {
    const loadTimer = window.setTimeout(() => void fetchUser(), 0);
    return () => window.clearTimeout(loadTimer);
  }, [fetchUser]);

  const logout = async () => {
    const confirmed = await confirm({
      title: language === 'th' ? 'ออกจากระบบ?' : 'Sign out?',
      message: language === 'th'
        ? 'คุณจะต้องเข้าสู่ระบบใหม่เพื่อกลับมาใช้งานร้านนี้'
        : 'You will need to sign in again to access this restaurant workspace.',
      confirmLabel: language === 'th' ? 'ออกจากระบบ' : 'Sign out',
      cancelLabel: language === 'th' ? 'ยกเลิก' : 'Cancel',
      tone: 'danger',
    });
    if (!confirmed) return;
    authRepository.clearToken();
    restaurantRepository.clearActiveId();
    setUser(null);
    setMemberships([]);
    setActiveId(null);
    window.location.href = '/';
  };

  const openLoginModal = (redirectTo?: string) => {
    setLoginRedirectTo(safeInternalPath(redirectTo));
    setIsLoginModalOpen(true);
  };
  const closeLoginModal = () => {
    setIsLoginModalOpen(false);
    setLoginRedirectTo(undefined);
  };
  const updateUser = (nextUser: User) => setUser(nextUser);

  const handleAuthenticated = (authenticatedUser?: User, freshMemberships?: Membership[]) => {
    if (authenticatedUser) {
      setUser(authenticatedUser);
    }
    if (freshMemberships) {
      applyMemberships(freshMemberships);
    } else {
      refreshMemberships();
    }
    setLoading(false);
  };

  const setActiveRestaurant = (restaurantId: number) => {
    const membership = memberships.find((m) => m.restaurant_id === restaurantId);
    if (!membership) return;
    restaurantRepository.setActiveId(restaurantId, membership.restaurant?.slug);
    setActiveId(restaurantId);
  };

  const activeMembership = memberships.find((m) => m.restaurant_id === activeId) ?? null;

  return (
    <AuthContext.Provider
      value={{
        user,
        memberships,
        activeMembership,
        loading,
        logout,
        openLoginModal,
        closeLoginModal,
        updateUser,
        setActiveRestaurant,
        refreshMemberships,
      }}
    >
      {children}
      <AuthModal
        isOpen={isLoginModalOpen}
        onClose={closeLoginModal}
        initialMode="login"
        onAuthenticated={handleAuthenticated}
        redirectTo={loginRedirectTo}
      />
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
