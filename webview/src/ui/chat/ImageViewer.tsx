import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { LoaderCircle, X } from 'lucide-react';
import clsx from 'clsx';

import { useTranslation } from '@/i18n';

export type ImageViewerProps = {
  url: string;
  name?: string;
  onClose: () => void;
};

/** Matches the native `ImageViewerModal`'s 150ms reveal. */
const REVEAL_MS = 150;

/**
 * Full-screen look at a sent image. Tap anywhere (or the close button) to
 * dismiss; pinch-zoom is intentionally out of scope for now.
 *
 * Portalled to `document.body` so it escapes the transcript's `overflow: auto`
 * and every stacking context inside it. The ground is black rather than a token
 * surface: a media viewer is black in both themes by convention, and
 * `--color-overlay` is a sheet scrim (45%), far too thin to look at a photo
 * through.
 *
 * The picture fades in over 150ms once it has decoded, behind a spinner until
 * then — the `url` is a presigned link to a full-size photo over a mobile
 * connection, and without the spinner a tap on a thumbnail opens a black screen
 * that looks broken for as long as the download takes. (A spinner, not a
 * skeleton: there is no layout to mirror, and this is in-place feedback on an
 * action the user just took.)
 *
 * **No share button.** The native viewer has one. Sharing has to happen on the
 * native side — the WebView cannot reach the OS share sheet — and
 * `bridge/protocol.ts` has no message for "share this URL"; `attachment.open`
 * is the closest, and it means "hand this file to the OS to open", which is a
 * different action. Adding one is a protocol change in both repos, so it is
 * deliberately left out rather than approximated here.
 */
export function ImageViewer({ url, name, onClose }: ImageViewerProps) {
  const [settled, setSettled] = useState(false);
  const { t } = useTranslation();

  // Reset per `url`, adjusted during render rather than in an effect (the
  // pattern `Sheet.tsx` uses): the same viewer instance can be handed the next
  // image, and a stale `true` would skip both the spinner and the fade for it.
  const [lastUrl, setLastUrl] = useState(url);
  if (lastUrl !== url) {
    setLastUrl(url);
    setSettled(false);
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={name ?? t('attachments.image')}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 p-4"
      style={{
        paddingTop: 'calc(var(--inset-top) + 1rem)',
        paddingBottom: 'calc(var(--inset-bottom) + 1rem)',
      }}
    >
      {!settled ? (
        <LoaderCircle
          size={28}
          className="pointer-events-none absolute animate-spin text-white/80"
          aria-hidden
        />
      ) : null}

      <img
        src={url}
        alt={name ?? ''}
        // The image swallows its own tap so a mis-aimed drag on the photo does
        // not dismiss; the backdrop around it still closes.
        onClick={(event) => event.stopPropagation()}
        onLoad={() => setSettled(true)}
        // A failure settles it too: a spinner that never stops is a worse answer
        // than the browser's own broken-image glyph, because it promises the
        // picture is still coming.
        onError={() => setSettled(true)}
        className={clsx(
          'max-h-full max-w-full object-contain transition-opacity ease-out',
          settled ? 'opacity-100' : 'opacity-0',
        )}
        style={{ transitionDuration: `${REVEAL_MS}ms` }}
      />

      <button
        type="button"
        aria-label={t('common.close')}
        onClick={onClose}
        className="absolute right-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white active:opacity-70"
        style={{ top: 'calc(var(--inset-top) + 1rem)' }}
      >
        <X size={22} strokeWidth={2} aria-hidden />
      </button>
    </div>,
    document.body,
  );
}
