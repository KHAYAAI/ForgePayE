import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';
import { supabase } from '../lib/supabase';
import { api } from '../lib/api';

interface User {
  id: string;
  email: string;
  username?: string;
}

interface AuthStore {
  user: User | null;
  token: string | null;
  loading: boolean;
  error: string | null;

  // Actions
  signup: (email: string, password: string, username?: string) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  initializeAuth: () => Promise<void>;
  loginWithBiometric: () => Promise<void>;
}

export const useAuthStore = create<AuthStore>((set) => ({
  user: null,
  token: null,
  loading: false,
  error: null,

  signup: async (email, password, username) => {
    set({ loading: true, error: null });
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { username },
        },
      });

      if (error) throw error;

      // Also register with backend
      await api.post('/auth/signup', { email, password, username });

      set({ user: { id: data.user?.id || '', email, username } });
    } catch (error: any) {
      set({ error: error.message });
      throw error;
    } finally {
      set({ loading: false });
    }
  },

  login: async (email, password) => {
    set({ loading: true, error: null });
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;

      const token = data.session?.access_token;
      if (token) {
        await SecureStore.setItemAsync('auth_token', token);
        await SecureStore.setItemAsync('user_email', email);
      }

      set({
        user: {
          id: data.user?.id || '',
          email: data.user?.email || email,
        },
        token,
      });
    } catch (error: any) {
      set({ error: error.message });
      throw error;
    } finally {
      set({ loading: false });
    }
  },

  logout: async () => {
    await supabase.auth.signOut();
    await SecureStore.deleteItemAsync('auth_token');
    await SecureStore.deleteItemAsync('user_email');
    set({ user: null, token: null });
  },

  initializeAuth: async () => {
    try {
      const token = await SecureStore.getItemAsync('auth_token');
      const email = await SecureStore.getItemAsync('user_email');

      if (token && email) {
        set({
          token,
          user: { id: '', email },
        });
      }
    } catch (error) {
      console.error('Failed to initialize auth:', error);
    }
  },

  loginWithBiometric: async () => {
    set({ loading: true, error: null });
    try {
      const email = await SecureStore.getItemAsync('user_email');
      const token = await SecureStore.getItemAsync('auth_token');

      if (!email || !token) {
        throw new Error('No saved credentials found');
      }

      set({
        user: { id: '', email },
        token,
      });
    } catch (error: any) {
      set({ error: error.message });
      throw error;
    } finally {
      set({ loading: false });
    }
  },
}));
