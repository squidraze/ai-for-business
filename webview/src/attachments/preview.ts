import {
  File as FileIcon,
  FileArchive,
  FileAudio,
  FileCode,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Presentation,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useSyncExternalStore } from 'react';

import { hasNativeHost, on, send } from '@/bridge/bridge';
import { logger } from '@/lib/logger';

const log = logger.child('attachments');

/**
 * What an attachment tile draws: a file-type icon for anything we cannot show a
 * real thumbnail for, and — for PDFs — the rendered first page.
 *
 * Rendering a PDF page is native: the web app posts
 * `attachment.thumbnail.request` and the host answers with
 * `attachment.thumbnail` carrying a data URI (or `null` when it could not render
 * it). Images need none of this — they preview from the local object URL, or from
 * the presigned `download_url` for a history attachment.
 *
 * A PDF is asked for the same way from either side of a send, which is the point
 * of {@link ThumbnailSource}: a sent attachment is identified by its presigned
 * URL, one still sitting in the composer by the id the host retained it under —
 * there is no URL for that one until it has been sent and read back. Both land in
 * the same cache, so the page is rendered once per document either way.
 */

/* ------------------------------------------------------------------ */
/* Icons                                                               */
/* ------------------------------------------------------------------ */

// Extension groups → a Lucide file icon. Extension is checked before MIME because
// a picker often hands back a generic `application/octet-stream` for office files,
// where the extension is the only reliable signal.
const ICON_BY_EXTENSION: Record<string, LucideIcon> = {
  xls: FileSpreadsheet,
  xlsx: FileSpreadsheet,
  csv: FileSpreadsheet,
  ods: FileSpreadsheet,
  numbers: FileSpreadsheet,
  doc: FileText,
  docx: FileText,
  odt: FileText,
  rtf: FileText,
  txt: FileText,
  pages: FileText,
  ppt: Presentation,
  pptx: Presentation,
  key: Presentation,
  zip: FileArchive,
  rar: FileArchive,
  '7z': FileArchive,
  tar: FileArchive,
  gz: FileArchive,
  json: FileCode,
  xml: FileCode,
  html: FileCode,
  js: FileCode,
  ts: FileCode,
  css: FileCode,
  yml: FileCode,
  yaml: FileCode,
};

/** Lower-cased file extension of a name or path (`''` when there is none). */
function extensionOf(name: string): string {
  const base = name.split('?')[0].split('/').pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

/** True for anything we can preview directly, with no thumbnail round-trip. */
export function isImage(contentType: string): boolean {
  return contentType.toLowerCase().startsWith('image/');
}

/**
 * The file-type icon for a non-previewable attachment (docx / xlsx / zip / …).
 * Resolves by extension first, then MIME family, and defaults to a generic file.
 */
export function iconForAttachment(name: string, contentType: string): LucideIcon {
  const byExtension = ICON_BY_EXTENSION[extensionOf(name)];
  if (byExtension) return byExtension;

  const mime = contentType.toLowerCase();
  if (mime === 'application/pdf') return FileText;
  if (mime.startsWith('audio/')) return FileAudio;
  if (mime.startsWith('video/')) return FileVideo;
  if (mime.startsWith('text/')) return FileText;
  if (mime.includes('spreadsheet') || mime.includes('excel') || mime === 'text/csv') {
    return FileSpreadsheet;
  }
  if (mime.includes('presentation') || mime.includes('powerpoint')) return Presentation;
  if (mime.includes('word') || mime.includes('document')) return FileText;
  if (mime.includes('zip') || mime.includes('compressed') || mime.includes('tar')) {
    return FileArchive;
  }
  if (mime.includes('json') || mime.includes('xml') || mime.includes('javascript')) {
    return FileCode;
  }
  return FileIcon;
}

/* ------------------------------------------------------------------ */
/* PDF thumbnails                                                      */
/* ------------------------------------------------------------------ */

/** A host that never answers must not pin a tile in "generating" forever. */
const THUMBNAIL_TIMEOUT_MS = 20_000;

// Keyed by the URL with its query string stripped: a presigned `download_url`
// gets a fresh signature on every history fetch, so the full URL changes while
// the underlying object does not. Keying on the path renders a given PDF once.
const cache = new Map<string, string>();
// Permanent failures (corrupt PDF, host cannot render, no host at all) so a broken
// file degrades to the icon and is never asked for again.
const failed = new Set<string>();
// In-flight requests, so several tiles showing the same PDF ask the host once.
const inflight = new Map<string, number>();
const keyByLocalId = new Map<string, string>();

const listeners = new Set<() => void>();

function emit(): void {
  for (const notify of [...listeners]) notify();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/**
 * What a thumbnail is being asked for. The two carry different identifiers on
 * purpose — see the note at the top of the file.
 */
type ThumbnailSource =
  /** Already on the backend: a presigned `download_url`. */
  | { kind: 'url'; url: string }
  /** Still in the composer: the id the host retained the picked file under. */
  | { kind: 'attachment'; id: string };

/**
 * The cache key. A presigned URL gets a fresh signature on every history fetch,
 * so the query string is stripped and the object's path is what identifies it;
 * a retained pick is identified by its id, namespaced so the two can never
 * collide.
 */
function cacheKeyOf(source: ThumbnailSource): string {
  return source.kind === 'url' ? source.url.split('?')[0] : `attachment:${source.id}`;
}

function settle(key: string, dataUri: string | null): void {
  const timer = inflight.get(key);
  if (timer !== undefined) window.clearTimeout(timer);
  inflight.delete(key);
  if (dataUri) cache.set(key, dataUri);
  else failed.add(key);
  emit();
}

let listening = false;

/**
 * Subscribed lazily on the first request rather than through an explicit
 * lifecycle: the reply handler is pure bookkeeping and has to outlive any tile.
 */
function ensureListener(): void {
  if (listening) return;
  listening = true;
  on('attachment.thumbnail', ({ localId, dataUri }) => {
    const key = keyByLocalId.get(localId);
    if (key === undefined) return; // a reply for a request we already gave up on
    keyByLocalId.delete(localId);
    if (!dataUri) log.warn('pdf thumbnail unavailable', { localId });
    settle(key, dataUri);
  });
}

/** True for a PDF, by MIME first and the URL's extension second. */
function isPdf(url: string, contentType: string): boolean {
  return contentType.toLowerCase() === 'application/pdf' || extensionOf(url) === 'pdf';
}

/**
 * Ask the native host to render a PDF's first page. Cached, de-duplicated and
 * never retried after a failure. Safe to call on every render.
 */
function requestThumbnail(localId: string, source: ThumbnailSource): void {
  const key = cacheKeyOf(source);
  if (cache.has(key) || failed.has(key) || inflight.has(key)) return;

  // In a plain browser there is no renderer — degrade to the icon straight away.
  if (!hasNativeHost()) {
    failed.add(key);
    return;
  }

  ensureListener();
  keyByLocalId.set(localId, key);
  inflight.set(
    key,
    window.setTimeout(() => {
      keyByLocalId.delete(localId);
      log.warn('pdf thumbnail timed out', { localId });
      settle(key, null);
    }, THUMBNAIL_TIMEOUT_MS),
  );
  send(
    'attachment.thumbnail.request',
    source.kind === 'url' ? { localId, url: source.url } : { localId, attachmentId: source.id },
  );
}

/** Render the first page of a PDF that already lives on the backend. */
export function requestPdfThumbnail(localId: string, url: string): void {
  requestThumbnail(localId, { kind: 'url', url });
}

/**
 * The first-page thumbnail for a PDF, or `null` until it is ready (or forever,
 * if the host could not render it). The caller shows the file icon meanwhile.
 * Returns `null` for anything that is not a PDF, so it is safe to call for every
 * attachment.
 */
export function usePdfThumbnail(
  localId: string,
  url: string | null,
  contentType: string,
): string | null {
  const enabled = url !== null && isPdf(url, contentType);
  return useThumbnail(localId, enabled ? { kind: 'url', url: url as string } : null);
}

/**
 * The same first page, addressed by the id the host retained the file under
 * rather than by a URL. Two callers, both without a URL to name the document by:
 *
 *  - the **composer**, where the file has not been sent yet. Without this it
 *    drew a generic icon while the sent bubble drew the document, so one PDF
 *    looked like two different things either side of the send button. The native
 *    composer has rendered it since it was written (`Attachments.tsx`).
 *  - a **just-sent** bubble. The upload response carries no `download_url`, so
 *    the turn has no URL until the thread is reopened — but its page is already
 *    in the cache from the composer, under this very key, so the lookup is a hit
 *    and no second render happens.
 *
 * Pass `null` to disable it: a history attachment names itself with a presigned
 * URL and must go through {@link usePdfThumbnail}, or the host would be asked to
 * find a backend uuid among the files it is holding and answer nothing.
 */
export function usePendingPdfThumbnail(
  attachmentId: string | null,
  name: string,
  contentType: string,
): string | null {
  // By name here, not by URL: a pick has a filename and nothing else.
  const enabled = attachmentId !== null && isPdf(name, contentType);
  return useThumbnail(
    attachmentId ?? '',
    enabled && attachmentId !== null ? { kind: 'attachment', id: attachmentId } : null,
  );
}

/** Shared body of the two hooks: subscribe to the cache, ask once. */
function useThumbnail(localId: string, source: ThumbnailSource | null): string | null {
  const key = source === null ? null : cacheKeyOf(source);

  const thumbnail = useSyncExternalStore(
    subscribe,
    () => (key === null ? null : (cache.get(key) ?? null)),
    () => null,
  );

  useEffect(() => {
    if (source === null) return;
    requestThumbnail(localId, source);
    // `source` is rebuilt on every render; `key` is the value that actually
    // identifies it, so that is what the effect depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, localId]);

  return thumbnail;
}
