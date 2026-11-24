import { useMutation } from '@tanstack/react-query';

import type { CodePurpose } from './auth.api';
import { useAuth } from './AuthProvider';

export function useSignIn() {
  const { signIn } = useAuth();
  return useMutation({
    mutationFn: ({ email, password }: { email: string; password: string }) => signIn(email, password),
  });
}

export function useRegister() {
  const { register } = useAuth();
  return useMutation({
    mutationFn: ({ email, password, name }: { email: string; password: string; name: string }) =>
      register(email, password, name),
  });
}

export function useVerifyEmail() {
  const { verifyEmail } = useAuth();
  return useMutation({
    mutationFn: ({ email, code }: { email: string; code: string }) => verifyEmail(email, code),
  });
}

export function useResendCode() {
  const { resendCode } = useAuth();
  return useMutation({
    mutationFn: ({ email, purpose }: { email: string; purpose: CodePurpose }) =>
      resendCode(email, purpose),
  });
}

export function useForgotPassword() {
  const { forgotPassword } = useAuth();
  return useMutation({ mutationFn: ({ email }: { email: string }) => forgotPassword(email) });
}

export function useResetPassword() {
  const { resetPassword } = useAuth();
  return useMutation({
    mutationFn: ({ email, code, password }: { email: string; code: string; password: string }) =>
      resetPassword(email, code, password),
  });
}

export function useGoogleSignIn() {
  const { signInWithGoogle } = useAuth();
  return useMutation({ mutationFn: () => signInWithGoogle() });
}

export function useAppleSignIn() {
  const { signInWithApple } = useAuth();
  return useMutation({ mutationFn: () => signInWithApple() });
}

export function useDeleteAccount() {
  const { deleteAccount } = useAuth();
  return useMutation({ mutationFn: () => deleteAccount() });
}
