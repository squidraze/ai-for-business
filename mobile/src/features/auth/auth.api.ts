import { api } from '@/lib/api';

const BASE = '/api/v1/auth';

export type AuthProviderId = 'password' | 'google' | 'apple';

export type User = {
  id: number;
  uuid: string;
  email: string;
  name: string;
  email_verified: boolean;
  has_password: boolean;
  providers: AuthProviderId[];
  created_at: string;
};

export type AuthResponse = { access_token: string; token_type: string; user: User };

/** A code was emailed. Times are in seconds. */
export type CodeSent = { email: string; resend_in: number; expires_in: number };

export type CodePurpose = 'verify' | 'reset';

export type AppleSignInPayload = {
  identity_token: string;
  given_name?: string | null;
  family_name?: string | null;
};

export const authApi = {
  register: async (body: { email: string; password: string; name: string }) =>
    (await api.post<CodeSent>(`${BASE}/register`, body)).data,

  verifyEmail: async (body: { email: string; code: string }) =>
    (await api.post<AuthResponse>(`${BASE}/verify-email`, body)).data,

  resendCode: async (body: { email: string; purpose: CodePurpose }) =>
    (await api.post<CodeSent>(`${BASE}/resend-code`, body)).data,

  login: async (body: { email: string; password: string }) =>
    (await api.post<AuthResponse>(`${BASE}/login`, body)).data,

  forgotPassword: async (body: { email: string }) =>
    (await api.post<CodeSent>(`${BASE}/password/forgot`, body)).data,

  resetPassword: async (body: { email: string; code: string; password: string }) =>
    (await api.post<AuthResponse>(`${BASE}/password/reset`, body)).data,

  google: async (body: { id_token: string }) =>
    (await api.post<AuthResponse>(`${BASE}/google`, body)).data,

  apple: async (body: AppleSignInPayload) =>
    (await api.post<AuthResponse>(`${BASE}/apple`, body)).data,

  me: async () => (await api.get<User>(`${BASE}/me`)).data,

  deleteMe: async () => {
    await api.delete(`${BASE}/me`);
  },
};

/** Error codes that belong under the code cells rather than in the form banner. */
export const CODE_ERRORS: ReadonlySet<string> = new Set([
  'invalid_code',
  'code_expired',
  'too_many_attempts',
  'invalid_code_format',
]);
