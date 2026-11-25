import type { ReactNode } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { FadeSwitch } from '@/components/FadeSwitch';
import { SkeletonList } from '@/components/Skeleton';
import { SlowLoadingHint } from '@/components/SlowLoadingHint';
import { StaleDataBanner } from '@/components/StaleDataBanner';
import { ErrorView } from '@/components/StateView';
import { errorMessage } from '@/lib/api';
import { useColors } from '@/lib/theme';

/** The bits of a TanStack query (or anything similar) that decide the state. */
export type QueryLike = {
  isLoading?: boolean;
  isPending?: boolean;
  isError: boolean;
  /** A request is in flight (initial load or refetch). */
  isFetching?: boolean;
  error: unknown;
  data?: unknown;
  refetch: () => unknown;
};

export type AsyncStateKey = 'loading' | 'error' | 'empty' | 'content';

export function resolveAsyncState(
  query: QueryLike,
  { isEmpty = false, loading = false }: { isEmpty?: boolean; loading?: boolean } = {},
): AsyncStateKey {
  if (loading || (query.isLoading ?? query.isPending ?? false)) return 'loading';
  // A failed refetch keeps showing the data we already have.
  if (query.isError && (query.data === undefined || isEmpty)) return 'error';
  if (isEmpty) return 'empty';
  return 'content';
}

/**
 * Renders loading (skeleton) / error (with retry) / empty / content for a query
 * and cross-fades between them.
 */
export function AsyncState({
  query,
  isEmpty = false,
  loading = false,
  skeleton,
  empty,
  error,
  refreshing,
  onRefresh,
  style,
  children,
}: {
  query: QueryLike;
  /** The query succeeded but there is nothing to show. */
  isEmpty?: boolean;
  /** Extra loading condition (e.g. a debounced search that hasn't fired yet). */
  loading?: boolean;
  /** Loading placeholder; defaults to a list skeleton. */
  skeleton?: ReactNode;
  /** Shown when `isEmpty`; without it the content handles emptiness itself. */
  empty?: ReactNode;
  /** Replaces the default error view (e.g. a "not connected" state). */
  error?: ReactNode | ((error: unknown, retry: () => void) => ReactNode | null);
  /** Pull-to-refresh on the empty and error views. */
  refreshing?: boolean;
  onRefresh?: () => void;
  style?: StyleProp<ViewStyle>;
  children: ReactNode | (() => ReactNode);
}) {
  const c = useColors();
  const retry = () => void query.refetch();
  // Without an `empty` view the content renders its own empty state.
  const state = resolveAsyncState(query, { isEmpty: isEmpty && empty !== undefined, loading });

  const scrollable = (node: ReactNode) =>
    onRefresh ? (
      <ScrollView
        contentContainerStyle={styles.grow}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={!!refreshing}
            onRefresh={onRefresh}
            tintColor={c.primary}
            colors={[c.primary]}
          />
        }
      >
        {node}
      </ScrollView>
    ) : (
      node
    );

  let body: ReactNode;
  if (state === 'loading')
    body = (
      <View style={styles.fill}>
        {skeleton ?? <SkeletonList />}
        <SlowLoadingHint />
      </View>
    );
  else if (state === 'error') {
    const custom = typeof error === 'function' ? error(query.error, retry) : error;
    body = scrollable(custom ?? <ErrorView message={errorMessage(query.error)} onRetry={retry} />);
  } else if (state === 'empty') body = scrollable(empty);
  else {
    const content = typeof children === 'function' ? children() : children;
    // A refetch failed but older data is still shown: say so, don't fail silently.
    const stale = query.isError && !query.isFetching && query.data !== undefined;
    body = stale ? (
      <View style={styles.fill}>
        <StaleDataBanner message={errorMessage(query.error)} onRetry={retry} />
        <View style={styles.fill}>{content}</View>
      </View>
    ) : (
      content
    );
  }

  return (
    <FadeSwitch stateKey={state} style={style}>
      {body}
    </FadeSwitch>
  );
}

const styles = StyleSheet.create({
  grow: { flexGrow: 1 },
  fill: { flex: 1 },
});
