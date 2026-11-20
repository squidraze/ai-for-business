import { useState } from 'react';

import { send } from '@/bridge/bridge';
import { useTranslation } from '@/i18n';
import { BottomSheet, PrimaryButton } from '@/ui/primitives';

/**
 * "Delete this message?" — the step between the menu's red row and the request.
 *
 * The native chat deletes straight from its actions sheet, because reaching that
 * row there already takes a long press and a deliberate tap on a drawer. Here
 * the row sits in a small popover a stray tap can land on, and a delete is the
 * one message action that cannot be taken back — regenerate and edit fork, a
 * rating clears — so it asks once.
 *
 * The sheet stays up with a spinner on the button until the server has answered,
 * then closes either way; the caller owns the outcome (a re-read transcript, or
 * an error toast).
 */

export type DeleteMessageSheetProps = {
  isOpen: boolean;
  /** Called once the slide-out finishes — clear the pending delete here. */
  onClose: () => void;
  /** Perform the delete. Resolves when the server has answered, either way. */
  onConfirm: () => Promise<unknown>;
  /** A run is live: the delete waits for it, and the button says so by dimming. */
  disabled?: boolean;
};

export function DeleteMessageSheet({
  isOpen,
  onClose,
  onConfirm,
  disabled = false,
}: DeleteMessageSheetProps) {
  const { t } = useTranslation();
  const [pending, setPending] = useState(false);

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} title={t('message.deleteTitle')}>
      {({ close }) => (
        <div className="flex flex-col gap-5 px-5 pb-6">
          <p className="text-[0.9375rem] leading-5 text-label-secondary">
            {t('message.deleteDescription')}
          </p>
          <div className="flex gap-3">
            <PrimaryButton variant="neutral" onPress={close} disabled={pending} className="flex-1">
              {t('common.cancel')}
            </PrimaryButton>
            <PrimaryButton
              variant="destructive"
              loading={pending}
              disabled={disabled}
              onPress={() => {
                send('haptic', { style: 'warning' });
                setPending(true);
                void onConfirm().finally(() => {
                  setPending(false);
                  close();
                });
              }}
              className="flex-1"
            >
              {t('message.deleteConfirm')}
            </PrimaryButton>
          </div>
        </div>
      )}
    </BottomSheet>
  );
}
