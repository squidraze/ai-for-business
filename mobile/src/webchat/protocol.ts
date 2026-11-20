/**
 * The bridge contract between the native host (apps/business,
 * src/features/ai-chat/webchat) and this web app.
 *
 * SOURCE OF TRUTH. This file is copied verbatim into the Expo app by
 * `npm run sync` — edit it here, never there.
 *
 * Rules:
 * - One JSON envelope in both directions.
 * - The surface is narrow and enumerated. There is no "call anything" message,
 *   deliberately: Apple guideline 4.7.2 forbids exposing native APIs to
 *   embedded software.
 * - An unknown `type` is logged and ignored. Neither side ever throws on one.
 */

export const BRIDGE_PROTOCOL_VERSION = 1;

export type BridgeEnvelope = {
  v: typeof BRIDGE_PROTOCOL_VERSION;
  type: string;
  /** Set on request/response pairs so a reply can be matched to its request. */
  id?: string;
  payload?: unknown;
};

export type ThemeName = 'light' | 'dark';

export type Insets = {
  top: number;
  bottom: number;
  left: number;
  right: number;
  /** Keyboard height in CSS pixels; 0 when closed. iOS only — Android resizes. */
  keyboard: number;
};

/** The one thread the WebView shows. `'new'` means "not created yet". */
export type ThreadTarget = string | 'new';

/**
 * A company a new conversation may belong to (organization restructure: one
 * organization, several carriers in it).
 */
export type CompanyChoice = { uuid: string; name: string };

export type InitPayload = {
  /**
   * No token, deliberately. Every request goes out through the host
   * (`http.request`), which already holds the session — so neither the access
   * token nor the refresh token has to enter the WebView at all.
   */
  companyId: string;
  userUuid: string;
  threadId: ThreadTarget;
  theme: ThemeName;
  insets: Insets;
  locale: string;
  appVersion: string;
  /** True in a debug build: enables the /ui demo commands and verbose logging. */
  devMode: boolean;
  /**
   * The companies a NEW conversation may be started in — sent only while the
   * host has several selected ("All companies"), when the backend needs to be
   * told which one owns a new thread (and pays for it). Absent or shorter than
   * two: there is nothing to choose, the header decides. `companyId` is the
   * default pick. Optional, so an older host and a newer page still agree.
   */
  companies?: CompanyChoice[];
};

export type PickedFile = {
  /** Native-generated. The web app keys its composer chip on this, and hands it
   *  back in `attachment.upload` — the host still holds the real file. */
  id: string;
  /** A preview only. The host keeps the original for the upload, so this can be
   *  downscaled: a full-size photo as base64 would cross the bridge as tens of
   *  megabytes of string. */
  dataUri: string;
  name: string;
  type: string;
  size: number;
};

/* ------------------------------------------------------------------ */
/* HTTP over the bridge                                                */
/* ------------------------------------------------------------------ */

/**
 * The page is loaded from `file://`, so its origin is `null` and every API call
 * is cross-origin. The backend runs a strict CORS allowlist with
 * `allow-credentials: true` — it answers `400 Disallowed CORS origin` to `null`
 * and cannot fall back to `*`. So the web app does not talk to the network at
 * all: the host performs every request with the session it already holds.
 *
 * The access token therefore never has to reach the WebView for REST.
 */
export type HttpMethod = 'get' | 'post' | 'patch' | 'put' | 'delete';

export type HttpRequest = {
  requestId: string;
  method: HttpMethod;
  /** Path only, relative to the host's `baseURL`. Never an absolute URL. */
  url: string;
  params?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
};

export type HttpResponse =
  | { requestId: string; ok: true; status: number; data: unknown }
  | {
      requestId: string;
      ok: false;
      /** Absent when the request never reached the server. */
      status?: number;
      /** Axios-style code, e.g. ERR_NETWORK / ECONNABORTED / ERR_CANCELED. */
      code?: string;
      message: string;
      /** The error body, when there was one — the web app reads `detail` from it. */
      data?: unknown;
    };

/* ------------------------------------------------------------------ */
/* Native -> Web                                                       */
/* ------------------------------------------------------------------ */

export type NativeToWebMessage =
  | { type: 'init'; payload: InitPayload }
  | { type: 'theme.set'; payload: { theme: ThemeName } }
  /** The app's UI language changed while the chat is open — an `Intl` locale, like `init.locale`. */
  | { type: 'locale.set'; payload: { locale: string } }
  | { type: 'insets.set'; payload: Insets }
  /** The host lost the session and is signing the user out. Stop retrying. */
  | { type: 'session.lost'; payload: { message: string } }
  | { type: 'thread.switch'; payload: { threadId: ThreadTarget } }
  | { type: 'http.response'; payload: HttpResponse }
  | { type: 'attachment.picked'; payload: { files: PickedFile[] } }
  | { type: 'attachment.pick.cancelled'; payload?: undefined }
  | {
      type: 'attachment.uploaded';
      payload: { id: string; uuid: string } | { id: string; error: string };
    }
  | { type: 'attachment.thumbnail'; payload: { localId: string; dataUri: string | null } }
  | { type: 'voice.ended'; payload: { conversationUuid: string | null } }
  | { type: 'app.state'; payload: { active: boolean } }
  | { type: 'nav.back'; payload?: undefined };

/* ------------------------------------------------------------------ */
/* Web -> Native                                                       */
/* ------------------------------------------------------------------ */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type AttachmentSource = 'camera' | 'library' | 'files';

/** Actions an AI-rendered block may ask the app to perform. Allowlist. */
export type GenerativeAction =
  | { action: 'open_shipment'; params: { uuid: string } }
  | { action: 'open_url'; params: { url: string } }
  | { action: 'copy'; params: { text: string } };

export type WebToNativeMessage =
  | { type: 'ready'; payload: { version: string } }
  | { type: 'http.request'; payload: HttpRequest }
  | { type: 'http.abort'; payload: { requestId: string } }
  | { type: 'attachment.pick'; payload: { source: AttachmentSource } }
  /** Upload the file the host is still holding for `id`. */
  | {
      type: 'attachment.upload';
      /**
       * `companyUuid` — the company picked for the conversation this file will
       * start, while several are selected. The host ignores it once the open
       * thread exists (that conversation's company owns the file).
       */
      payload: { id: string; companyUuid?: string };
    }
  /** Drop the retained file: the chip was removed, or the message was sent. */
  | { type: 'attachment.release'; payload: { id: string } }
  | { type: 'attachment.open'; payload: { url: string; name: string; mime: string } }
  /**
   * Render a PDF's first page. Exactly one source is set: `url` for an
   * attachment that already lives on the backend (a presigned `download_url`),
   * `attachmentId` for one the host is still holding from the picker — the
   * composer has no URL for those, only the id it was handed in `PickedFile`.
   */
  | {
      type: 'attachment.thumbnail.request';
      payload: { localId: string; url: string } | { localId: string; attachmentId: string };
    }
  | { type: 'clipboard.write'; payload: { text: string } }
  | { type: 'haptic'; payload: { style: 'tap' | 'success' | 'warning' } }
  | { type: 'open.url'; payload: { url: string } }
  /**
   * `companyUuid` — the company picked for the conversation a voice call with no
   * thread yet will start, while several are selected (the composer's pill).
   */
  | { type: 'open.voice'; payload: { conversationUuid: string | null; companyUuid?: string } }
  | { type: 'open.list'; payload?: undefined }
  /**
   * "Add connector" / "Manage connectors" in the "+" menu: the host's own
   * Integrations sheet. Connecting an app is an OAuth flow in the system browser,
   * which only the host can run. The web app re-reads its switches the next time
   * the menu opens, so nothing comes back over the bridge.
   */
  | { type: 'open.integrations'; payload?: undefined }
  /**
   * "Report this response" on an assistant reply: the host's own report sheet
   * (reason picker → `POST /api/v1/user-reports`, plus its success or error
   * toast). Only a reply the server has stored can be reported, so both uuids are
   * required. Nothing comes back over the bridge.
   */
  | { type: 'report.open'; payload: { conversationUuid: string; messageUuid: string } }
  | { type: 'thread.created'; payload: { conversationUuid: string } }
  | { type: 'thread.titled'; payload: { conversationUuid: string; title: string } }
  | { type: 'thread.changed'; payload: { conversationUuid: string } }
  | { type: 'nav.consumed'; payload: { consumed: boolean } }
  | { type: 'generative.action'; payload: GenerativeAction }
  | { type: 'log'; payload: { level: LogLevel; message: string; context?: unknown } }
  | { type: 'error'; payload: { message: string; stack?: string; context?: unknown } };

export type NativeToWebType = NativeToWebMessage['type'];
export type WebToNativeType = WebToNativeMessage['type'];

export type NativeToWebPayload<T extends NativeToWebType> = Extract<
  NativeToWebMessage,
  { type: T }
>['payload'];

export type WebToNativePayload<T extends WebToNativeType> = Extract<
  WebToNativeMessage,
  { type: T }
>['payload'];

/** Runtime guard: an envelope arriving from the other side is untrusted input. */
export function isBridgeEnvelope(value: unknown): value is BridgeEnvelope {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.v === BRIDGE_PROTOCOL_VERSION && typeof candidate.type === 'string';
}
