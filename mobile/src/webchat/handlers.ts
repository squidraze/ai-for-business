/**
 * One handler per web -> native message — the whole native surface the WebView
 * chat can reach. Simplified copy of the Rooler business app's
 * src/features/ai-chat/webchat/handlers.ts (no PostHog, i18n, companies, voice,
 * report sheet or PDF thumbnails).
 *
 * Load-bearing security notes kept from the original:
 * - no token crosses the bridge: the page has no network of its own and sends
 *   `http.request`; the host performs it with the authenticated axios client;
 * - a proxied `url` must pass `asApiPath` (relative `/api/…` only);
 * - the proxy is bounded (MAX_INFLIGHT_REQUESTS) and every request is abortable;
 * - `open.url` goes to expo-web-browser, never an in-place navigation.
 */
import axios from 'axios';
import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import { File as FsFile } from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import * as WebBrowser from 'expo-web-browser';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import { Alert } from 'react-native';

import { api, CONVERSATIONS_KEY, errorMessage, getToken, isAbortError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { APP_VERSION, COMPANY_ID } from '@/lib/config';
import { createLogger } from '@/lib/log';
import { useThemeName } from '@/lib/theme';

import {
  asApiPath,
  asHttpMethod,
  asHttpUrl,
  asQueryParams,
  asRecord,
  asText,
  type BridgePost,
} from './bridge';
import { WEBCHAT_PLACEHOLDER_MARKER } from './bundle';
import type {
  AttachmentSource,
  HttpRequest,
  HttpResponse,
  InitPayload,
  Insets,
  PickedFile,
  ThreadTarget,
  WebToNativeMessage,
} from './protocol';

const log = createLogger('webchat');

type HttpFailure = Extract<HttpResponse, { ok: false }>;

const MAX_INFLIGHT_REQUESTS = 8;
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const MAX_RETAINED_ATTACHMENTS = 20;
const PREVIEW_MAX_BYTES = 4 * 1024 * 1024;

const SESSION_EXPIRED = 'Your session has expired. Please sign in again.';

function resolveLocale(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale || 'en-US';
  } catch {
    return 'en-US';
  }
}

type InFlight = { controller: AbortController; aborted: boolean };

function toHttpFailure(requestId: string, error: unknown, aborted: boolean): HttpFailure {
  if (aborted || isAbortError(error)) {
    return { requestId, ok: false, code: 'ERR_CANCELED', message: 'The request was cancelled.' };
  }
  if (axios.isAxiosError(error)) {
    const failure: HttpFailure = { requestId, ok: false, message: error.message };
    if (error.code) failure.code = error.code;
    if (error.response) {
      failure.status = error.response.status;
      failure.data = error.response.data;
    }
    return failure;
  }
  return { requestId, ok: false, message: error instanceof Error ? error.message : String(error) };
}

function describeRefusedTarget(value: unknown): string {
  if (typeof value !== 'string') return `<${typeof value}>`;
  return value.length > 200 ? `${value.slice(0, 200)}…` : value;
}

type RetainedFile = {
  uri: string;
  name: string;
  type: string;
  size: number;
  controller: AbortController | null;
};

let attachmentSequence = 0;
function nextAttachmentId(): string {
  attachmentSequence += 1;
  return `att-${Date.now().toString(36)}-${attachmentSequence}`;
}

async function buildPreview(file: FsFile, type: string, bytes: number): Promise<string> {
  if (!type.startsWith('image/') || bytes > PREVIEW_MAX_BYTES) return '';
  try {
    return `data:${type};base64,${await file.base64()}`;
  } catch (error) {
    log.warn('failed to build an attachment preview', String(error));
    return '';
  }
}

export type WebChatHandlerOptions = {
  post: BridgePost;
  threadId: ThreadTarget;
  getInsets: () => Insets;
  onBooted: () => void;
  onInitialised: () => void;
  onInitFailed: (message: string) => void;
  onTitle: (title: string) => void;
  onOpenList: () => void;
  onOpenIntegrations: () => void;
  onNavConsumed: (consumed: boolean) => void;
  onBundleMissing: () => void;
};

export function useWebChatHandlers(options: WebChatHandlerOptions) {
  const { post } = options;
  const theme = useThemeName();
  const { user, status } = useAuth();
  const queryClient = useQueryClient();

  const optionsRef = useRef(options);
  const stateRef = useRef({ theme, userUuid: user?.uuid ?? '' });
  useEffect(() => {
    optionsRef.current = options;
    stateRef.current = { theme, userUuid: user?.uuid ?? '' };
  });

  const inFlightRef = useRef(new Map<string, InFlight>());
  const retainedRef = useRef(new Map<string, RetainedFile>());
  /** The conversation the page is actually on (truth over the route param). */
  const liveConversationRef = useRef<string | null>(null);

  const setLiveConversation = useCallback((conversationUuid: string | null) => {
    liveConversationRef.current = conversationUuid;
  }, []);

  const invalidateConversations = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: CONVERSATIONS_KEY });
  }, [queryClient]);

  /* teardown */
  useEffect(() => {
    const inFlight = inFlightRef.current;
    const retained = retainedRef.current;
    return () => {
      for (const entry of inFlight.values()) {
        entry.aborted = true;
        entry.controller.abort();
      }
      inFlight.clear();
      for (const entry of retained.values()) entry.controller?.abort();
      retained.clear();
    };
  }, []);

  /* session */
  useEffect(() => {
    if (status !== 'signedOut') return;
    post('session.lost', { message: SESSION_EXPIRED });
    for (const entry of inFlightRef.current.values()) {
      entry.aborted = true;
      entry.controller.abort();
    }
  }, [status, post]);

  /* init */
  const sendInit = useCallback(() => {
    if (!getToken()) {
      post('session.lost', { message: SESSION_EXPIRED });
      optionsRef.current.onInitFailed(SESSION_EXPIRED);
      return;
    }
    const { theme: currentTheme, userUuid } = stateRef.current;
    const payload: InitPayload = {
      companyId: COMPANY_ID,
      userUuid,
      threadId: liveConversationRef.current ?? optionsRef.current.threadId,
      theme: currentTheme,
      insets: optionsRef.current.getInsets(),
      locale: resolveLocale(),
      appVersion: APP_VERSION,
      devMode: __DEV__,
    };
    post('init', payload);
    optionsRef.current.onInitialised();
  }, [post]);

  /* HTTP proxy */
  const runProxiedRequest = useCallback(
    async (request: HttpRequest) => {
      const entry: InFlight = { controller: new AbortController(), aborted: false };
      inFlightRef.current.set(request.requestId, entry);
      try {
        const response = await api.request({
          method: request.method,
          url: request.url,
          params: request.params,
          ...(request.body === undefined ? {} : { data: request.body }),
          signal: entry.controller.signal,
        });
        post('http.response', {
          requestId: request.requestId,
          ok: true,
          status: response.status,
          data: response.data,
        });
      } catch (error) {
        const failure = toHttpFailure(request.requestId, error, entry.aborted);
        if (failure.code !== 'ERR_CANCELED') {
          log.warn('a proxied request failed', {
            method: request.method,
            url: request.url,
            status: failure.status,
            code: failure.code,
          });
        }
        post('http.response', failure);
      } finally {
        if (inFlightRef.current.get(request.requestId) === entry) {
          inFlightRef.current.delete(request.requestId);
        }
      }
    },
    [post],
  );

  const startProxiedRequest = useCallback(
    (payload: Record<string, unknown> | null) => {
      const requestId = asText(payload?.requestId);
      if (!requestId) {
        log.warn('dropped an http.request with no requestId');
        return;
      }
      const refuse = (code: string, message: string) =>
        post('http.response', { requestId, ok: false, code, message });

      const method = asHttpMethod(payload?.method);
      if (!method) {
        refuse('ERR_BAD_REQUEST', 'Unsupported HTTP method.');
        return;
      }
      // THE security check: only relative /api/ paths on our own backend.
      const url = asApiPath(payload?.url);
      if (!url) {
        log.error('refused an http.request outside /api/', {
          requestId,
          method,
          target: describeRefusedTarget(payload?.url),
        });
        refuse('ERR_FORBIDDEN_TARGET', 'Only relative /api/ paths are allowed.');
        return;
      }
      if (inFlightRef.current.has(requestId)) {
        refuse('ERR_DUPLICATE_REQUEST', 'A request with that id is already in flight.');
        return;
      }
      if (inFlightRef.current.size >= MAX_INFLIGHT_REQUESTS) {
        refuse('ERR_TOO_MANY_REQUESTS', 'Too many requests in flight. Try again.');
        return;
      }
      void runProxiedRequest({
        requestId,
        method,
        url,
        params: asQueryParams(payload?.params) ?? undefined,
        body: payload?.body,
      });
    },
    [post, runProxiedRequest],
  );

  const abortProxiedRequest = useCallback((payload: Record<string, unknown> | null) => {
    const requestId = asText(payload?.requestId);
    if (!requestId) return;
    const entry = inFlightRef.current.get(requestId);
    if (!entry) return;
    entry.aborted = true;
    entry.controller.abort();
  }, []);

  /* attachments */
  const retainPickedFile = useCallback(
    async (uri: string, name: string, type: string, size: number | undefined) => {
      if (retainedRef.current.size >= MAX_RETAINED_ATTACHMENTS) return null;
      try {
        const file = new FsFile(uri);
        const bytes = typeof size === 'number' && size > 0 ? size : (file.size ?? 0);
        if (bytes > MAX_ATTACHMENT_BYTES) {
          Alert.alert('File too large', `${name} is larger than 20 MB.`);
          return null;
        }
        const id = nextAttachmentId();
        retainedRef.current.set(id, { uri, name, type, size: bytes, controller: null });
        const picked: PickedFile = {
          id,
          dataUri: await buildPreview(file, type, bytes),
          name,
          type,
          size: bytes,
        };
        return picked;
      } catch (error) {
        log.warn('failed to read a picked file', String(error));
        return null;
      }
    },
    [],
  );

  const mapImageAssets = useCallback(
    async (assets: ImagePicker.ImagePickerAsset[]) => {
      const files = await Promise.all(
        assets.map((asset) =>
          retainPickedFile(
            asset.uri,
            asset.fileName ?? asset.uri.split('/').pop() ?? 'image.jpg',
            asset.mimeType ?? 'image/jpeg',
            asset.fileSize,
          ),
        ),
      );
      return files.filter((file): file is PickedFile => file !== null);
    },
    [retainPickedFile],
  );

  const pickFiles = useCallback(
    async (source: AttachmentSource): Promise<PickedFile[] | null> => {
      try {
        if (source === 'camera') {
          const permission = await ImagePicker.requestCameraPermissionsAsync();
          if (!permission.granted) {
            Alert.alert('Camera', 'Allow camera access in the system settings to take a photo.');
            return null;
          }
          const result = await ImagePicker.launchCameraAsync({ quality: 0.85 });
          if (result.canceled) return null;
          return await mapImageAssets(result.assets);
        }
        if (source === 'library') {
          const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            allowsMultipleSelection: true,
            quality: 0.85,
          });
          if (result.canceled) return null;
          return await mapImageAssets(result.assets);
        }
        const result = await DocumentPicker.getDocumentAsync({
          multiple: true,
          copyToCacheDirectory: true,
        });
        if (result.canceled) return null;
        const files = await Promise.all(
          result.assets.map((asset) =>
            retainPickedFile(
              asset.uri,
              asset.name,
              asset.mimeType ?? 'application/octet-stream',
              asset.size,
            ),
          ),
        );
        return files.filter((file): file is PickedFile => file !== null);
      } catch (error) {
        if (isAbortError(error)) return null;
        log.warn('attachment picker failed', String(error));
        Alert.alert('Attachment', errorMessage(error, 'Could not open the picker'));
        return null;
      }
    },
    [mapImageAssets, retainPickedFile],
  );

  const uploadRetainedFile = useCallback(
    async (id: string) => {
      const entry = retainedRef.current.get(id);
      if (!entry) {
        post('attachment.uploaded', { id, error: 'The file is no longer available.' });
        return;
      }
      if (entry.controller) return;
      const controller = new AbortController();
      entry.controller = controller;
      try {
        const form = new FormData();
        form.append('files', { uri: entry.uri, name: entry.name, type: entry.type } as unknown as Blob);
        const { data } = await api.post<{ files?: { uuid: string }[] }>(
          '/api/v1/ai/attachments',
          form,
          {
            headers: { 'Content-Type': 'multipart/form-data' },
            signal: controller.signal,
            transformRequest: (body) => body,
          },
        );
        if (retainedRef.current.get(id) !== entry) return;
        entry.controller = null;
        const uuid = data.files?.[0]?.uuid;
        if (!uuid) {
          post('attachment.uploaded', { id, error: 'The upload returned no file.' });
          return;
        }
        post('attachment.uploaded', { id, uuid });
      } catch (error) {
        if (retainedRef.current.get(id) !== entry) return;
        entry.controller = null;
        if (isAbortError(error)) return;
        const message = errorMessage(error, 'Upload failed');
        log.error('web chat attachment upload failed', { id, message });
        post('attachment.uploaded', { id, error: message });
      }
    },
    [post],
  );

  const releaseRetainedFile = useCallback((id: string) => {
    const entry = retainedRef.current.get(id);
    if (!entry) return;
    entry.controller?.abort();
    retainedRef.current.delete(id);
  }, []);

  const openInBrowser = (url: string) =>
    void WebBrowser.openBrowserAsync(url).catch((error: unknown) =>
      log.warn('failed to open a URL', String(error)),
    );

  const copy = (text: string) =>
    void Clipboard.setStringAsync(text).catch((error: unknown) =>
      log.warn('clipboard write failed', String(error)),
    );

  /* the switch */
  const handleWebMessage = useCallback(
    (message: WebToNativeMessage) => {
      const payload = asRecord(message.payload);

      switch (message.type) {
        case 'ready': {
          log.info('web chat ready', { version: asText(payload?.version) ?? 'unknown' });
          optionsRef.current.onBooted();
          sendInit();
          return;
        }
        case 'http.request':
          startProxiedRequest(payload);
          return;
        case 'http.abort':
          abortProxiedRequest(payload);
          return;
        case 'attachment.pick': {
          const source = payload?.source;
          const valid: AttachmentSource | null =
            source === 'camera' || source === 'library' || source === 'files' ? source : null;
          if (!valid) {
            post('attachment.pick.cancelled');
            return;
          }
          void (async () => {
            const files = await pickFiles(valid);
            if (!files || files.length === 0) post('attachment.pick.cancelled');
            else post('attachment.picked', { files });
          })();
          return;
        }
        case 'attachment.upload': {
          const id = asText(payload?.id);
          if (id) void uploadRetainedFile(id);
          return;
        }
        case 'attachment.release': {
          const id = asText(payload?.id);
          if (id) releaseRetainedFile(id);
          return;
        }
        case 'attachment.open': {
          const url = asHttpUrl(payload?.url);
          if (url) openInBrowser(url);
          return;
        }
        case 'attachment.thumbnail.request': {
          // No PDF thumbnailer in the demo: answer at once so the tile doesn't wait.
          const localId = asText(payload?.localId);
          if (localId) post('attachment.thumbnail', { localId, dataUri: null });
          return;
        }
        case 'clipboard.write': {
          const text = asText(payload?.text);
          if (text) copy(text);
          return;
        }
        case 'haptic': {
          const style = payload?.style;
          if (style === 'success')
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          else if (style === 'warning')
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
          else void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
          return;
        }
        case 'open.url': {
          const url = asHttpUrl(payload?.url);
          if (url) openInBrowser(url);
          else log.warn('refused open.url for a non-http(s) target');
          return;
        }
        case 'open.voice':
          Alert.alert('Voice', 'Voice is not available in the demo');
          return;
        case 'open.list':
          optionsRef.current.onOpenList();
          return;
        case 'open.integrations':
          optionsRef.current.onOpenIntegrations();
          return;
        case 'report.open':
          Alert.alert('Thanks', 'Reporting responses is not available in the demo.');
          return;
        case 'thread.created': {
          const conversationUuid = asText(payload?.conversationUuid);
          if (!conversationUuid) return;
          liveConversationRef.current = conversationUuid;
          invalidateConversations();
          return;
        }
        case 'thread.titled': {
          const title = asText(payload?.title);
          const conversationUuid = asText(payload?.conversationUuid);
          if (conversationUuid) liveConversationRef.current = conversationUuid;
          if (title) optionsRef.current.onTitle(title);
          invalidateConversations();
          return;
        }
        case 'thread.changed':
          liveConversationRef.current = asText(payload?.conversationUuid);
          return;
        case 'nav.consumed':
          optionsRef.current.onNavConsumed(payload?.consumed === true);
          return;
        case 'generative.action': {
          const action = asText(payload?.action);
          const params = asRecord(payload?.params) ?? {};
          if (action === 'open_url') {
            const url = asHttpUrl(params.url);
            if (url) openInBrowser(url);
          } else if (action === 'copy') {
            const text = asText(params.text);
            if (text) copy(text);
          } else {
            log.warn('dropped a generative action outside the allowlist', { action });
          }
          return;
        }
        case 'log': {
          const line = `[web] ${asText(payload?.message) ?? ''}`;
          const level = payload?.level;
          if (level === 'error') log.error(line, payload?.context);
          else if (level === 'warn') log.warn(line, payload?.context);
          else log.debug(line, payload?.context);
          return;
        }
        case 'error': {
          const text = asText(payload?.message) ?? 'unknown web chat error';
          if (text.includes(WEBCHAT_PLACEHOLDER_MARKER)) {
            optionsRef.current.onBundleMissing();
            return;
          }
          log.error(`[web] ${text}`, { stack: asText(payload?.stack) ?? undefined });
          return;
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      post,
      sendInit,
      startProxiedRequest,
      abortProxiedRequest,
      pickFiles,
      uploadRetainedFile,
      releaseRetainedFile,
      invalidateConversations,
    ],
  );

  return { handleWebMessage, setLiveConversation };
}
