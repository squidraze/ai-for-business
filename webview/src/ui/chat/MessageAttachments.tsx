import { createElement, useCallback, useEffect, useRef, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import clsx from 'clsx';

import {
  iconForAttachment,
  openAttachment,
  usePdfThumbnail,
  usePendingPdfThumbnail,
} from '@/attachments';
import { send } from '@/bridge/bridge';
import type { ChatAttachment } from '@/chat/types';
import { useTranslation } from '@/i18n';
import { Skeleton, useToast } from '@/ui/primitives';

import { ExpandableText } from './ExpandableText';
import { ImageViewer } from './ImageViewer';

/**
 * What the user sent, drawn as (and inside) their bubble. Figma 3234:71111: an
 * attached image *replaces* the bubble — the white pill becomes a 2px frame
 * around the picture, and the message text, if any, becomes a caption inside
 * that same frame.
 *
 * **Several photos share one frame.** They are a mosaic inside it, not a stack
 * of separate bubbles: 2px between the tiles, and the 19px radius only on the
 * frame's own outer corners, so the group reads as a single card rather than as
 * several messages sent at once — which is what a photo per bubble looked like.
 *
 * The overflow count on the fourth tile is informational: tapping it opens that
 * photo, because the viewer shows one image and has no gallery to page through.
 * A gallery is the change that would make the count tappable as a count.
 *
 * Non-image files stay one per frame. They are not in the Figma, they have no
 * common aspect ratio to tile against, and a PDF's first page in a 85px corner
 * of a mosaic would be unreadable.
 */

/** The frame's inner width — Figma 3234:71185 measures 176 across a 2px inset. */
const CONTENT_WIDTH = 172;

/**
 * The mosaic's geometry, straight off the Figma.
 *
 * One and two photos are portrait; three is square (65 + 2 + 105 = 172, the same
 * as the width). Every number here is a measured node, except {@link QUAD_CELL}
 * — see {@link mosaicRows}.
 */
const SOLO_HEIGHT = 216;
/** A captioned photo gives up height to the text sharing its frame (3234:71194). */
const SOLO_HEIGHT_WITH_CAPTION = 96;
const PAIR_ROW = 105;
const TRIO_TOP_ROW = 65;
const TRIO_BOTTOM_ROW = 105;
/**
 * Four and more are **not** in the Figma, which stops at three. A 2×2 keeps the
 * square the three-photo case established, so the bubble does not change shape
 * as one more photo is attached; 85 is what that square divides into around the
 * 2px gap. Beyond four the last cell counts the rest — the alternative is a
 * bubble that grows without bound in a transcript.
 */
const QUAD_CELL = 85;
/** Non-image files aren't in the Figma; they reuse the composer's 96px tile. */
const FILE_TILE = 96;

/** The frame: a 20px white card whose 2px inset leaves 19px for the tiles. */
const FRAME = 'overflow-hidden rounded-bubble bg-surface p-[2px]';
const TILE_RADIUS = 19;
const GAP = 2;

/**
 * How long the "opening…" spinner runs.
 *
 * `attachment.open` is fire-and-forget — `bridge/protocol.ts` has no reply for
 * it, and the host's answer is a native share sheet appearing *over* this
 * WebView, which the page cannot observe. So the spinner is a fixed window
 * rather than a real progress state: long enough to cover the download of a
 * document off a mobile connection, short enough that it is gone by the time the
 * user dismisses the sheet and looks back. The native tile has the same overlay
 * driven by a real `isOpening` flag (`hooks/openAttachment.ts`); if the protocol
 * ever grows an ack, this timer is what it replaces.
 */
const OPEN_FEEDBACK_MS = 1500;

/**
 * Tapping a non-image hands the file to the OS. Without any feedback the tap
 * reads as "nothing happened" for however long the host takes to download it and
 * present the sheet.
 */
function useAttachmentOpener() {
  const [isOpening, setIsOpening] = useState(false);
  const timer = useRef<number | null>(null);
  const { show } = useToast();
  const { t } = useTranslation();

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const open = useCallback(
    (attachment: ChatAttachment) => {
      send('haptic', { style: 'tap' });
      openAttachment(attachment);

      // Nothing to open. Say so out loud rather than running the "opening…"
      // spinner over a tap that cannot lead anywhere — a tile that reacts and then
      // does nothing reads as a broken app, when the honest answer is that the
      // file has no download link on it.
      if (attachment.url === null) {
        show(
          attachment.status === 'failed'
            ? t('attachments.notUploaded')
            : t('attachments.notAvailable'),
          { type: 'error' },
        );
        return;
      }

      setIsOpening(true);
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setIsOpening(false), OPEN_FEEDBACK_MS);
    },
    [show, t],
  );

  return { isOpening, open };
}

/** A dim scrim + spinner over a tile while its file is on its way to the OS. */
function OpeningOverlay() {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-0 flex items-center justify-center"
      // A literal `rgb(… / …)`, not `bg-black/30`: Tailwind compiles that to a
      // `color-mix()` the oldest Android WebViews fall back to as opaque black.
      style={{ backgroundColor: 'rgb(0 0 0 / 0.3)' }}
    >
      <LoaderCircle size={22} className="animate-spin text-white" />
    </span>
  );
}

/* ---------------------------------------------------------------- */
/* The photo mosaic                                                  */
/* ---------------------------------------------------------------- */

/** Which of a tile's corners are on the frame's outside, and so are rounded. */
type Corners = { tl?: boolean; tr?: boolean; bl?: boolean; br?: boolean };

function cornerRadii(corners: Corners) {
  return {
    borderTopLeftRadius: corners.tl ? TILE_RADIUS : 0,
    borderTopRightRadius: corners.tr ? TILE_RADIUS : 0,
    borderBottomLeftRadius: corners.bl ? TILE_RADIUS : 0,
    borderBottomRightRadius: corners.br ? TILE_RADIUS : 0,
  };
}

/** One row of the mosaic: how tall it is, and which photos sit in it. */
type MosaicRow = { height: number; photos: ChatAttachment[] };

/**
 * Lay the photos out. The shapes come from the Figma for one, two and three;
 * four and more extend it as documented on {@link QUAD_CELL}.
 *
 * The small row goes **on top** for three — that is what the Figma draws, and it
 * puts the single large photo nearest the caption and the bubble's tail.
 */
function mosaicRows(photos: ChatAttachment[], soloHeight: number): MosaicRow[] {
  if (photos.length === 1) return [{ height: soloHeight, photos }];
  if (photos.length === 2) {
    return [
      { height: PAIR_ROW, photos: [photos[0]] },
      { height: PAIR_ROW, photos: [photos[1]] },
    ];
  }
  if (photos.length === 3) {
    return [
      { height: TRIO_TOP_ROW, photos: photos.slice(0, 2) },
      { height: TRIO_BOTTOM_ROW, photos: [photos[2]] },
    ];
  }
  return [
    { height: QUAD_CELL, photos: photos.slice(0, 2) },
    { height: QUAD_CELL, photos: photos.slice(2, 4) },
  ];
}

function PhotoCell({
  attachment,
  corners,
  remaining,
  onOpen,
}: {
  attachment: ChatAttachment;
  corners: Corners;
  /** How many photos this cell stands in for beyond itself — draws "+N". */
  remaining: number;
  onOpen: (attachment: ChatAttachment) => void;
}) {
  const radii = cornerRadii(corners);
  const { t } = useTranslation();

  // Still processing on the backend: no url, nothing to draw yet.
  if (attachment.url === null) {
    return <Skeleton className="h-full min-w-px flex-1" style={radii} />;
  }

  return (
    <button
      type="button"
      // What it does, not what the count suggests: tapping opens this photo.
      // The viewer shows one image and has no gallery to page through, so a
      // label promising `+N more` would be a promise the tap does not keep.
      aria-label={t('attachments.view', { name: attachment.name })}
      onClick={() => {
        send('haptic', { style: 'tap' });
        onOpen(attachment);
      }}
      style={radii}
      className="relative block h-full min-w-px flex-1 overflow-hidden active:opacity-90"
    >
      <img
        src={attachment.url}
        alt={attachment.name}
        className="block size-full bg-surface-muted object-cover"
      />
      {remaining > 0 ? (
        // The count stands on a scrim rather than on the photo: a light picture
        // underneath would otherwise swallow it. Same literal rgb() as the
        // opening overlay, for the same old-WebView reason.
        <span
          className="absolute inset-0 flex items-center justify-center text-[1.25rem] leading-7 font-semibold text-white"
          style={{ backgroundColor: 'rgb(0 0 0 / 0.45)' }}
        >
          +{remaining}
        </span>
      ) : null}
    </button>
  );
}

function PhotoMosaic({
  photos,
  soloHeight,
  onOpen,
}: {
  photos: ChatAttachment[];
  soloHeight: number;
  onOpen: (attachment: ChatAttachment) => void;
}) {
  const rows = mosaicRows(photos, soloHeight);
  const shown = rows.reduce((count, row) => count + row.photos.length, 0);
  const { t } = useTranslation();

  return (
    <div
      className="flex flex-col"
      style={{ width: CONTENT_WIDTH, gap: GAP }}
      // One label for the group: a screen reader announcing four buttons in a
      // row is noise where "4 photos" is the message.
      role="group"
      aria-label={t('attachments.photos', { count: photos.length })}
    >
      {rows.map((row, rowIndex) => {
        const isFirstRow = rowIndex === 0;
        const isLastRow = rowIndex === rows.length - 1;
        return (
          <div
            key={`row-${rowIndex}`}
            className="flex"
            style={{ height: row.height, gap: GAP }}
          >
            {row.photos.map((photo, cellIndex) => {
              const isFirstCell = cellIndex === 0;
              const isLastCell = cellIndex === row.photos.length - 1;
              // The last cell of the last row absorbs whatever did not fit.
              const isFinalCell = isLastRow && isLastCell;
              return (
                <PhotoCell
                  key={photo.id}
                  attachment={photo}
                  corners={{
                    tl: isFirstRow && isFirstCell,
                    tr: isFirstRow && isLastCell,
                    bl: isLastRow && isFirstCell,
                    br: isLastRow && isLastCell,
                  }}
                  remaining={isFinalCell ? photos.length - shown : 0}
                  onOpen={onOpen}
                />
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* Files                                                             */
/* ---------------------------------------------------------------- */

function FileTile({ attachment }: { attachment: ChatAttachment }) {
  const { id, name, contentType, url } = attachment;
  // Returns null for anything that isn't a PDF, so it is safe to call for every
  // tile — and a PDF that renders gets its first page instead of a generic icon.
  const pdfThumbnail = usePdfThumbnail(id, url, contentType);
  // A turn that was *just* sent has no presigned URL yet (the upload response
  // carries none), so the hook above has nothing to work with and the document
  // fell back to a generic icon until the thread was reopened. Its page is
  // already rendered and cached from the composer under the same id — this is
  // that cache hit, and it is disabled the moment a real URL exists.
  const pendingThumbnail = usePendingPdfThumbnail(url === null ? id : null, name, contentType);
  const preview = pdfThumbnail ?? pendingThumbnail;
  const opener = useAttachmentOpener();
  const { t } = useTranslation();

  if (preview !== null) {
    return (
      <button
        type="button"
        aria-label={t('attachments.open', { name })}
        onClick={() => opener.open(attachment)}
        className="relative block overflow-hidden rounded-[19px] active:opacity-90"
      >
        <img
          src={preview}
          alt={name}
          style={{ width: CONTENT_WIDTH, height: SOLO_HEIGHT }}
          className="block rounded-[19px] bg-surface-muted object-cover"
        />
        {opener.isOpening ? <OpeningOverlay /> : null}
      </button>
    );
  }

  return (
    <button
      type="button"
      aria-label={t('attachments.open', { name })}
      onClick={() => opener.open(attachment)}
      style={{ width: FILE_TILE, height: FILE_TILE }}
      className="relative flex flex-col items-center justify-center gap-1 overflow-hidden rounded-[19px] bg-surface-muted px-2 active:opacity-80"
    >
      {/* `createElement`, not `<Icon />`: the glyph is a registry lookup, and
          binding it to a capitalised local reads to the linter as a component
          declared during render (which would reset its state every frame). */}
      {createElement(iconForAttachment(name, contentType), {
        size: 24,
        strokeWidth: 1.75,
        className: 'text-label-secondary',
        'aria-hidden': true,
      })}
      <span className="line-clamp-2 text-center text-[0.6875rem] leading-[0.875rem] text-label-secondary [overflow-wrap:anywhere]">
        {name}
      </span>
      {opener.isOpening ? <OpeningOverlay /> : null}
    </button>
  );
}

/** The message text, sharing the frame with what it was sent alongside. */
function Caption({ text }: { text: string }) {
  return (
    // No fill and no radius: sampled from 3234:71111, the caption sits directly
    // on the frame's white (255,255,255 edge to edge, no inner pill) — the radius
    // that used to be here was inert.
    <div className="px-2 py-1">
      {/* Folded past 200 characters like a bubble's own text: a caption shares a
          176px frame with a photo, so a long one buries the photo it captions. */}
      <ExpandableText
        text={text}
        className="text-[0.875rem] leading-[1.375rem] whitespace-pre-wrap text-label [overflow-wrap:anywhere]"
      />
    </div>
  );
}

/* ---------------------------------------------------------------- */
/* The message's attachments                                         */
/* ---------------------------------------------------------------- */

export type MessageAttachmentsProps = {
  attachments: ChatAttachment[];
  /** The message text. Rendered as a caption inside the last frame. */
  caption?: string;
  /**
   * Which edge the frames hug. `'end'` is the user's side of the thread and the
   * default; a file the assistant delivered hangs off the left like the rest of
   * its turn.
   */
  align?: 'start' | 'end';
};

export function MessageAttachments({
  attachments,
  caption,
  align = 'end',
}: MessageAttachmentsProps) {
  const [viewing, setViewing] = useState<ChatAttachment | null>(null);
  const hasCaption = caption !== undefined && caption.trim().length > 0;

  // `kind` rather than the mime type: it is what the mapping already decided,
  // and a PDF is `file` even though its tile draws a picture of its first page.
  const photos = attachments.filter((attachment) => attachment.kind === 'image');
  const files = attachments.filter((attachment) => attachment.kind !== 'image');

  // The caption belongs to the message, so it goes in the last frame drawn —
  // and a lone photo gives up height to it, which is the Figma's captioned case.
  const captionOnPhotos = hasCaption && files.length === 0;
  const soloHeight =
    captionOnPhotos && photos.length === 1 ? SOLO_HEIGHT_WITH_CAPTION : SOLO_HEIGHT;

  return (
    <div
      className={clsx(
        'flex flex-col gap-1',
        align === 'start' ? 'items-start' : 'items-end',
      )}
    >
      {photos.length > 0 ? (
        <div className={FRAME}>
          <PhotoMosaic photos={photos} soloHeight={soloHeight} onOpen={setViewing} />
          {captionOnPhotos ? <Caption text={caption} /> : null}
        </div>
      ) : null}

      {files.map((file, index) => {
        const captioned = hasCaption && !captionOnPhotos && index === files.length - 1;
        return (
          <div key={file.id} className={clsx(FRAME, 'flex flex-col')}>
            <FileTile attachment={file} />
            {captioned ? <Caption text={caption} /> : null}
          </div>
        );
      })}

      {viewing?.url ? (
        <ImageViewer url={viewing.url} name={viewing.name} onClose={() => setViewing(null)} />
      ) : null}
    </div>
  );
}
