import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { invalidateConnectors } from '../../connectors.hooks';
import { bitrixApi, type BitrixEntity } from './bitrix24.api';

export const bitrixKeys = {
  all: ['bitrix'] as const,
  list: (entity: BitrixEntity, q: string) => [...bitrixKeys.all, entity, 'list', q] as const,
  detail: (entity: BitrixEntity | null, id: string) => [...bitrixKeys.all, entity, 'detail', id] as const,
};

/** Deals or leads, paged by Bitrix24's `next` offset, optionally filtered by title. */
export function useBitrixList(entity: BitrixEntity, q: string) {
  return useInfiniteQuery({
    queryKey: bitrixKeys.list(entity, q),
    initialPageParam: 0,
    queryFn: ({ pageParam }) => bitrixApi.list(entity, { start: pageParam, q: q || undefined }),
    getNextPageParam: (last) => last.next ?? null,
  });
}

/** One deal or lead with its comments. */
export function useBitrixRecord(entity: BitrixEntity | null, id: string) {
  return useQuery({
    queryKey: bitrixKeys.detail(entity, id),
    enabled: !!entity && !!id,
    queryFn: () => bitrixApi.detail(entity as BitrixEntity, id),
  });
}

export function useAddBitrixComment(entity: BitrixEntity | null, id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (text: string) => bitrixApi.addComment(entity as BitrixEntity, id, text),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: bitrixKeys.detail(entity, id) }),
  });
}

export function useConnectBitrix() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (webhookUrl: string) => bitrixApi.connect(webhookUrl),
    onSuccess: () => invalidateConnectors(queryClient),
  });
}
