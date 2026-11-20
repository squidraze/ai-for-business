import axios, { AxiosError } from 'axios';
import * as SecureStore from 'expo-secure-store';

import { API_URL, COMPANY_ID } from './config';

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
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    const url = error.config?.url ?? '';
    if (error.response?.status === 401 && token && !url.includes('/auth/login') && !url.includes('/auth/register')) {
      onUnauthorized?.();
    }
    return Promise.reject(error);
  },
);

/** `{ detail }` from the backend, or a sensible fallback. */
export function errorMessage(error: unknown, fallback = 'Something went wrong'): string {
  if (axios.isAxiosError(error)) {
    const detail = (error.response?.data as { detail?: unknown } | undefined)?.detail;
    if (typeof detail === 'string' && detail) return detail;
    if (Array.isArray(detail) && detail[0]?.msg) return String(detail[0].msg);
    if (!error.response) return `Can't reach the server (${API_URL})`;
    return error.message || fallback;
  }
  return error instanceof Error ? error.message : fallback;
}

export function isAbortError(error: unknown): boolean {
  if (axios.isCancel(error)) return true;
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'CanceledError');
}

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type User = { id: number; uuid: string; email: string; name: string };
export type AuthResponse = { access_token: string; user: User };

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
