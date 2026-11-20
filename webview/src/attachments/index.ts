/**
 * The composer's attachment pipeline: pick → upload → preview.
 *
 * `uploads` is the store (a module singleton — there is one composer), `picker`
 * gets files from the native host or a browser input, and `preview` decides what
 * a tile draws.
 */

export {
  addFiles,
  addPickedFiles,
  clearComposerAttachments,
  onUploadError,
  outgoingAttachments,
  removeAttachment,
  retryAttachment,
  retryFailedAttachments,
  takeUploadedUuids,
  useAttachmentsReady,
  usePendingAttachments,
  type PendingAttachment,
  type UploadStatus,
} from './uploads';

export { openAttachment, openPicker, startPickerListener } from './picker';

export {
  iconForAttachment,
  isImage,
  requestPdfThumbnail,
  usePdfThumbnail,
  usePendingPdfThumbnail,
} from './preview';
