import { useInfiniteQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';

import {
  CONVERSATIONS_KEY,
  CONVERSATIONS_PAGE_SIZE,
  deleteConversation,
  fetchConversations,
  renameConversation,
} from './chat.api';

export function invalidateConversations(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: CONVERSATIONS_KEY });
}

/** The chat list, newest activity first, paged by offset. */
export function useConversations() {
  return useInfiniteQuery({
    queryKey: CONVERSATIONS_KEY,
    initialPageParam: 0,
    queryFn: ({ pageParam }) => fetchConversations(pageParam),
    getNextPageParam: (last, all) => {
      const loaded = all.reduce((n, p) => n + (p.items?.length ?? 0), 0);
      return (last.items?.length ?? 0) === CONVERSATIONS_PAGE_SIZE && loaded < (last.total ?? Infinity)
        ? loaded
        : undefined;
    },
  });
}

export function useRenameConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ uuid, title }: { uuid: string; title: string }) => renameConversation(uuid, title),
    onSuccess: () => invalidateConversations(queryClient),
  });
}

export function useDeleteConversation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (uuid: string) => deleteConversation(uuid),
    onSuccess: () => invalidateConversations(queryClient),
  });
}
