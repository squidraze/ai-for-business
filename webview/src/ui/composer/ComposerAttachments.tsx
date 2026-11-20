import { TriangleAlert, X } from 'lucide-react';
import clsx from 'clsx';

import {
  iconForAttachment,
  removeAttachment,
  retryAttachment,
  retryFailedAttachments,
  usePendingAttachments,
  usePendingPdfThumbnail,
  type PendingAttachment,
} from '@/attachments';
import { send } from '@/bridge/bridge';
import { useTranslation } from '@/i18n';

/**
 * The row of pending attachments, at the top of the composer card — above the
 * text field, which is where the native composer puts it
 * (`ChatScreen/components/Attachments.tsx`: "the row of pending attachments
 * above the input"). What you attached reads first, and the caption you are
 * typing for it reads second, in that order down the card.
 *
 * One tile per picked file: a thumbnail for an image, a type icon plus the name
 * for anything else. The tile carries its own upload state — a shimmer sweep
 * while it uploads, a red warning that retries on tap when it failed — because
 * the send button is gated on those uploads and the user has to be able to see
 * *which* file is holding it up.
 *
 * Under the row sits a one-line status that mirrors that same gate in words
 * ("Uploading 2 files…", "Couldn't upload 1 file. Tap to retry."), which is the
 * native `AttachmentsStatus`. Without it a disabled send button has no stated
 * reason: the tile overlay is the only clue, and it is 64px away from the button
 * it is disabling.
 *
 * Renders nothing when the composer is empty, so the card keeps its compact
 * two-row height until something is actually attached.
 */

/** Figma: 64px square tiles in a horizontally scrolling row. */
const TILE = 64;

/**
 * The shimmer keyframes ship with the component rather than with the global
 * stylesheet: this is the only sweep in the app, and React 19 hoists and
 * de-duplicates a `<style href>` for us, so it costs one rule no matter how many
 * tiles are uploading.
 */
function ShimmerStyle() {
  return (
    <style href="composer-shimmer" precedence="medium">
      {`@keyframes rooler-shimmer{from{transform:translateX(-100%)}to{transform:translateX(200%)}}
        .rooler-shimmer{animation:rooler-shimmer 1.15s linear infinite}
        @media (prefers-reduced-motion:reduce){.rooler-shimmer{animation:none;opacity:.6}}`}
    </style>
  );
}

/**
 * A light band sweeping across the tile while its bytes are in flight.
 *
 * The two colours here are the one place in the composer that is deliberately
 * *not* a theme token, for the same reason `--color-overlay` in `index.css`
 * isn't: a scrim and its highlight sit on top of arbitrary content (a photo as
 * often as a grey tile), so they are black-on-anything and white-on-anything in
 * both themes. Written as literal `rgb()` rather than a token at an opacity —
 * Tailwind compiles `bg-token/10` to `color-mix()`, which the oldest Android
 * System WebViews we support do not have, and there the fallback is a *fully
 * opaque* fill that would black out the thumbnail.
 */
function UploadingOverlay() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden"
      style={{ backgroundColor: 'rgb(0 0 0 / 0.18)' }}
    >
      <span
        className="rooler-shimmer absolute inset-y-0 -left-full w-full"
        style={{
          background:
            'linear-gradient(90deg, rgb(255 255 255 / 0), rgb(255 255 255 / 0.42), rgb(255 255 255 / 0))',
        }}
      />
    </span>
  );
}

/**
 * Failed upload: the tile stays visible under a scrim, and the whole tile
 * retries. The glyph is 26px on a 64px tile — at 22px it disappeared into a busy
 * photo — and the scrim is `--color-surface-scrim` (the native zinc-200/85 ·
 * zinc-900/85 pair) rather than `bg-surface/80`, which Tailwind compiles to a
 * `color-mix()` the oldest Android WebViews render as an opaque fill.
 */
function ErrorOverlay() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-0 flex items-center justify-center bg-surface-scrim"
    >
      <TriangleAlert size={26} strokeWidth={2} className="text-danger-solid" />
    </span>
  );
}

/** Plural-aware "file" / "files", the native helper. */
/**
 * The line under the tile row (and so still above the text field). Failures win
 * over in-flight uploads: a stuck
 * upload the user can retry is the actionable half, and the two states have
 * different fixes ("wait" vs "tap"). Renders nothing once everything is up.
 */
function AttachmentsStatus({ attachments }: { attachments: PendingAttachment[] }) {
  const failed = attachments.filter((attachment) => attachment.status === 'error').length;
  const uploading = attachments.filter((attachment) => attachment.status === 'uploading').length;
  const { t } = useTranslation();

  if (failed > 0) {
    return (
      <button
        type="button"
        onClick={() => {
          send('haptic', { style: 'tap' });
          retryFailedAttachments();
        }}
        className="flex w-full items-center gap-1.5 px-3 pt-1.5 text-left active:opacity-70"
      >
        {/* The warning glyph carries the alarm; the text stays neutral so this
            compact status does not hand-roll a red error line (the red signal
            lives on the tile overlay and in the toast — see CLAUDE.md). */}
        <TriangleAlert size={13} strokeWidth={2} className="shrink-0 text-danger-solid" aria-hidden />
        <span className="text-[0.75rem] leading-4 text-label-secondary">
          {t('attachments.uploadFailed', { count: failed })}
        </span>
      </button>
    );
  }

  if (uploading > 0) {
    return (
      <div className="flex items-center gap-2 px-3 pt-1.5" role="status">
        {/* A shimmering dot, not a spinner — the same loading language as the
            tiles it is describing. */}
        <span
          aria-hidden
          className="relative h-3 w-3 shrink-0 overflow-hidden rounded-full bg-skeleton"
        >
          <span
            className="rooler-shimmer absolute inset-y-0 -left-full w-full"
            style={{
              background:
                'linear-gradient(90deg, rgb(255 255 255 / 0), rgb(255 255 255 / 0.42), rgb(255 255 255 / 0))',
            }}
          />
        </span>
        <span className="text-[0.75rem] leading-4 text-label-secondary">
          {t('attachments.uploading', { count: uploading })}
        </span>
      </div>
    );
  }

  return null;
}

function Tile({ attachment }: { attachment: PendingAttachment }) {
  const { id, name, contentType, previewUrl, status } = attachment;
  const Icon = iconForAttachment(name, contentType);
  const failed = status === 'error';
  const { t } = useTranslation();

  // Returns null for anything that is not a PDF, so it is safe for every tile —
  // and a PDF that renders shows its first page here, exactly as it will in the
  // bubble once it is sent, instead of a generic document icon.
  const pdfThumbnail = usePendingPdfThumbnail(id, name, contentType);
  const preview = previewUrl ?? pdfThumbnail;

  const body =
    preview !== null ? (
      // `alt=""`: the file name is already announced by the tile's own label, and
      // an object URL has nothing better to say about the picture.
      <img src={preview} alt="" className="h-full w-full object-cover" draggable={false} />
    ) : (
      <span className="flex h-full w-full flex-col items-center justify-center gap-1 px-1">
        {/* `iconForAttachment` is a lookup in a static table of Lucide icons, not
            a component factory: the reference is stable across renders, so the
            identity `static-components` guards is never actually lost. */}
        {/* eslint-disable-next-line react-hooks/static-components */}
        <Icon size={20} strokeWidth={1.75} className="shrink-0 text-label-secondary" aria-hidden />
        <span className="line-clamp-2 text-center text-[0.625rem] leading-[0.75rem] text-label-secondary [overflow-wrap:anywhere]">
          {name}
        </span>
      </span>
    );

  const surface = (
    <>
      {body}
      {status === 'uploading' ? <UploadingOverlay /> : null}
      {failed ? <ErrorOverlay /> : null}
    </>
  );

  return (
    <li className="relative shrink-0" style={{ width: TILE, height: TILE }}>
      {/* Only a failed tile is interactive — tap retries. An uploading or
          uploaded tile has nothing to do, and a button that does nothing invites
          a tap that looks broken. */}
      {failed ? (
        <button
          type="button"
          onClick={() => {
            send('haptic', { style: 'tap' });
            retryAttachment(id);
          }}
          aria-label={t('attachments.retryUpload', { name })}
          className="relative block h-full w-full overflow-hidden rounded-[14px] bg-surface-muted active:opacity-80"
        >
          {surface}
        </button>
      ) : (
        <span className="relative block h-full w-full overflow-hidden rounded-[14px] bg-surface-muted">
          {surface}
        </span>
      )}

      {/* Inside the tile's corner, not overhanging it: the composer card is
          `overflow-hidden`, so a badge that hangs past the tile would be clipped
          on the first and last chip. */}
      <button
        type="button"
        onClick={() => {
          send('haptic', { style: 'tap' });
          removeAttachment(id);
        }}
        aria-label={t('attachments.remove', { name })}
        className={clsx(
          'absolute right-1 top-1 inline-flex h-5 w-5 items-center justify-center rounded-full',
          'border border-border bg-surface text-label shadow-sm active:opacity-70',
        )}
      >
        <X size={12} strokeWidth={2.5} aria-hidden />
      </button>
    </li>
  );
}

export function ComposerAttachments() {
  const attachments = usePendingAttachments();
  const { t } = useTranslation();

  if (attachments.length === 0) return null;

  return (
    // `pt-2.5` opens the card; nothing closes it, because the text row below
    // brings its own 10px of top padding and two paddings would double the gap.
    <div className="pt-2.5">
      <ShimmerStyle />
      {/* Only the tile row scrolls sideways — the status line under it must stay
          put, or a long "Couldn't upload 3 files" would drag the tiles with it. */}
      <div className="overflow-x-auto overscroll-x-contain">
        {/* The padding lives on the inner track, not the scroll container: a
            horizontal flex scroller drops its trailing padding in older Chromium,
            which is exactly what a device WebView can be. */}
        <ul className="flex w-max gap-2 px-3" aria-label={t('attachments.list')}>
          {attachments.map((attachment) => (
            <Tile key={attachment.id} attachment={attachment} />
          ))}
        </ul>
      </div>

      <AttachmentsStatus attachments={attachments} />
    </div>
  );
}
