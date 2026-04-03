'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { User } from '../types/auth';
import { getCurrentUser } from '../lib/auth';
import { authRepository } from '../app/repositories/authRepository';
import AuthModal from '../components/auth/AuthModal';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  logout: () => void;
  openLoginModal: () => void;
  closeLoginModal: () => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  logout: () => {},
  openLoginModal: () => {},
  closeLoginModal: () => {},
});

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);

  useEffect(() => {
    const fetchUser = async () => {
      const token = authRepository.getToken();
      if (!token) {
        setLoading(false);
        return;
      }

      try {
        const res = await getCurrentUser();
        // Store user payload returned from the API
        if (res && res.data) {
          setUser(res.data);
        }
      } catch (error) {
        console.error("Failed to fetch user profile", error);
      } finally {
        setLoading(false);
      }
    };

    fetchUser();
  }, []);

  const logout = () => {
    authRepository.clearToken();
    setUser(null);
    window.location.href = '/';
  };

  const openLoginModal = () => setIsLoginModalOpen(true);
  const closeLoginModal = () => setIsLoginModalOpen(false);

  return (
    <AuthContext.Provider value={{ user, loading, logout, openLoginModal, closeLoginModal }}>
      {children}
      <AuthModal 
        isOpen={isLoginModalOpen} 
        onClose={closeLoginModal} 
        initialMode="login" 
      />
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
