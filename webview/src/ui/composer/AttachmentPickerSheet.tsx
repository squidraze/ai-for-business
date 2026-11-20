import { Camera, ChevronRight, FileUp, Images, Plug, type LucideIcon } from 'lucide-react';
import clsx from 'clsx';
import type { ParseKeys } from 'i18next';
import { useState } from 'react';

import { openPicker } from '@/attachments';
import { send } from '@/bridge/bridge';
import type { AttachmentSource } from '@/bridge/protocol';
import { useTranslation } from '@/i18n';
import { BottomSheet } from '@/ui/primitives';

import { ConnectorsPanel } from './ConnectorsPanel';

/**
 * Where the paperclip leads: camera, photo library or file.
 *
 * Order and labels follow the native sheet
 * (`ai-chat/components/ChatScreen/components/AttachmentPickerSheet.tsx`) so the
 * WebView and the rest of the app ask for a file the same way. Native renders
 * them as a three-tile grid; here they are rows, which is what the composer spec
 * asks for and what a sheet on a touch web surface reads as.
 *
 * The picker is launched *after* the sheet has closed. On iOS the host presents
 * a native modal, and presenting one while our sheet is still animating out
 * either fails outright or leaves the picker unresponsive — the same reason the
 * native sheet defers.
 */

/** Matches `BottomSheet`'s own exit animation. */
const SHEET_EXIT_MS = 260;

type Source = { icon: LucideIcon; label: ParseKeys<'chat'>; source: AttachmentSource };

const SOURCES: Source[] = [
  { icon: Camera, label: 'attachments.sources.camera', source: 'camera' },
  { icon: Images, label: 'attachments.sources.photos', source: 'library' },
  { icon: FileUp, label: 'attachments.sources.files', source: 'files' },
];

export type AttachmentPickerSheetProps = {
  isOpen: boolean;
  /** Called once the slide-out finishes — flip `isOpen` here. */
  onClose: () => void;
};

function SourceRow({
  icon: Icon,
  label,
  isLast,
  trailing,
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  isLast: boolean;
  trailing?: React.ReactNode;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      className={clsx(
        'flex w-full items-center gap-4 py-4 text-left active:opacity-60',
        !isLast && 'border-b border-border',
      )}
    >
      <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-muted">
        <Icon size={20} strokeWidth={2} className="text-label-secondary" aria-hidden />
      </span>
      <span className="min-w-0 flex-1 truncate text-base text-label">{label}</span>
      {trailing}
    </button>
  );
}

export function AttachmentPickerSheet({ isOpen, onClose }: AttachmentPickerSheetProps) {
  // The sheet has two pages: where a file comes from, and the Connectors switches
  // (the web client's "+" menu: "Add files or photos", then "Connectors ▸").
  const [page, setPage] = useState<'sources' | 'connectors'>('sources');
  const { t } = useTranslation();

  return (
    <BottomSheet
      isOpen={isOpen}
      // Every open starts on the sources — the connectors page is a step inside
      // it. Reset once the slide-out is over, so the page does not flip under it.
      onClose={() => {
        setPage('sources');
        onClose();
      }}
      title={t('attachments.sheetTitle')}
    >
      {({ close }) => (
        <div className="px-5 pb-6">
          {page === 'connectors' ? (
            <ConnectorsPanel
              onBack={() => setPage('sources')}
              onManage={() => {
                send('haptic', { style: 'tap' });
                close();
                // The host's own sheet, after ours is gone — the same reason the
                // pickers wait (see the note at the top).
                window.setTimeout(() => send('open.integrations'), SHEET_EXIT_MS);
              }}
            />
          ) : (
            <>
              {SOURCES.map(({ icon, label, source }) => (
                <SourceRow
                  key={source}
                  icon={icon}
                  label={t(label)}
                  isLast={false}
                  onPress={() => {
                    send('haptic', { style: 'tap' });
                    close();
                    // Deferred past the slide-out — see the note at the top.
                    window.setTimeout(() => openPicker(source), SHEET_EXIT_MS);
                  }}
                />
              ))}
              <SourceRow
                icon={Plug}
                label={t('connectors.title')}
                isLast
                trailing={<ChevronRight size={20} className="text-label-tertiary" aria-hidden />}
                onPress={() => {
                  send('haptic', { style: 'tap' });
                  setPage('connectors');
                }}
              />
            </>
          )}
        </div>
      )}
    </BottomSheet>
  );
}
