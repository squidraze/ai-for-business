import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { telegramApi, type TelegramMessage } from './telegram.api';

const DIALOGS_LIMIT = 50;
const MESSAGES_PAGE = 50;
const DIALOGS_POLL_MS = 15_000;
const MESSAGES_POLL_MS = 5_000;

export const telegramKeys = {
  all: ['telegram'] as const,
  dialogs: () => [...telegramKeys.all, 'dialogs'] as const,
  dialogList: (q: string) => [...telegramKeys.dialogs(), q] as const,
  messages: (chatId: string) => [...telegramKeys.all, 'messages', chatId] as const,
};

/** The chat list, optionally filtered by `q`; polls while open. */
export function useTelegramDialogs(q: string) {
  return useQuery({
    queryKey: telegramKeys.dialogList(q),
    queryFn: () => telegramApi.dialogs({ limit: DIALOGS_LIMIT, q: q || undefined }),
    refetchInterval: DIALOGS_POLL_MS,
  });
}

function mergeMessages(...lists: TelegramMessage[][]): TelegramMessage[] {
  const byId = new Map<number, TelegramMessage>();
  for (const list of lists) for (const m of list) if (m && typeof m.id === 'number') byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => b.id - a.id);
}

/**
 * One chat: the newest page (polled), older pages loaded on scroll, messages
 * just sent, mark-as-read, and send. Messages are newest first.
 */
export function useTelegramChat(chatId: string) {
  const queryClient = useQueryClient();

  const latest = useQuery({
    queryKey: telegramKeys.messages(chatId),
    queryFn: () => telegramApi.messages(chatId, { limit: MESSAGES_PAGE }),
    enabled: !!chatId,
    refetchInterval: MESSAGES_POLL_MS,
  });

  const [older, setOlder] = useState<TelegramMessage[]>([]);
  const [sent, setSent] = useState<TelegramMessage[]>([]);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [reachedStart, setReachedStart] = useState(false);
  const [sending, setSending] = useState(false);

  const messages = useMemo(
    () => mergeMessages(older, latest.data ?? [], sent),
    [older, latest.data, sent],
  );

  // Mark read on open, and again whenever new messages arrive while it's open.
  const newestId = latest.data?.[0]?.id;
  useEffect(() => {
    if (!chatId) return;
    telegramApi
      .markRead(chatId)
      .then(() => queryClient.invalidateQueries({ queryKey: telegramKeys.dialogs() }))
      .catch(() => {});
  }, [chatId, newestId, queryClient]);

  const loadOlder = useCallback(async () => {
    if (loadingOlder || reachedStart || messages.length === 0) return;
    setLoadingOlder(true);
    try {
      const oldest = messages[messages.length - 1].id;
      const data = await telegramApi.messages(chatId, { limit: MESSAGES_PAGE, offset_id: oldest });
      if (data.length === 0) setReachedStart(true);
      setOlder((prev) => mergeMessages(prev, data));
    } catch {
      // ignore; the user can scroll again
    } finally {
      setLoadingOlder(false);
    }
  }, [chatId, loadingOlder, reachedStart, messages]);

  /** Sends `text`; throws on failure so the screen can show it. */
  const send = useCallback(
    async (text: string) => {
      setSending(true);
      try {
        const data = await telegramApi.send(chatId, text);
        if (data && typeof data.id === 'number') setSent((prev) => [...prev, data]);
        void latest.refetch();
      } finally {
        setSending(false);
      }
    },
    [chatId, latest],
  );

  return { latest, messages, loadOlder, loadingOlder, send, sending };
}
