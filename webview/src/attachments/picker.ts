import { hasNativeHost, on, send } from '@/bridge/bridge';
import type { AttachmentSource } from '@/bridge/protocol';
import { logger } from '@/lib/logger';

import { addFiles, addPickedFiles } from './uploads';

const log = logger.child('attachments');

/**
 * Getting files from the user.
 *
 * Picking is native: the web app posts `attachment.pick` and the host opens the
 * camera / photo library / document picker, answering with `attachment.picked`
 * or `attachment.pick.cancelled`. What comes back is an `id` and a **preview**
 * data URI — the host keeps the original and performs the upload itself, so the
 * file's bytes never cross the bridge and a full-size photo is not turned into
 * tens of megabytes of base64. The store takes it from there (`addPickedFiles`).
 *
 * Outside the host (`npm run dev` in a browser) the same three sources fall back
 * to a hidden `<input type="file">`, which yields a real `File` and goes down the
 * other branch of the store (`addFiles`).
 */

/* ------------------------------------------------------------------ */
/* Browser fallback                                                    */
/* ------------------------------------------------------------------ */

/** `accept` / `capture` per source, matching what the native pickers offer. */
function configureInput(input: HTMLInputElement, source: AttachmentSource): void {
  input.multiple = source !== 'camera';
  if (source === 'camera') {
    input.accept = 'image/*';
    input.capture = 'environment';
    return;
  }
  if (source === 'library') input.accept = 'image/*';
}

function openBrowserPicker(source: AttachmentSource): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.style.display = 'none';
  configureInput(input, source);

  const cleanup = (): void => input.remove();
  input.addEventListener('change', () => {
    addFiles(Array.from(input.files ?? []));
    cleanup();
  });
  // Not every browser fires `cancel`; a stray hidden input is harmless either way.
  input.addEventListener('cancel', cleanup);

  document.body.append(input);
  input.click();
}

/* ------------------------------------------------------------------ */
/* Native picking                                                      */
/* ------------------------------------------------------------------ */

/** Ask for files from one of the three sources. Results arrive over the bridge. */
export function openPicker(source: AttachmentSource): void {
  if (!hasNativeHost()) {
    openBrowserPicker(source);
    return;
  }
  send('attachment.pick', { source });
}

/**
 * Subscribe to the host's picker replies and feed them into the upload store.
 * Mount once, next to the composer. Returns an unsubscribe.
 */
export function startPickerListener(): () => void {
  const offPicked = on('attachment.picked', (payload) => {
    // Handed over as one batch so it keeps its pick order and meets the
    // per-composer cap as a group.
    addPickedFiles(payload.files);
  });

  // Cancelling is not an error and leaves no state behind — logged only.
  const offCancelled = on('attachment.pick.cancelled', () => {
    log.debug('attachment pick cancelled');
  });

  return () => {
    offPicked();
    offCancelled();
  };
}

/**
 * Hand a file to the native side to open or share. In a browser it opens in a
 * new tab instead. A `null` url means the backend is still processing the file,
 * so there is nothing to open yet.
 */
export function openAttachment(attachment: {
  url: string | null;
  name: string;
  contentType: string;
  id?: string;
  status?: string;
  error?: string | null;
}): void {
  const { url, name, contentType } = attachment;
  if (url === null) {
    // `status` is the backend's own word for why. Without it this line could only
    // ever say "no url", which is the symptom, not the reason — and a file the
    // user uploaded an hour ago coming back with no url on a *history* read is a
    // different problem from one that is genuinely still being processed.
    log.warn('attachment has no url — nothing to open', {
      name,
      id: attachment.id,
      status: attachment.status,
      error: attachment.error,
      contentType,
    });
    return;
  }

  if (!hasNativeHost()) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  send('attachment.open', { url, name, mime: contentType });
}
