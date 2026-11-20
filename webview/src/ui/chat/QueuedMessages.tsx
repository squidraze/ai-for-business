import { send } from '@/bridge/bridge';
import { removeQueuedMessage, sendQueuedNow, useQueuedMessages } from '@/chat';
import { useTranslation } from '@/i18n';
import { Fade } from '@/ui/primitives';

import { MessageAttachments } from './MessageAttachments';

/**
 * The messages waiting for the reply in progress to finish (`chat/queue.ts`), at
 * the end of the thread: each as the user's bubble, dimmed, with "Send now"
 * (stops the reply, then this one goes first) and "Remove" under it — the web
 * client's queue, in this screen's bubble.
 */
export function QueuedMessages() {
  const queued = useQueuedMessages();
  const { t } = useTranslation();
  if (queued.length === 0) return null;

  return queued.map((message) => {
    const hasText = message.text.length > 0;
    const hasAttachments = message.attachments.length > 0;
    return (
      <Fade key={message.id} from="down" enterMs={220} className="flex flex-col items-end gap-1">
        <div className="flex max-w-[85%] flex-col items-end gap-1 opacity-60">
          {hasAttachments ? (
            <MessageAttachments
              attachments={message.attachments}
              caption={hasText ? message.text : undefined}
            />
          ) : null}
          {!hasAttachments && hasText ? (
            <div className="rounded-bubble bg-surface px-4 py-2.5">
              <p className="text-[1rem] leading-[1.375rem] whitespace-pre-wrap text-label [overflow-wrap:anywhere]">
                {message.text}
              </p>
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-3 pt-0.5 text-[0.75rem] leading-4">
          <span className="text-label-tertiary">{t('queue.queued')}</span>
          <button
            type="button"
            className="py-1 font-medium text-primary active:opacity-70"
            onClick={() => {
              send('haptic', { style: 'tap' });
              sendQueuedNow(message.id);
            }}
          >
            {t('queue.sendNow')}
          </button>
          <button
            type="button"
            className="py-1 font-medium text-label-secondary active:opacity-70"
            onClick={() => removeQueuedMessage(message.id)}
          >
            {t('queue.remove')}
          </button>
        </div>
      </Fade>
    );
  });
}
