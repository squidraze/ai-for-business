import { useSyncExternalStore } from 'react';

import { on, send } from '@/bridge/bridge';
import type { PickedFile } from '@/bridge/protocol';
import { getCompanyForNewThread } from '@/chat/companies';
import type { ChatAttachment } from '@/chat/types';
import { t } from '@/i18n';
import { uploadAttachments } from '@/lib/api/ai';
import { getErrorMessage, isAbortError } from '@/lib/api/errors';
import { logger } from '@/lib/logger';

import { isImage } from './preview';

const log = logger.child('attachments');

/**
 * Attachment uploads for the composer.
 *
 * A picked file is uploaded the moment it is added, and the result is a `uuid`
 * that the message later references via `file_uuids`. Until every attachment
 * reaches `uploaded`, the composer blocks send — see {@link useAttachmentsReady}.
 *
 * There are two intake paths and they do **not** share a transport:
 *
 * - **Native** ({@link addPickedFiles}) — the host picked the file and is still
 *   holding it. We only ever see its `id` and a downscaled preview data URI, so
 *   the upload is the host's: we post `attachment.upload { id }` and wait for
 *   `attachment.uploaded`. The bytes never enter the WebView.
 * - **Browser** ({@link addFiles}) — `npm run dev` in a tab, where the hidden
 *   `<input type="file">` hands us a real `File`. That one goes out through the
 *   normal API call, which is itself proxied by the host/dev-host adapter in
 *   `lib/api/client.ts`.
 *
 * `Entry.source` is the only thing that tells them apart; everything else — the
 * store, the chips, retry, the send gate — is shared.
 *
 * This is a module singleton, not React state: there is exactly one composer,
 * its state must be readable from the send path (outside React) as well as from
 * the UI, and the lifecycle (start on pick, cancel on remove) outlives any single
 * component. Components subscribe through `useSyncExternalStore`.
 */

export type UploadStatus = 'uploading' | 'uploaded' | 'error';

/** One attachment in the composer, as the UI sees it. */
export type PendingAttachment = {
  id: string;
  name: string;
  contentType: string;
  kind: 'image' | 'file';
  /** Image preview: a local object URL (browser) or the host's data URI (native). */
  previewUrl: string | null;
  status: UploadStatus;
  /** Set once uploaded — this is what the message carries in `file_uuids`. */
  uuid?: string;
  error?: string;
};

/** Who holds the bytes, and therefore who performs the upload. */
type Source =
  /** The host retains the file for `Entry.id` until we release it. */
  | { kind: 'native' }
  | { kind: 'file'; file: File };

/** The public shape plus what is needed to cancel and retry. */
type Entry = {
  readonly id: string;
  /** Replaced, never mutated, so a memoised row re-renders only when its own entry changes. */
  attachment: PendingAttachment;
  source: Source;
  /** Identity of the current attempt: a result from any other one is discarded. */
  controller: AbortController;
  /** Native path only — a host that never answers must not pin the chip. */
  timer: number | undefined;
};

/**
 * The RN pipeline has no client-side validation — the OS pickers bounded what
 * could be chosen. A WebView can be handed anything by the host, so a floor
 * lives here instead.
 */
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_ATTACHMENTS = 20;

/** Generous: the host is doing a real multipart upload off a mobile connection. */
const NATIVE_UPLOAD_TIMEOUT_MS = 120_000;

// Functions, so the text is in the language active when the upload fails.
const fallbackError = () => t('attachments.uploadFailedRetry');
const timeoutError = () => t('attachments.uploadTimedOut');
const FALLBACK_CONTENT_TYPE = 'application/octet-stream';

let entries: Entry[] = [];
let snapshot: PendingAttachment[] = [];
const listeners = new Set<() => void>();

// Fired whenever an upload fails, with a user-facing message. Kept separate from
// the snapshot listeners so a single owner (the composer) toasts every failure
// exactly once — the store never renders anything itself.
const errorListeners = new Set<(message: string) => void>();

/** Subscribe to upload failures (for a toast). Returns an unsubscribe. */
export function onUploadError(listener: (message: string) => void): () => void {
  errorListeners.add(listener);
  return () => {
    errorListeners.delete(listener);
  };
}

function emitError(message: string): void {
  for (const notify of [...errorListeners]) notify(message);
}

function commit(): void {
  snapshot = entries.map((entry) => entry.attachment);
  for (const notify of [...listeners]) notify();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

const find = (id: string): Entry | undefined => entries.find((entry) => entry.id === id);

function patch(id: string, changes: Partial<PendingAttachment>): void {
  const entry = find(id);
  if (!entry) return; // removed while in flight — drop the result
  entry.attachment = { ...entry.attachment, ...changes };
  commit();
}

function fail(id: string, message: string): void {
  log.error('attachment upload failed', { id, message });
  patch(id, { status: 'error', error: message });
  emitError(message);
}

/* ------------------------------------------------------------------ */
/* Object URLs                                                         */
/* ------------------------------------------------------------------ */

// Preview URLs handed off to a sent message: `takeUploadedUuids` passes ownership
// to the message bubble, which keeps rendering the local preview until the
// presigned URL arrives. Revoking those would blank the sent thumbnails.
const handedOff = new Set<string>();

function revokePreview(attachment: PendingAttachment): void {
  const url = attachment.previewUrl;
  // A native preview is a data URI: nothing was allocated, so there is nothing
  // to revoke — and `revokeObjectURL` on one is a silent no-op we can skip.
  if (url === null || !url.startsWith('blob:') || handedOff.has(url)) return;
  URL.revokeObjectURL(url);
}

/* ------------------------------------------------------------------ */
/* Native uploads (the host holds the file)                            */
/* ------------------------------------------------------------------ */

let uploadListening = false;

/**
 * Subscribed lazily on the first native upload rather than through an explicit
 * lifecycle: the reply handler is pure bookkeeping over the store and has to
 * outlive any one chip. Registered before the `attachment.upload` that could be
 * answered, so no reply can outrun it.
 */
function ensureUploadListener(): void {
  if (uploadListening) return;
  uploadListening = true;

  on('attachment.uploaded', (payload) => {
    const entry = find(payload.id);
    // Removed while in flight, or never ours to begin with.
    if (!entry || entry.source.kind !== 'native') return;
    clearWatchdog(entry);
    if ('uuid' in payload) {
      patch(payload.id, { status: 'uploaded', uuid: payload.uuid, error: undefined });
      return;
    }
    fail(payload.id, payload.error || fallbackError());
  });
}

function clearWatchdog(entry: Entry): void {
  if (entry.timer !== undefined) window.clearTimeout(entry.timer);
  entry.timer = undefined;
}

function startNativeUpload(entry: Entry): void {
  ensureUploadListener();
  const { id, controller } = entry;

  clearWatchdog(entry);
  entry.timer = window.setTimeout(() => {
    // Superseded by a retry, or removed, while we were waiting.
    if (controller.signal.aborted || find(id)?.controller !== controller) return;
    fail(id, timeoutError());
  }, NATIVE_UPLOAD_TIMEOUT_MS);

  // The picked company rides along while several are selected: before the first
  // message there is no conversation yet to own the file.
  const companyUuid = getCompanyForNewThread();
  send('attachment.upload', companyUuid ? { id, companyUuid } : { id });
}

/** Let the host drop the file it is retaining for a native entry. */
function release(entry: Entry): void {
  if (entry.source.kind === 'native') send('attachment.release', { id: entry.id });
}

/* ------------------------------------------------------------------ */
/* Browser uploads (we hold the File)                                  */
/* ------------------------------------------------------------------ */

async function uploadViaApi(id: string, file: File, controller: AbortController): Promise<void> {
  try {
    const result = await uploadAttachments([file], controller.signal);
    const uuid = result.files?.[0]?.uuid;
    if (!uuid) throw new Error(t('attachments.noUploadedFile'));
    // Bail if the attachment was removed, or a retry superseded this attempt,
    // while the request was in flight — its controller is no longer the active one.
    if (find(id)?.controller !== controller) return;
    patch(id, { status: 'uploaded', uuid, error: undefined });
  } catch (err) {
    // A cancel (remove / retry) is cooperative: never an error state, never a toast.
    if (controller.signal.aborted || isAbortError(err)) return;
    if (find(id)?.controller !== controller) return;
    fail(id, getErrorMessage(err, fallbackError()));
  }
}

/* ------------------------------------------------------------------ */
/* Upload lifecycle                                                    */
/* ------------------------------------------------------------------ */

function startUpload(entry: Entry): void {
  if (entry.source.kind === 'native') startNativeUpload(entry);
  else void uploadViaApi(entry.id, entry.source.file, entry.controller);
}

/** (Re)start the upload for an existing entry under a fresh controller. */
function beginUpload(id: string): void {
  const entry = find(id);
  if (!entry) return;
  entry.controller.abort(); // supersede any attempt still in flight
  entry.controller = new AbortController();
  clearWatchdog(entry);
  entry.attachment = {
    ...entry.attachment,
    status: 'uploading',
    error: undefined,
    uuid: undefined,
  };
  commit();
  startUpload(entry);
}

let seq = 0;
const nextId = (): string => `att-${(seq += 1)}`;

function entryFromFile(file: File): Entry {
  const id = nextId();
  const contentType = file.type || FALLBACK_CONTENT_TYPE;
  const image = isImage(contentType);
  return {
    id,
    attachment: {
      id,
      name: file.name || 'attachment',
      contentType,
      kind: image ? 'image' : 'file',
      // An image previews straight from the local blob; everything else waits for
      // a native thumbnail (PDFs) or falls back to an icon — see `preview.ts`.
      previewUrl: image ? URL.createObjectURL(file) : null,
      status: 'uploading',
    },
    source: { kind: 'file', file },
    controller: new AbortController(),
    timer: undefined,
  };
}

function entryFromPicked(picked: PickedFile): Entry {
  const contentType = picked.type || FALLBACK_CONTENT_TYPE;
  const image = isImage(contentType);
  return {
    // The native id *is* the chip id: `attachment.uploaded` comes back keyed on
    // it, so there is no second table to keep in step.
    id: picked.id,
    attachment: {
      id: picked.id,
      name: picked.name || 'attachment',
      contentType,
      kind: image ? 'image' : 'file',
      // The host answers with an empty string when it could not build a preview
      // (not an image, or over its byte cap) — `PickedFile.dataUri` is a
      // `string`, so that has to be normalised here or the tile renders an
      // `<img src="">`: a blank box where the icon-and-name fallback belongs.
      previewUrl: image && picked.dataUri.length > 0 ? picked.dataUri : null,
      status: 'uploading',
    },
    source: { kind: 'native' },
    controller: new AbortController(),
    timer: undefined,
  };
}

/** Size and per-composer cap, shared by both intake paths. */
function admit<T>(items: T[], sizeOf: (item: T) => number): T[] {
  const withinSize = items.filter((item) => sizeOf(item) <= MAX_FILE_BYTES);
  const oversized = items.length - withinSize.length;
  if (oversized > 0) {
    emitError(t('attachments.tooLarge', { count: oversized }));
  }

  const room = Math.max(0, MAX_ATTACHMENTS - entries.length);
  const accepted = withinSize.slice(0, room);
  if (accepted.length < withinSize.length) {
    emitError(t('attachments.tooMany', { max: MAX_ATTACHMENTS }));
  }
  return accepted;
}

function register(added: Entry[]): void {
  entries = [...entries, ...added];
  commit();
  for (const entry of added) startUpload(entry);
}

/**
 * Files picked by the native host. Registers a chip per file and asks the host to
 * upload the one it is still holding — nothing but the id and the preview crossed
 * the bridge.
 */
export function addPickedFiles(picked: PickedFile[]): void {
  if (picked.length === 0) return;

  const accepted = admit(picked, (file) => file.size);
  // The host retains every file it handed us. Anything we refuse has to be
  // released now or it stays retained for the life of the screen.
  const kept = new Set(accepted);
  for (const file of picked) {
    if (!kept.has(file)) send('attachment.release', { id: file.id });
  }
  if (accepted.length === 0) return;

  register(accepted.map(entryFromPicked));
}

/**
 * Add files the web app itself holds — the `<input type="file">` fallback in a
 * plain browser — and start uploading each immediately, on pick, not on send.
 */
export function addFiles(files: File[]): void {
  if (files.length === 0) return;
  const accepted = admit(files, (file) => file.size);
  if (accepted.length === 0) return;
  register(accepted.map(entryFromFile));
}

/** Remove one attachment, cancelling its upload if it is still in flight. */
export function removeAttachment(id: string): void {
  const entry = find(id);
  if (!entry) return;
  entry.controller.abort();
  clearWatchdog(entry);
  release(entry);
  revokePreview(entry.attachment);
  entries = entries.filter((candidate) => candidate.id !== id);
  commit();
}

/** Retry one failed upload with the same file. */
export function retryAttachment(id: string): void {
  beginUpload(id);
}

/** Retry every failed upload in the composer. */
export function retryFailedAttachments(): void {
  for (const entry of [...entries]) {
    if (entry.attachment.status === 'error') beginUpload(entry.id);
  }
}

/**
 * What the sent bubble draws for the files it carries, in pick order.
 *
 * The upload response has no `download_url` (see `AIUploadedFile`), so a message
 * that was *just* sent has no server URL to render from — only the local preview
 * the composer already has. Handing it over is what makes a photo stay on screen
 * between the send and the next history load; {@link takeUploadedUuids} keeps
 * these previews alive for exactly that reason.
 *
 * Call it **before** `takeUploadedUuids`, which empties the store.
 */
export function outgoingAttachments(): ChatAttachment[] {
  return entries
    .filter((entry) => entry.attachment.status === 'uploaded')
    .map(({ attachment }) => ({
      id: attachment.id,
      name: attachment.name,
      contentType: attachment.contentType,
      kind: attachment.kind,
      url: attachment.previewUrl,
      // Local, and by definition uploaded — the filter above says so. History
      // replaces this whole object on the next read with the backend's own view.
      status: 'uploaded',
      error: null,
    }));
}

/**
 * The `file_uuids` for the message being sent, in order — read **and clear**, so
 * the same uploads can never ride along twice. Only `uploaded` entries are
 * returned and removed; anything still uploading or failed stays in the composer
 * (send is gated on all being uploaded, so at send time that set is empty).
 */
export function takeUploadedUuids(): string[] {
  const uuids: string[] = [];
  const kept: Entry[] = [];

  for (const entry of entries) {
    const { status, uuid, previewUrl } = entry.attachment;
    if (status === 'uploaded' && uuid !== undefined) {
      uuids.push(uuid);
      if (previewUrl !== null) handedOff.add(previewUrl);
      // The upload is done and the message references it by uuid, so the host's
      // copy of the file has no reader left.
      release(entry);
      continue;
    }
    kept.push(entry);
  }

  if (uuids.length > 0) {
    entries = kept;
    commit();
  }
  return uuids;
}

/** Drop every attachment, cancelling in-flight uploads (the user discarded them). */
export function clearComposerAttachments(): void {
  if (entries.length === 0) return;
  for (const entry of entries) {
    entry.controller.abort();
    clearWatchdog(entry);
    release(entry);
    revokePreview(entry.attachment);
  }
  entries = [];
  commit();
}

/* ------------------------------------------------------------------ */
/* React bindings                                                      */
/* ------------------------------------------------------------------ */

const getSnapshot = (): PendingAttachment[] => snapshot;

/** The composer's attachments, in pick order. */
export function usePendingAttachments(): PendingAttachment[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// Vacuously true with nothing attached, so an empty composer is never gated.
const getReady = (): boolean => entries.every((entry) => entry.attachment.status === 'uploaded');

/** The send gate: true once every attachment has finished uploading. */
export function useAttachmentsReady(): boolean {
  return useSyncExternalStore(subscribe, getReady, getReady);
}
