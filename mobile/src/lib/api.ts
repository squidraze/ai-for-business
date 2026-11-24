import axios, { AxiosError } from 'axios';
import * as SecureStore from 'expo-secure-store';

import { API_URL, COMPANY_ID } from './config';
import i18n from './i18n';

const TOKEN_KEY = 'forbusiness_token';

let token: string | null = null;
let onUnauthorized: (() => void) | null = null;

export async function loadToken(): Promise<string | null> {
  try {
    token = await SecureStore.getItemAsync(TOKEN_KEY);
  } catch {
    token = null;
  }
  return token;
}

export async function saveToken(value: string | null): Promise<void> {
  token = value;
  try {
    if (value) await SecureStore.setItemAsync(TOKEN_KEY, value);
    else await SecureStore.deleteItemAsync(TOKEN_KEY);
  } catch {
    // demo: an in-memory token still works for this session
  }
}

export function getToken(): string | null {
  return token;
}

/** The AuthProvider registers its sign-out here; any 401 calls it. */
export function setOnUnauthorized(handler: (() => void) | null) {
  onUnauthorized = handler;
}

export const api = axios.create({
  baseURL: API_URL,
  timeout: 60_000,
});

api.interceptors.request.use((config) => {
  config.headers = config.headers ?? {};
  if (token && !config.headers.Authorization) config.headers.Authorization = `Bearer ${token}`;
  config.headers['X-Company-ID'] = COMPANY_ID;
  // The backend localizes emails (verification / reset codes) by this header.
  config.headers['Accept-Language'] = (i18n.language || 'en').slice(0, 2);
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    const url = error.config?.url ?? '';
    // Unauthenticated auth endpoints (login, register, verify…) answer 401 for bad
    // credentials — that is not an expired session. Only /auth/me means "signed out".
    const isPublicAuth = url.includes('/auth/') && !url.includes('/auth/me');
    if (error.response?.status === 401 && token && !isPublicAuth) {
      onUnauthorized?.();
    }
    return Promise.reject(error);
  },
);

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

/**
 * A failed request (or a client-side failure with a `code`) in one shape.
 * Backend errors look like `{"detail": {"code", "message", "field"?, ...extra}}`;
 * 422 adds `fields: {<field>: <code>}`. Older endpoints still send a string `detail`.
 */
export type ApiError = {
  /** HTTP status, null when there was no response. */
  status: number | null;
  /** Machine code: backend `detail.code`, or `network`, `timeout`, `unknown`. */
  code: string;
  /** Server message (English) if any. */
  message: string | null;
  /** The field the error belongs to, if the backend named one. */
  field: string | null;
  /** Per-field codes from `validation_error`. */
  fields: Record<string, string>;
  /** Any other keys of `detail` (attempts_left, resend_in, retry_after, email…). */
  extra: Record<string, unknown>;
};

/** Thrown by client-side code (Google/Apple sign-in) with a code from `errors.*`. */
export class ClientError extends Error {
  constructor(public code: string, message?: string) {
    super(message ?? code);
    this.name = 'ClientError';
  }
}

function fastApiFields(detail: unknown[]): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const item of detail) {
    const loc = (item as { loc?: unknown[] })?.loc;
    const name = Array.isArray(loc) ? loc[loc.length - 1] : undefined;
    if (typeof name === 'string' && !fields[name]) fields[name] = 'invalid';
  }
  return fields;
}

export function parseApiError(error: unknown): ApiError {
  const base: ApiError = { status: null, code: 'unknown', message: null, field: null, fields: {}, extra: {} };
  if (axios.isAxiosError(error)) {
    if (!error.response) {
      const timedOut = error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT';
      return { ...base, code: timedOut ? 'timeout' : 'network', message: error.message || null };
    }
    const status = error.response.status;
    const detail = (error.response.data as { detail?: unknown } | undefined)?.detail;
    if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
      const { code, message, field, fields, ...extra } = detail as Record<string, unknown>;
      return {
        status,
        code: typeof code === 'string' && code ? code : status >= 500 ? 'internal_error' : 'unknown',
        message: typeof message === 'string' ? message : null,
        field: typeof field === 'string' ? field : null,
        fields:
          fields && typeof fields === 'object' ? (fields as Record<string, string>) : {},
        extra,
      };
    }
    if (Array.isArray(detail)) {
      return {
        ...base,
        status,
        code: 'validation_error',
        message: typeof detail[0]?.msg === 'string' ? detail[0].msg : null,
        fields: fastApiFields(detail),
      };
    }
    return {
      ...base,
      status,
      code: status >= 500 ? 'internal_error' : status === 401 ? 'unauthorized' : 'unknown',
      message: typeof detail === 'string' && detail ? detail : null,
    };
  }
  if (error instanceof ClientError) return { ...base, code: error.code, message: error.message };
  if (error instanceof Error) return { ...base, message: error.message || null };
  return base;
}

export function apiErrorCode(error: unknown): string {
  return parseApiError(error).code;
}

/** Translated text for an error code (`errors.<code>`), or null if there is none. */
export function errorCodeMessage(code: string, extra: Record<string, unknown> = {}): string | null {
  if (code === 'invalid_code' && typeof extra.attempts_left === 'number') {
    return i18n.t('errors.invalid_code_attempts', { n: extra.attempts_left });
  }
  if (code === 'resend_cooldown' && typeof extra.retry_after === 'number') {
    return i18n.t('errors.resend_cooldown_seconds', { n: Math.ceil(extra.retry_after) });
  }
  const key = `errors.${code}`;
  return i18n.exists(key) ? i18n.t(key) : null;
}

/**
 * A human message for any error, in the current language: a known code is
 * translated; otherwise the server's own message; otherwise `fallback`/generic.
 */
export function errorMessage(error: unknown, fallback?: string): string {
  const parsed = parseApiError(error);
  return (
    errorCodeMessage(parsed.code, parsed.extra) ??
    parsed.message ??
    fallback ??
    i18n.t('errors.generic')
  );
}

export function isAbortError(error: unknown): boolean {
  if (axios.isCancel(error)) return true;
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'CanceledError');
}

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type AIConversation = {
  uuid: string;
  title?: string | null;
  last_message_at?: string | null;
  created_at: string;
  updated_at: string;
};

export type ConnectorStatus = {
  id: 'telegram' | 'gmail' | 'bitrix24';
  connected: boolean;
  account: Record<string, unknown> | null;
};

export type TelegramAccount = {
  id: number | string;
  first_name?: string | null;
  last_name?: string | null;
  username?: string | null;
  phone?: string | null;
};

export type TelegramDialog = {
  id: string;
  title: string;
  type: 'user' | 'group' | 'channel' | 'bot';
  unread_count: number;
  pinned: boolean;
  last_message: { id: number; text: string; date: string; out: boolean } | null;
};

export type TelegramMessage = {
  id: number;
  text: string;
  date: string;
  out: boolean;
  sender_id?: number | string | null;
  sender_name?: string | null;
  reply_to_id?: number | null;
  media?: 'photo' | 'video' | 'document' | 'voice' | 'sticker' | null;
};

export type GmailThreadSummary = {
  id: string;
  subject: string;
  from: string;
  snippet: string;
  date: string;
  unread: boolean;
  message_count: number;
};

export type GmailThreadPage = { items: GmailThreadSummary[]; next_page_token?: string | null };

export type GmailMessage = {
  id: string;
  from: string;
  to: string;
  cc?: string | null;
  date: string;
  subject: string;
  body_text: string;
  snippet: string;
};

export type GmailThread = { id: string; subject: string; messages: GmailMessage[] };

export type BitrixAccount = { portal: string; user_name: string; user_id: string };

export type BitrixEntity = 'deals' | 'leads';

export type BitrixDeal = {
  id: string;
  title: string;
  stage_id: string;
  stage_name: string;
  opportunity: number | null;
  currency: string | null;
  contact_name: string | null;
  company_title: string | null;
  assigned_name: string | null;
  date_create: string | null;
  date_modify: string | null;
  comments_text: string | null;
  url: string;
};

export type BitrixLead = {
  id: string;
  title: string;
  status_id: string;
  status_name: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  opportunity: number | null;
  currency: string | null;
  assigned_name: string | null;
  source: string | null;
  date_create: string | null;
  date_modify: string | null;
  comments_text: string | null;
  url: string;
};

export type BitrixComment = {
  id: string;
  text: string;
  author_name: string | null;
  created: string | null;
};

export type BitrixPage<T> = { items: T[]; next: number | null };

export type BitrixDealDetail = BitrixDeal & { comments: BitrixComment[] };
export type BitrixLeadDetail = BitrixLead & { comments: BitrixComment[] };

/* Query keys shared between screens. */
export const CONVERSATIONS_KEY = ['ai-conversations'] as const;
export const CONNECTORS_KEY = ['connectors'] as const;

/** Telegram dialog avatar — the backend wants the Bearer header on the image request. */
export function dialogPhotoSource(chatId: string) {
  return {
    uri: `${API_URL}/api/v1/connectors/telegram/dialogs/${encodeURIComponent(chatId)}/photo`,
    headers: { Authorization: `Bearer ${token ?? ''}` },
  };
}
