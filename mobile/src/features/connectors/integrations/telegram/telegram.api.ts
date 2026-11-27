import { api, getToken } from '@/lib/api';
import { API_URL } from '@/lib/config';

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

export type TelegramMediaKind = 'photo' | 'video' | 'document' | 'voice' | 'sticker';

export type TelegramMessage = {
  id: number;
  text: string;
  date: string;
  out: boolean;
  sender_id?: number | string | null;
  sender_name?: string | null;
  reply_to_id?: number | null;
  media?: TelegramMediaKind | null;
};

export type SignInResult = { status: 'ok' | 'password_required' };

const BASE = '/api/v1/connectors/telegram';
const dialogPath = (chatId: string) => `${BASE}/dialogs/${encodeURIComponent(chatId)}`;

const list = <T>(data: unknown): T[] => (Array.isArray(data) ? (data as T[]) : []);

export const telegramApi = {
  dialogs: async (params: { limit: number; q?: string }): Promise<TelegramDialog[]> =>
    list<TelegramDialog>(
      (
        await api.get<TelegramDialog[]>(`${BASE}/dialogs`, {
          params: { limit: params.limit, ...(params.q ? { q: params.q } : {}) },
        })
      ).data,
    ),
  messages: async (
    chatId: string,
    params: { limit: number; offset_id?: number },
  ): Promise<TelegramMessage[]> =>
    list<TelegramMessage>((await api.get<TelegramMessage[]>(`${dialogPath(chatId)}/messages`, { params })).data),
  send: async (chatId: string, text: string): Promise<TelegramMessage> =>
    (await api.post<TelegramMessage>(`${dialogPath(chatId)}/messages`, { text })).data,
  markRead: async (chatId: string): Promise<void> => {
    await api.post(`${dialogPath(chatId)}/read`);
  },
  sendCode: async (phone: string): Promise<{ phone_code_hash: string }> =>
    (await api.post<{ phone_code_hash: string }>(`${BASE}/send-code`, { phone })).data,
  signIn: async (body: { phone: string; code: string; phone_code_hash: string }): Promise<SignInResult> =>
    (await api.post<SignInResult>(`${BASE}/sign-in`, body)).data,
  password: async (password: string): Promise<void> => {
    await api.post(`${BASE}/password`, { password });
  },
  logout: async (): Promise<void> => {
    await api.post(`${BASE}/logout`);
  },
};

/** Telegram dialog avatar: the backend wants the Bearer header on the image request. */
export function dialogPhotoSource(chatId: string) {
  return {
    uri: `${API_URL}${dialogPath(chatId)}/photo`,
    headers: { Authorization: `Bearer ${getToken() ?? ''}` },
  };
}
