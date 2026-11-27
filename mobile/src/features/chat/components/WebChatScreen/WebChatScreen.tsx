/**
 * The native host for the WebView chat (simplified from the Rooler business
 * app's WebChatScreen). It owns no chat logic: a header, a WebView, a loading
 * overlay until `init` is delivered, the bridge, insets/theme deltas, the
 * Android back button (`nav.back` -> `nav.consumed`) and crash recovery.
 */
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type Ref,
} from 'react';
import {
  ActivityIndicator,
  AppState,
  BackHandler,
  Keyboard,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import WebView, {
  type WebViewMessageEvent,
  type WebViewNavigation,
  type WebViewProps,
} from 'react-native-webview';

import { ErrorView } from '@/components/ui';
import { createLogger } from '@/lib/log';
import { useColors, useThemeName } from '@/lib/theme';

import { createBridgePost, parseWebMessage } from './bridge';
import {
  WEBCHAT_MISSING_MESSAGE,
  WEBCHAT_READY_TIMEOUT_MS,
  isInsideNavigationBase,
  navigationBaseOf,
  originWhitelistOf,
  useWebchatSource,
} from './bundle';
import { useWebChatHandlers } from './handlers';
import type { Insets, ThemeName, ThreadTarget } from './protocol';

// react-native-webview 14's `index.d.ts` declares `WebView<P = undefined>` with
// props `WebViewProps & P`, which collapses to `never`. Re-type it for JSX.
const WebViewView = WebView as unknown as ComponentType<
  WebViewProps & { ref?: Ref<WebView | null> }
>;

const log = createLogger('webchat.host');

const DEFAULT_TITLE = 'AI Assistant';
const NAV_BACK_TIMEOUT_MS = 2_000;
const LOAD_FAILED = "The chat couldn't be loaded. Check your connection and try again.";

function documentPartOf(url: string): string {
  const path = url.split('#')[0].split('?')[0];
  return path.endsWith('/') ? path.slice(0, -1) : path;
}

function isMainFrame(failedUrl: string | undefined, documentUrl: string): boolean {
  if (!failedUrl) return true;
  return documentPartOf(failedUrl) === documentPartOf(documentUrl);
}

export type WebChatScreenProps = {
  threadId?: string;
  initialTitle?: string;
  onOpenList: () => void;
  onNewChat: () => void;
  onOpenIntegrations: () => void;
};

export function WebChatScreen({
  threadId,
  initialTitle,
  onOpenList,
  onNewChat,
  onOpenIntegrations,
}: WebChatScreenProps) {
  const threadTarget: ThreadTarget = !threadId || threadId === 'new' ? 'new' : threadId;
  const c = useColors();
  const theme = useThemeName();

  const webviewRef = useRef<WebView | null>(null);
  const post = useMemo(() => createBridgePost(webviewRef), []);

  const [attempt, setAttempt] = useState(0);
  const [ready, setReady] = useState(false);
  const [title, setTitle] = useState(initialTitle || DEFAULT_TITLE);
  const [failure, setFailure] = useState<string | null>(null);
  const crashCountRef = useRef(0);
  const readyRef = useRef(false);
  readyRef.current = ready;

  const source = useWebchatSource(attempt);

  /* insets: reported, never applied */
  const safeArea = useSafeAreaInsets();
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  useEffect(() => {
    // Android resizes the window itself; the keyboard number is iOS-only.
    if (Platform.OS !== 'ios') return;
    const show = Keyboard.addListener('keyboardWillChangeFrame', (event) =>
      setKeyboardHeight(event.endCoordinates?.height ?? 0),
    );
    const hide = Keyboard.addListener('keyboardWillHide', () => setKeyboardHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const insets = useMemo<Insets>(
    () => ({ top: 0, bottom: safeArea.bottom, left: 0, right: 0, keyboard: keyboardHeight }),
    [safeArea.bottom, keyboardHeight],
  );
  const insetsRef = useRef(insets);
  insetsRef.current = insets;
  const getInsets = useCallback(() => insetsRef.current, []);

  /* bridge */
  const navBackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onNavConsumed = useCallback(
    (consumed: boolean) => {
      if (!navBackTimer.current) return;
      clearTimeout(navBackTimer.current);
      navBackTimer.current = null;
      if (!consumed) onOpenList();
    },
    [onOpenList],
  );

  const { handleWebMessage, setLiveConversation } = useWebChatHandlers({
    post,
    threadId: threadTarget,
    getInsets,
    onBooted: () => setFailure(null),
    onInitialised: () => {
      setReady(true);
      setFailure(null);
      crashCountRef.current = 0;
    },
    onInitFailed: setFailure,
    onTitle: setTitle,
    onOpenList,
    onOpenIntegrations,
    onNavConsumed,
    onBundleMissing: () => setFailure(WEBCHAT_MISSING_MESSAGE),
  });

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      const message = parseWebMessage(event.nativeEvent.data);
      if (message) handleWebMessage(message);
    },
    [handleWebMessage],
  );

  /* native -> web deltas */
  const [newChatNonce, setNewChatNonce] = useState(0);
  const handleNewChat = useCallback(() => {
    setLiveConversation(null);
    setNewChatNonce((value) => value + 1);
    setTitle(DEFAULT_TITLE);
    onNewChat();
  }, [onNewChat, setLiveConversation]);

  const sentThread = useRef<{ target: ThreadTarget; nonce: number } | null>(null);
  useEffect(() => {
    if (!ready) {
      sentThread.current = null;
      return;
    }
    if (sentThread.current === null) {
      sentThread.current = { target: threadTarget, nonce: newChatNonce };
      return;
    }
    if (sentThread.current.target === threadTarget && sentThread.current.nonce === newChatNonce)
      return;
    sentThread.current = { target: threadTarget, nonce: newChatNonce };
    setLiveConversation(threadTarget === 'new' ? null : threadTarget);
    post('thread.switch', { threadId: threadTarget });
  }, [ready, threadTarget, newChatNonce, post, setLiveConversation]);

  const sentTheme = useRef<ThemeName | null>(null);
  useEffect(() => {
    if (!ready) {
      sentTheme.current = null;
      return;
    }
    if (sentTheme.current === null) {
      sentTheme.current = theme;
      return;
    }
    if (sentTheme.current === theme) return;
    sentTheme.current = theme;
    post('theme.set', { theme });
  }, [ready, theme, post]);

  const sentInsets = useRef<string | null>(null);
  useEffect(() => {
    if (!ready) {
      sentInsets.current = null;
      return;
    }
    const serialised = JSON.stringify(insets);
    if (sentInsets.current === null) {
      sentInsets.current = serialised;
      return;
    }
    if (sentInsets.current === serialised) return;
    sentInsets.current = serialised;
    post('insets.set', insets);
  }, [ready, insets, post]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (readyRef.current) post('app.state', { active: state === 'active' });
    });
    return () => subscription.remove();
  }, [post]);

  /* Android hardware back */
  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        if (!readyRef.current) return false;
        post('nav.back');
        if (navBackTimer.current) clearTimeout(navBackTimer.current);
        navBackTimer.current = setTimeout(() => {
          navBackTimer.current = null;
          onOpenList();
        }, NAV_BACK_TIMEOUT_MS);
        return true;
      });
      return () => {
        subscription.remove();
        if (navBackTimer.current) {
          clearTimeout(navBackTimer.current);
          navBackTimer.current = null;
        }
      };
    }, [post, onOpenList]),
  );

  /* load failure & crash recovery */
  useEffect(() => {
    if (source.status !== 'ready' || ready || failure) return;
    const timer = setTimeout(() => {
      log.error('the web chat never became ready');
      setFailure(LOAD_FAILED);
    }, WEBCHAT_READY_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [source.status, ready, failure, attempt]);

  const retry = useCallback(() => {
    crashCountRef.current = 0;
    setFailure(null);
    setReady(false);
    setAttempt((value) => value + 1);
  }, []);

  const handleCrash = useCallback((reason: string) => {
    log.error('the web chat render process went away', { reason });
    if (crashCountRef.current === 0) {
      crashCountRef.current = 1;
      setReady(false);
      setAttempt((value) => value + 1);
      return;
    }
    setFailure('The chat stopped responding.');
  }, []);

  /* hardening */
  const navigationBase = source.status === 'ready' ? navigationBaseOf(source) : '';
  const sourceUri = source.status === 'ready' ? source.uri : '';
  const sourceIsDev = source.status === 'ready' && source.isDev;
  const originWhitelist = useMemo(
    () => (sourceUri ? originWhitelistOf({ uri: sourceUri, isDev: sourceIsDev }) : ['file://*']),
    [sourceUri, sourceIsDev],
  );

  const onShouldStartLoadWithRequest = useCallback(
    (request: WebViewNavigation) => {
      const url = request.url;
      if (!url) return false;
      if (url === 'about:blank') return true;
      if (isInsideNavigationBase(url, navigationBase)) return true;
      if (/^https?:\/\//i.test(url)) {
        void WebBrowser.openBrowserAsync(url).catch(() => {});
      } else {
        log.warn('blocked a navigation from the web chat', { scheme: url.split(':')[0] });
      }
      return false;
    },
    [navigationBase],
  );

  const errorMessage = failure ?? (source.status === 'missing' ? source.message : null);
  const showOverlay = !ready && !errorMessage;
  const documentUri = source.status === 'ready' ? source.uri : '';

  const onLoadError: WebViewProps['onError'] = ({ nativeEvent }) => {
    log.error('web chat failed to load', { url: nativeEvent.url, description: nativeEvent.description });
    if (isMainFrame(nativeEvent.url, documentUri)) setFailure(LOAD_FAILED);
  };
  const onHttpError: WebViewProps['onHttpError'] = ({ nativeEvent }) => {
    if (isMainFrame(nativeEvent.url, documentUri)) setFailure(LOAD_FAILED);
  };

  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <View
        style={[
          styles.header,
          { paddingTop: safeArea.top, backgroundColor: c.bg, borderBottomColor: c.border },
        ]}
      >
        <TouchableOpacity onPress={onOpenList} hitSlop={10} style={styles.headerButton}>
          <Ionicons name="chevron-back" size={26} color={c.text} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: c.text }]} numberOfLines={1}>
          {title}
        </Text>
        <TouchableOpacity onPress={handleNewChat} hitSlop={10} style={styles.headerButton}>
          <Ionicons name="create-outline" size={24} color={c.text} />
        </TouchableOpacity>
      </View>

      <View style={{ flex: 1 }}>
        {errorMessage ? (
          <ErrorView message={errorMessage} onRetry={retry} />
        ) : (
          source.status === 'ready' && (
            <WebViewView
              key={attempt}
              ref={webviewRef}
              source={{ uri: source.uri }}
              originWhitelist={originWhitelist}
              onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
              onMessage={onMessage}
              javaScriptEnabled
              domStorageEnabled
              allowFileAccess={Platform.OS === 'android'}
              allowFileAccessFromFileURLs={false}
              allowUniversalAccessFromFileURLs={false}
              setSupportMultipleWindows={false}
              allowsInlineMediaPlayback
              mediaPlaybackRequiresUserAction={false}
              keyboardDisplayRequiresUserAction={false}
              overScrollMode="never"
              webviewDebuggingEnabled={__DEV__}
              style={styles.web}
              onError={onLoadError}
              onHttpError={onHttpError}
              onRenderProcessGone={({ nativeEvent }) =>
                handleCrash(nativeEvent.didCrash ? 'crashed' : 'killed')
              }
              onContentProcessDidTerminate={() => handleCrash('content process terminated')}
            />
          )
        )}

        {showOverlay ? (
          // Also a touch shield: the page must not take input before `init`.
          <View
            style={[StyleSheet.absoluteFill, styles.overlay, { backgroundColor: c.bg }]}
            onStartShouldSetResponder={() => true}
            onMoveShouldSetResponder={() => true}
            onResponderTerminationRequest={() => false}
          >
            <ActivityIndicator color={c.primary} size="large" />
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerButton: { width: 44, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '600' },
  web: { flex: 1, backgroundColor: 'transparent' },
  overlay: { alignItems: 'center', justifyContent: 'center' },
});
