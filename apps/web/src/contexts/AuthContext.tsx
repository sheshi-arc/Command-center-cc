import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { apiRequest } from '../lib/api.js';
import type { UserRole } from '@command-center/shared';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  internType?: 'paid' | 'unpaid' | null;
  pairedPaidInternId?: string | null;
  pairedPaidInternName?: string | null;
  currentLevel?: number;
  marksheetPercentage?: number | null;
  marksheetConfirmed?: boolean;
  avatarUrl?: string | null;
  emailVerified?: boolean;
  mustChangePassword?: boolean;
  emailNotificationsMuted?: boolean;
  pushNotificationsMuted?: boolean;
  hasGoogleCalendar?: boolean;
  icsToken?: string | null;
}

interface AuthContextValue {
  currentUser: User | null;
  isLoading: boolean;
  login: (email: string, pass: string, keepMeSignedIn?: boolean) => Promise<void>;
  register: (name: string, email: string, pass: string) => Promise<void>;
  resendVerification: (email?: string) => Promise<void>;
  acceptInvite: (token: string, password?: string, useMicrosoft?: boolean, microsoftId?: string) => Promise<void>;
  logout: () => Promise<void>;
  changePassword: (newPassword: string, currentPassword?: string) => Promise<void>;
  refreshUser: () => Promise<void>;
  updateCurrentUser: (updates: Partial<User>) => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadUser = useCallback(async () => {
    const token = localStorage.getItem('token');
    if (!token) {
      setIsLoading(false);
      return;
    }

    try {
      const user = await apiRequest<User>('/auth/me');
      setCurrentUser(user);
      localStorage.setItem('user', JSON.stringify(user));
    } catch {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      setCurrentUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUser();
  }, [loadUser]);

  const login = async (email: string, pass: string, keepMeSignedIn?: boolean) => {
    const res = await apiRequest<{ accessToken: string; user: User }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password: pass, keepMeSignedIn }),
    });

    localStorage.setItem('token', res.accessToken);
    localStorage.setItem('user', JSON.stringify(res.user));
    setCurrentUser(res.user);
  };

  const register = async (name: string, email: string, pass: string) => {
    const res = await apiRequest<{ accessToken: string; user: User }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ name, email, password: pass }),
    });

    localStorage.setItem('token', res.accessToken);
    localStorage.setItem('user', JSON.stringify(res.user));
    setCurrentUser(res.user);
  };

  const resendVerification = async (email?: string) => {
    await apiRequest('/auth/resend-verification', {
      method: 'POST',
      body: JSON.stringify({ email: email || currentUser?.email }),
    });
  };

  const acceptInvite = async (token: string, password?: string, useMicrosoft?: boolean, microsoftId?: string) => {
    const res = await apiRequest<{ accessToken: string; user: User }>('/invites/accept', {
      method: 'POST',
      body: JSON.stringify({ token, password, useMicrosoft, microsoftId }),
    });

    localStorage.setItem('token', res.accessToken);
    localStorage.setItem('user', JSON.stringify(res.user));
    setCurrentUser(res.user);
  };

  const changePassword = async (newPassword: string, currentPassword?: string) => {
    await apiRequest('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    if (currentUser) {
      const updated = { ...currentUser, mustChangePassword: false };
      setCurrentUser(updated);
      localStorage.setItem('user', JSON.stringify(updated));
    }
  };

  const logout = async () => {
    try {
      await apiRequest('/auth/logout', { method: 'POST' });
    } catch {
      // ignore
    } finally {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      setCurrentUser(null);
    }
  };

  const updateCurrentUser = (updates: Partial<User>) => {
    setCurrentUser((prev) => {
      if (!prev) return null;
      const next = { ...prev, ...updates };
      localStorage.setItem('user', JSON.stringify(next));
      return next;
    });
  };

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        isLoading,
        login,
        register,
        resendVerification,
        acceptInvite,
        logout,
        changePassword,
        refreshUser: loadUser,
        updateCurrentUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
