import { TriangleAlert } from 'lucide-react-native';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { ErrorView } from '@/components/StateView';
import { reportError } from '@/lib/reportError';

/**
 * Error boundary for one **section** of a screen (ported from rooler's
 * `FeatureBoundary`). A render error inside it turns only that block into an
 * error with Retry; the rest of the screen, pull-to-refresh included, keeps
 * working. The route-level boundary (`@/components/ErrorBoundary`) is the last
 * resort that loses the whole screen.
 *
 * ```tsx
 * <FeatureBoundary name="telegram/dialogs" onReset={dialogs.refetch}>
 *   <DialogsSection … />
 * </FeatureBoundary>
 * ```
 *
 * Not caught here (use `isError` / try-catch instead): failed requests (a
 * rejected query is a value, not a throw), event handlers, timers, async code.
 */
export interface FeatureBoundaryProps {
  /** Identifies the boundary in logs, as `feature/section`. */
  name: string;
  children: ReactNode;
  /** Fill the screen instead of rendering inline inside a section. */
  fullScreen?: boolean;
  /** Extra work on retry — typically the query's `refetch`. */
  onReset?: () => void;
  /**
   * Change it to clear the error from the outside (e.g. the selected item
   * changed). A new key remounts the boundary.
   */
  resetKey?: string | number;
}

export function FeatureBoundary({ resetKey, ...props }: FeatureBoundaryProps) {
  return <BoundaryCore key={resetKey} {...props} />;
}

type CoreProps = Omit<FeatureBoundaryProps, 'resetKey'>;

class BoundaryCore extends Component<CoreProps, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportError(error, { source: 'FeatureBoundary', boundary: this.props.name, componentStack: info.componentStack });
  }

  private retry = () => {
    this.props.onReset?.();
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return <BoundaryFallback error={error} fullScreen={!!this.props.fullScreen} onRetry={this.retry} />;
  }
}

/** A function component so the copy goes through translations. */
function BoundaryFallback({ error, fullScreen, onRetry }: { error: Error; fullScreen: boolean; onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <View style={fullScreen ? styles.fullScreen : styles.inline}>
      <ErrorView
        icon={TriangleAlert}
        title={t('states.crashTitle')}
        message={__DEV__ && error.message ? error.message : t('states.crashMessage')}
        onRetry={onRetry}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fullScreen: { flex: 1 },
  inline: { minHeight: 200 },
});
