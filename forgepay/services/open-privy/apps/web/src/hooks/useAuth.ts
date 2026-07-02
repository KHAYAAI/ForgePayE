import { useContext } from 'react';
import { useRouter } from 'next/router';
import { supabase } from '@/lib/supabase';
import { api } from '@/lib/api';

export const useAuthApi = () => {
  const router = useRouter();

  const signup = async (email: string, password: string, username?: string) => {
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

      return { success: true, user: data.user };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  };

  const login = async (email: string, password: string) => {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;

      localStorage.setItem('token', data.session.access_token);
      await router.push('/dashboard');
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  };

  const logout = async () => {
    await supabase.auth.signOut();
    localStorage.removeItem('token');
    await router.push('/auth/login');
  };

  return { signup, login, logout };
};
