import { api } from '@/lib/api';

export type GmailAccount = { email?: string | null };

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

export type GmailSendInput = { to: string; subject: string; body: string; cc?: string };

const BASE = '/api/v1/connectors/gmail';
const threadPath = (threadId: string) => `${BASE}/threads/${encodeURIComponent(threadId)}`;

export const gmailApi = {
  threads: async (params: { q?: string; page_token?: string | null }): Promise<GmailThreadPage> => {
    const { data } = await api.get<GmailThreadPage>(`${BASE}/threads`, {
      params: {
        label: 'INBOX',
        ...(params.q ? { q: params.q } : {}),
        ...(params.page_token ? { page_token: params.page_token } : {}),
      },
    });
    return { items: Array.isArray(data?.items) ? data.items : [], next_page_token: data?.next_page_token ?? null };
  },
  thread: async (threadId: string): Promise<GmailThread> => (await api.get<GmailThread>(threadPath(threadId))).data,
  markRead: async (threadId: string): Promise<void> => {
    await api.post(`${threadPath(threadId)}/read`);
  },
  reply: async (threadId: string, body: string): Promise<void> => {
    await api.post(`${threadPath(threadId)}/reply`, { body });
  },
  send: async (input: GmailSendInput): Promise<void> => {
    await api.post(`${BASE}/send`, input);
  },
  authUrl: async (): Promise<string> => (await api.get<{ url: string }>(`${BASE}/auth-url`)).data.url,
  disconnect: async (): Promise<void> => {
    await api.post(`${BASE}/disconnect`);
  },
};
