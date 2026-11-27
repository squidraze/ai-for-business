import { api } from '@/lib/api';

/** A conversation with the assistant, as `/api/v1/ai/conversations` lists it. */
export type AIConversation = {
  uuid: string;
  title?: string | null;
  /** Last prose line of the active branch (list only). */
  preview?: string | null;
  last_message_at?: string | null;
  created_at: string;
  updated_at: string;
};

export type ConversationPage = { items: AIConversation[]; total: number };

/** Query key of the conversation list; the WebView bridge invalidates it too. */
export const CONVERSATIONS_KEY = ['ai-conversations'] as const;

export const CONVERSATIONS_PAGE_SIZE = 30;

export async function fetchConversations(offset: number, limit = CONVERSATIONS_PAGE_SIZE) {
  const { data } = await api.get<ConversationPage>('/api/v1/ai/conversations', {
    params: { limit, offset },
  });
  return data;
}

export async function renameConversation(uuid: string, title: string) {
  const { data } = await api.patch<AIConversation>(
    `/api/v1/ai/conversations/${encodeURIComponent(uuid)}`,
    { title },
  );
  return data;
}

export async function deleteConversation(uuid: string) {
  await api.delete(`/api/v1/ai/conversations/${encodeURIComponent(uuid)}`);
}
