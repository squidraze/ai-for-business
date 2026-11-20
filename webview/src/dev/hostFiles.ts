/**
 * The files the host is holding, for running this app in a plain browser tab.
 *
 * DEV ONLY — reached only from `src/dev/devHost.ts`, which is itself behind the
 * dead-code-eliminated dynamic import in `src/dev/index.ts`.
 *
 * ## Why the host holds anything at all
 *
 * A picked file never crosses the bridge whole. The host keeps the original and
 * sends the web app a `PickedFile`: a native `id` plus a downscaled `dataUri`
 * for the composer chip — a full-size photo as base64 would be tens of megabytes
 * of JSON. When the message is sent the app posts `attachment.upload { id }` and
 * the host uploads the file it still has, answering `attachment.uploaded`.
 *
 * ## The two paths into the composer, and which one this is
 *
 * 1. **Native pick** — the DEV panel's "Pick files (as the host)". This module
 *    opens the input, so the harness ends up holding a real `File` exactly as a
 *    device would, and the whole `attachment.picked` → `attachment.upload` →
 *    `attachment.uploaded` round trip is exercised with real metadata.
 * 2. **Browser fallback** — the composer's own attach button. With no native
 *    host, `openPicker()` falls back to `<input type="file">` in the app, so the
 *    app mints the `id` itself and the host never sees the file. The upload is
 *    still asked for over the bridge, so {@link uploadHeldFile} answers for an
 *    unknown id too, with a placeholder record.
 */

import type { PickedFile } from '@/bridge/protocol';

import { registerUpload } from './mockBackend';

/** Longest edge of the preview the host sends, in CSS pixels. */
const PREVIEW_MAX_EDGE = 512;

/** Above this a non-image gets no preview: the chip draws its icon instead. */
const PREVIEW_MAX_BYTES = 4 * 1024 * 1024;

const held = new Map<string, File>();
/** Preview URIs, kept beside the file so an upload can stand one in for a presigned URL. */
const previews = new Map<string, string>();

let seq = 0;
const nextId = (): string => `host-file-${(seq += 1)}`;

/* ------------------------------------------------------------------ */
/* Previews                                                            */
/* ------------------------------------------------------------------ */

function readDataUri(file: File): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => resolve('');
    reader.readAsDataURL(file);
  });
}

/** Downscale an image to something a JSON message can carry comfortably. */
async function downscale(dataUri: string, type: string): Promise<string> {
  const image = new Image();
  const loaded = new Promise<boolean>((resolve) => {
    image.onload = () => resolve(true);
    image.onerror = () => resolve(false);
  });
  image.src = dataUri;
  if (!(await loaded)) return dataUri;

  const scale = Math.min(1, PREVIEW_MAX_EDGE / Math.max(image.width, image.height));
  if (scale === 1) return dataUri;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(image.width * scale);
  canvas.height = Math.round(image.height * scale);
  const context = canvas.getContext('2d');
  if (!context) return dataUri;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  // PNG keeps transparency; a JPEG preview of a logo would come back on black.
  return canvas.toDataURL(type === 'image/jpeg' ? 'image/jpeg' : 'image/png', 0.8);
}

async function previewFor(file: File): Promise<string> {
  const type = file.type || 'application/octet-stream';
  if (type.startsWith('image/')) return downscale(await readDataUri(file), type);
  if (file.size > PREVIEW_MAX_BYTES) return '';
  return readDataUri(file);
}

/* ------------------------------------------------------------------ */
/* Picking, as the host                                                */
/* ------------------------------------------------------------------ */

function chooseFiles(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.style.display = 'none';
    const finish = (files: File[]): void => {
      input.remove();
      resolve(files);
    };
    input.addEventListener('change', () => finish(Array.from(input.files ?? [])));
    input.addEventListener('cancel', () => finish([]));
    document.body.append(input);
    input.click();
  });
}

/**
 * Open a picker as the *host* would and return what it would post in
 * `attachment.picked`. The originals stay here until the app uploads or releases
 * them.
 */
export async function pickFilesAsHost(): Promise<PickedFile[]> {
  const files = await chooseFiles();
  return Promise.all(
    files.map(async (file): Promise<PickedFile> => {
      const id = nextId();
      const dataUri = await previewFor(file);
      held.set(id, file);
      if (dataUri) previews.set(id, dataUri);
      return {
        id,
        dataUri,
        name: file.name || 'attachment',
        type: file.type || 'application/octet-stream',
        size: file.size,
      };
    }),
  );
}

/* ------------------------------------------------------------------ */
/* Uploading and releasing                                             */
/* ------------------------------------------------------------------ */

/**
 * `attachment.upload`. Returns the uuid the message will carry in `file_uuids`.
 *
 * An id this host never issued is the browser-fallback path (see the header):
 * the file is in the app, not here, so the record is a placeholder. Answering
 * anyway is deliberate — refusing would strand the composer chip in `uploading`
 * for the one picker a developer reaches for most.
 */
export function uploadHeldFile(id: string): string {
  const file = held.get(id);
  if (!file) {
    console.info('%c[dev-host] uploading a file the host does not hold', 'color:#a1a1aa', id);
    return registerUpload({ name: 'attachment', type: 'application/octet-stream', size: 0 });
  }
  return registerUpload({
    name: file.name || 'attachment',
    type: file.type || 'application/octet-stream',
    size: file.size,
    previewUri: previews.get(id) ?? null,
  });
}

/**
 * `attachment.release` — the chip was removed, or the message was sent. Only the
 * retained original goes; the upload record stays, because on a real backend the
 * uploaded file outlives the picker's copy and a sent message still echoes it.
 */
export function releaseHeldFile(id: string): void {
  held.delete(id);
  previews.delete(id);
}

export const heldFileCount = (): number => held.size;
