import { useBoot } from '@/app/boot';
import { ChatScreen } from '@/app/ChatScreen';
import { useTranslation } from '@/i18n';
import { ErrorBoundary, ErrorState, ToastProvider } from '@/ui/primitives';

/**
 * The boot gate. Three states, and the first of them renders deliberately
 * nothing: the native host keeps its own skeleton on top of the WebView until we
 * post `ready`, so anything drawn here before `init` would flash through it. All
 * that is needed is the page painted in the right colour underneath.
 */
function BootGate() {
  const { status, error, retry } = useBoot();
  const { t } = useTranslation();

  if (status === 'failed') {
    return (
      <div
        className="flex h-full flex-col bg-screen"
        style={{ paddingTop: 'var(--inset-top)', paddingBottom: 'var(--inset-bottom)' }}
      >
        <ErrorState
          fullScreen
          message={error ?? t('boot.failed')}
          onRetry={retry}
        />
      </div>
    );
  }

  if (status !== 'ready') return <div className="h-full bg-screen" />;

  return <ChatScreen />;
}

/**
 * The root boundary is the last resort — a throw that reaches it has already
 * cost the whole screen. Sections that render backend data carry their own
 * `ErrorBoundary` so a bad message degrades one bubble, not the conversation.
 */
export default function App() {
  return (
    <ErrorBoundary name="webchat/root" fullScreen>
      <ToastProvider>
        <BootGate />
      </ToastProvider>
    </ErrorBoundary>
  );
}
