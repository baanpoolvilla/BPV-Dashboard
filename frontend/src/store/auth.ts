import { create } from 'zustand';
import { User } from '../api/types';
import { setTokens, clearTokens } from '../api/client';

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: (() => {
    const stored = localStorage.getItem('user');
    return stored ? JSON.parse(stored) : null;
  })(),
  isAuthenticated: !!localStorage.getItem('accessToken'),

  login: async (email, password) => {
    const res = await fetch('http://localhost:3001/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) throw new Error('Invalid credentials');
    const data = await res.json();
    setTokens(data.accessToken, data.refreshToken);
    localStorage.setItem('user', JSON.stringify(data.user));
    set({ user: data.user, isAuthenticated: true });
  },

  logout: () => {
    clearTokens();
    localStorage.removeItem('user');
    set({ user: null, isAuthenticated: false });
  },
}));
