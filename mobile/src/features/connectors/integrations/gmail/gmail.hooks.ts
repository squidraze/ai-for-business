import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { gmailApi, type GmailSendInput } from './gmail.api';

export const gmailKeys = {
  all: ['gmail'] as const,
  threads: () => [...gmailKeys.all, 'threads'] as const,
  threadList: (q: string) => [...gmailKeys.threads(), q] as const,
  thread: (threadId: string) => [...gmailKeys.all, 'thread', threadId] as const,
};

/** The inbox, paged by Gmail's `next_page_token`, optionally filtered by a Gmail query. */
export function useGmailThreads(q: string) {
  return useInfiniteQuery({
    queryKey: gmailKeys.threadList(q),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => gmailApi.threads({ q: q || undefined, page_token: pageParam }),
    getNextPageParam: (last) => last.next_page_token || null,
  });
}

/** One thread; marks it read when opened. */
export function useGmailThread(threadId: string) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!threadId) return;
    gmailApi
      .markRead(threadId)
      .then(() => queryClient.invalidateQueries({ queryKey: gmailKeys.threads() }))
      .catch(() => {});
  }, [threadId, queryClient]);

  return useQuery({
    queryKey: gmailKeys.thread(threadId),
    queryFn: () => gmailApi.thread(threadId),
    enabled: !!threadId,
  });
}

export function useGmailReply(threadId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => gmailApi.reply(threadId, body),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: gmailKeys.thread(threadId) });
      void queryClient.invalidateQueries({ queryKey: gmailKeys.threads() });
    },
  });
}

export function useGmailSend() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: GmailSendInput) => gmailApi.send(input),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: gmailKeys.threads() }),
  });
}
