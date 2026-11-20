import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { api, loadToken, saveToken, setOnUnauthorized, type AuthResponse, type User } from './api';

type AuthState = {
  status: 'loading' | 'signedOut' | 'signedIn';
  user: User | null;
  signIn: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<AuthState['status']>('loading');
  const [user, setUser] = useState<User | null>(null);

  const signOut = useCallback(async () => {
    await saveToken(null);
    setUser(null);
    setStatus('signedOut');
    queryClient.clear();
  }, [queryClient]);

  useEffect(() => {
    setOnUnauthorized(() => void signOut());
    return () => setOnUnauthorized(null);
  }, [signOut]);

  useEffect(() => {
    void (async () => {
      const token = await loadToken();
      if (!token) {
        setStatus('signedOut');
        return;
      }
      try {
        const { data } = await api.get<User>('/api/v1/auth/me');
        setUser(data);
        setStatus('signedIn');
      } catch (error) {
        // 401 already signed us out; on a network error keep the session so the
        // app still opens offline-ish (screens show their own errors).
        const status = (error as { response?: { status?: number } }).response?.status;
        if (status === 401) await signOut();
        else setStatus('signedIn');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const accept = useCallback(async (data: AuthResponse) => {
    await saveToken(data.access_token);
    setUser(data.user);
    setStatus('signedIn');
  }, []);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const { data } = await api.post<AuthResponse>('/api/v1/auth/login', { email, password });
      await accept(data);
    },
    [accept],
  );

  const register = useCallback(
    async (email: string, password: string, name: string) => {
      const { data } = await api.post<AuthResponse>('/api/v1/auth/register', { email, password, name });
      await accept(data);
    },
    [accept],
  );

  const value = useMemo(
    () => ({ status, user, signIn, register, signOut }),
    [status, user, signIn, register, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth outside AuthProvider');
  return context;
}
