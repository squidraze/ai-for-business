import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { loadToken, parseApiError, saveToken, setOnUnauthorized } from '@/lib/api';

import { authApi, type AuthResponse, type CodePurpose, type CodeSent, type User } from './auth.api';
import { getAppleCredential, getGoogleIdToken, googleSignOut } from './social';

export type AuthStatus = 'loading' | 'signedOut' | 'signedIn';

/** Social sign-in result: `cancelled` means the user closed the dialog (no error). */
export type SocialResult = 'signedIn' | 'cancelled';

export type AuthState = {
  status: AuthStatus;
  user: User | null;
  /** `GET /auth/me` while signed in: loading / error / refetch for screens showing the user. */
  userQuery: UseQueryResult<User>;
  signIn: (email: string, password: string) => Promise<void>;
  /** Creates the account and emails a code; the user is not signed in yet. */
  register: (email: string, password: string, name: string) => Promise<CodeSent>;
  verifyEmail: (email: string, code: string) => Promise<void>;
  resendCode: (email: string, purpose: CodePurpose) => Promise<CodeSent>;
  forgotPassword: (email: string) => Promise<CodeSent>;
  resetPassword: (email: string, code: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<SocialResult>;
  signInWithApple: () => Promise<SocialResult>;
  deleteAccount: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export const ME_QUERY_KEY = ['auth', 'me'] as const;

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<AuthStatus>('loading');
  const userQuery = useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: authApi.me,
    enabled: status === 'signedIn',
    staleTime: 60_000,
  });
  const user = status === 'signedIn' ? (userQuery.data ?? null) : null;
  const setUser = useCallback(
    (next: User | null) => {
      if (next) queryClient.setQueryData(ME_QUERY_KEY, next);
      else queryClient.removeQueries({ queryKey: ME_QUERY_KEY });
    },
    [queryClient],
  );

  const signOut = useCallback(async () => {
    await saveToken(null);
    void googleSignOut();
    setUser(null);
    setStatus('signedOut');
    queryClient.clear();
  }, [queryClient, setUser]);

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
        setUser(await authApi.me());
        setStatus('signedIn');
      } catch (error) {
        // 401 already signed us out; on a network error keep the session so the
        // app still opens offline-ish (screens show their own errors).
        if (parseApiError(error).status === 401) await signOut();
        else setStatus('signedIn');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const accept = useCallback(
    async (data: AuthResponse) => {
      await saveToken(data.access_token);
      setUser(data.user);
      setStatus('signedIn');
    },
    [setUser],
  );

  const signIn = useCallback(
    async (email: string, password: string) => accept(await authApi.login({ email, password })),
    [accept],
  );

  const register = useCallback(
    (email: string, password: string, name: string) => authApi.register({ email, password, name }),
    [],
  );

  const verifyEmail = useCallback(
    async (email: string, code: string) => accept(await authApi.verifyEmail({ email, code })),
    [accept],
  );

  const resendCode = useCallback(
    (email: string, purpose: CodePurpose) => authApi.resendCode({ email, purpose }),
    [],
  );

  const forgotPassword = useCallback((email: string) => authApi.forgotPassword({ email }), []);

  const resetPassword = useCallback(
    async (email: string, code: string, password: string) =>
      accept(await authApi.resetPassword({ email, code, password })),
    [accept],
  );

  const signInWithGoogle = useCallback(async (): Promise<SocialResult> => {
    const idToken = await getGoogleIdToken();
    if (!idToken) return 'cancelled';
    try {
      await accept(await authApi.google({ id_token: idToken }));
    } catch (error) {
      void googleSignOut(); // let the user pick another account next time
      throw error;
    }
    return 'signedIn';
  }, [accept]);

  const signInWithApple = useCallback(async (): Promise<SocialResult> => {
    const credential = await getAppleCredential();
    if (!credential) return 'cancelled';
    await accept(await authApi.apple(credential));
    return 'signedIn';
  }, [accept]);

  const deleteAccount = useCallback(async () => {
    await authApi.deleteMe();
    await signOut();
  }, [signOut]);

  const value = useMemo<AuthState>(
    () => ({
      status,
      user,
      userQuery,
      signIn,
      register,
      verifyEmail,
      resendCode,
      forgotPassword,
      resetPassword,
      signInWithGoogle,
      signInWithApple,
      deleteAccount,
      signOut,
    }),
    [
      status,
      user,
      userQuery,
      signIn,
      register,
      verifyEmail,
      resendCode,
      forgotPassword,
      resetPassword,
      signInWithGoogle,
      signInWithApple,
      deleteAccount,
      signOut,
    ],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth outside AuthProvider');
  return context;
}
