import { Component } from 'react';
import { t } from '@/i18n';
import { reportFatal } from '@/lib/logger';
import { ErrorState } from './StateMessage';

/**
 * Generated types describe the API as of build time; the backend can change
 * under a shipped WebView, so a field TypeScript swears is a string arrives
 * undefined and the render throws. Without a boundary React unmounts the whole
 * tree and the user gets a blank white WebView, which reads as a broken app.
 *
 * A boundary is NOT a substitute for an `isError` branch: it only catches throws
 * during render. A rejected request is a value, not a throw — and event handlers,
 * timers and async code need their own try/catch plus `logger.error`.
 */

export type ErrorBoundaryProps = {
  /** What you will read in Sentry. Use `feature/section`. */
  name: string;
  onReset?: () => void;
  fullScreen?: boolean;
  /** Change this to clear the error automatically (e.g. the selected chat id). */
  resetKey?: unknown;
  children: React.ReactNode;
};

type ErrorBoundaryState = { hasError: boolean };

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  override componentDidCatch(error: Error) {
    reportFatal(error, { boundary: this.props.name });
  }

  override componentDidUpdate(previous: ErrorBoundaryProps) {
    if (this.state.hasError && previous.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false });
    }
  }

  private readonly reset = () => {
    this.setState({ hasError: false });
    this.props.onReset?.();
  };

  override render() {
    if (this.state.hasError) {
      return (
        <ErrorState
          fullScreen={this.props.fullScreen}
          message={t('errors.somethingWentWrong')}
          onRetry={this.reset}
        />
      );
    }
    return this.props.children;
  }
}
