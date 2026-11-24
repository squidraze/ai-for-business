import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { loadToken, parseApiError, saveToken, setOnUnauthorized } from '@/lib/api';

import { authApi, type AuthResponse, type CodePurpose, type CodeSent, type User } from './auth.api';
import { getAppleCredential, getGoogleIdToken, googleSignOut } from './social';

export type AuthStatus = 'loading' | 'signedOut' | 'signedIn';

/**
 * Runs while the session is still valid, right before sign-out or account
 * deletion (e.g. to unregister the push token). Best-effort: errors are
 * ignored and slow handlers are cut off.
 */
export type BeforeSignOutHandler = () => Promise<unknown> | unknown;

/** How long sign-out waits for the before-sign-out handlers. */
const BEFORE_SIGN_OUT_TIMEOUT_MS = 3000;

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
  /** Adds a before-sign-out handler; returns the function that removes it. */
  registerBeforeSignOut: (handler: BeforeSignOutHandler) => () => void;
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

  const beforeSignOut = useRef(new Set<BeforeSignOutHandler>());
  const signingOut = useRef(false);

  const registerBeforeSignOut = useCallback((handler: BeforeSignOutHandler) => {
    beforeSignOut.current.add(handler);
    return () => {
      beforeSignOut.current.delete(handler);
    };
  }, []);

  const runBeforeSignOut = useCallback(async () => {
    const handlers = [...beforeSignOut.current];
    if (handlers.length === 0) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      Promise.allSettled(handlers.map((handler) => Promise.resolve().then(handler))),
      new Promise((resolve) => {
        timer = setTimeout(resolve, BEFORE_SIGN_OUT_TIMEOUT_MS);
      }),
    ]);
    clearTimeout(timer);
  }, []);

  /** `expired`: the token no longer works (401, deleted account), so skip the handlers. */
  const endSession = useCallback(
    async ({ expired = false }: { expired?: boolean } = {}) => {
      // A handler's own 401 would call this again while we are signing out.
      if (signingOut.current) return;
      signingOut.current = true;
      try {
        if (!expired) await runBeforeSignOut();
        await saveToken(null);
        void googleSignOut();
        setUser(null);
        setStatus('signedOut');
        queryClient.clear();
      } finally {
        signingOut.current = false;
      }
    },
    [queryClient, runBeforeSignOut, setUser],
  );

  const signOut = useCallback(() => endSession(), [endSession]);

  useEffect(() => {
    setOnUnauthorized(() => void endSession({ expired: true }));
    return () => setOnUnauthorized(null);
  }, [endSession]);

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
        if (parseApiError(error).status === 401) await endSession({ expired: true });
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
    await runBeforeSignOut();
    await authApi.deleteMe();
    // The handlers already ran, and the token of a deleted account no longer works.
    await endSession({ expired: true });
  }, [endSession, runBeforeSignOut]);

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
      registerBeforeSignOut,
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
      registerBeforeSignOut,
    ],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth outside AuthProvider');
  return context;
}

/**
 * Runs `handler` right before sign-out / account deletion while the session is
 * still valid. Keep `handler` stable (useCallback) or it re-registers on every render.
 */
export function useBeforeSignOut(handler: BeforeSignOutHandler) {
  const { registerBeforeSignOut } = useAuth();
  useEffect(() => registerBeforeSignOut(handler), [registerBeforeSignOut, handler]);
}
