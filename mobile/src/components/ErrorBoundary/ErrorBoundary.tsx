import { TriangleAlert } from 'lucide-react-native';
import { QueryClientContext, useQueryErrorResetBoundary } from '@tanstack/react-query';
import type { ErrorBoundaryProps } from 'expo-router';
import { useCallback, useContext, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { ErrorView } from '@/components/StateView';
import { reportError } from '@/lib/reportError';
import { useColors } from '@/lib/theme';

/**
 * Fallback screen for expo-router error boundaries. Re-export it from a route
 * file to give that screen its own boundary:
 *
 *   export { ErrorBoundary } from '@/components/ErrorBoundary';
 *
 * expo-router renders it in place of the crashed route with `{ error, retry }`.
 * It may render outside the app providers (the root layout's boundary sits
 * above QueryClientProvider), so it only relies on hooks that work without them.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const c = useColors();
  const { t } = useTranslation();
  // undefined above QueryClientProvider (root layout crash): just retry the render.
  const queryClient = useContext(QueryClientContext);
  const { reset } = useQueryErrorResetBoundary();

  // expo-router's boundary does not log anything itself.
  useEffect(() => {
    reportError(error, { source: 'ErrorBoundary' });
  }, [error]);

  const onRetry = useCallback(() => {
    // Let queries that threw into the boundary fetch again on remount…
    reset();
    // …and drop failed results so the screen doesn't re-crash on stale errors.
    void queryClient?.resetQueries({ predicate: (q) => q.state.status === 'error' });
    void retry();
  }, [queryClient, reset, retry]);

  return (
    <View style={[styles.root, { backgroundColor: c.bg }]}>
      <ErrorView
        icon={TriangleAlert}
        title={t('states.crashTitle')}
        message={__DEV__ && error?.message ? error.message : t('states.crashMessage')}
        onRetry={onRetry}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
});
