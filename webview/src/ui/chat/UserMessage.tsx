import { memo } from 'react';
import clsx from 'clsx';

import { useBranchInfo } from '@/chat/branches';
import type { UserMessage as UserMessageModel } from '@/chat/types';
import { useTranslation } from '@/i18n';
import { ErrorState, Fade, useLongPress } from '@/ui/primitives';

import { BranchSwitcher } from './BranchSwitcher';
import { ExpandableText } from './ExpandableText';
import { MessageAttachments } from './MessageAttachments';
import { MessageEditor } from './MessageEditor';

export type UserMessageProps = {
  message: UserMessageModel;
  /** Resend a message whose status is `failed`. */
  onRetry?: () => void;
  /** Press-and-hold on the bubble — the caller opens `MessageMenu` on it. */
  onLongPress?: (element: HTMLElement) => void;
  /** The bubble is currently an editor (the caller owns which message that is). */
  isEditing?: boolean;
  /** Commit the edited text: forks a new version of this turn and re-answers it. */
  onEditSubmit?: (text: string) => void;
  onEditCancel?: () => void;
};

/**
 * A user turn. Figma 3234:70940: a right-aligned white bubble on the screen
 * background — 20px radius, 16/10 padding, 16px/22px text — with the time
 * beneath it, 2px down, in the tertiary label colour.
 *
 * **No timestamp under the bubble.** The Figma draws one, and it was there; a
 * time on every turn is noise on a screen where the whole conversation happened
 * a minute ago. It lives in the long-press menu now, which is also where
 * "Edit message" lives and where the actions this bubble will grow (copy, select
 * text) belong.
 *
 * The Figma also draws messenger read-receipt ticks next to that time. Those are
 * not drawn on purpose: this is an AI chat, there is no "delivered" or "read" to
 * report, and a tick that never means anything is worse than no tick.
 *
 * With attachments the bubble *is* the frame (see MessageAttachments), so the
 * text becomes the caption inside it rather than a second bubble underneath.
 *
 * **Editing rewrites in place, and forks on the server.** The bubble becomes a
 * field holding the same text; committing it calls `POST .../edit`, which creates
 * a *sibling* of this turn rather than overwriting it. Nothing is lost — the
 * original stays reachable through the switcher below, which is exactly why an
 * edit is safe to offer inline instead of behind a confirmation.
 *
 * Attachments are deliberately not editable: the edit endpoint takes `content`
 * and nothing else, so the files ride along with the version they were sent on.
 *
 * It rises 8px into place as it fades in, over 220ms — the native bubble's
 * `FadeInDown.duration(220)`. A send is the one thing in this screen the user
 * just did, so it is the one thing that gets a direction.
 */
function UserMessageBase({
  message,
  onRetry,
  onLongPress,
  isEditing = false,
  onEditSubmit,
  onEditCancel,
}: UserMessageProps) {
  const { text, attachments, status, error } = message;
  const { t } = useTranslation();
  const hasAttachments = attachments.length > 0;
  const hasText = text.trim().length > 0;
  // No-op when the caller passed nothing, so the hook's rules stay unconditional.
  const longPress = useLongPress(onLongPress ?? (() => {}));
  const branch = useBranchInfo(message.uuid, message.siblingCount);

  return (
    <Fade
      from="down"
      enterMs={220}
      className={clsx(
        'flex flex-col items-end gap-0.5',
        // The optimistic bubble exists before the POST resolves; dimming it is
        // the whole "sending" affordance — a spinner per bubble is noise.
        status === 'sending' && !isEditing && 'opacity-60',
      )}
    >
      {isEditing ? (
        <MessageEditor
          initialText={text}
          onSubmit={(edited) => onEditSubmit?.(edited)}
          onCancel={() => onEditCancel?.()}
        />
      ) : (
        /* The hold target hugs the bubble rather than filling the row: pressing
           the empty column beside a short message is not pressing the message. */
        <div {...longPress} className="flex max-w-[85%] flex-col items-end gap-1">
          {hasAttachments ? (
            <MessageAttachments attachments={attachments} caption={hasText ? text : undefined} />
          ) : null}

          {!hasAttachments && hasText ? (
            <div className="rounded-bubble bg-surface px-4 py-2.5">
              {/* Folded past 200 characters — see ExpandableText for why the fold
                  is here and not in the composer. */}
              <ExpandableText
                text={text}
                className="text-[1rem] leading-[1.375rem] whitespace-pre-wrap text-label [overflow-wrap:anywhere]"
              />
            </div>
          ) : null}
        </div>
      )}

      {/* Under the bubble, on the same edge — a question with alternates reads as
          one turn with versions, not as several turns. */}
      {branch && message.uuid && !isEditing ? (
        <BranchSwitcher messageUuid={message.uuid} info={branch} className="pt-0.5" />
      ) : null}

      {status === 'failed' && onRetry ? (
        // The app's one error component, the same one every other failure uses.
        // It used to be a bare 12px red caption under the bubble, which read as a
        // delivery receipt rather than as an error. Not `fullScreen`: the failure
        // belongs to this one send, in a transcript that may already have content
        // above it — the native app only goes full-screen when the failed send
        // was the *first* one and there is no transcript yet.
        <div className="w-full pt-1">
          {/* The reason, when the server gave one: "not sent" alone leaves a 413
              or a 429 indistinguishable from being offline, so the retry looks
              futile. */}
          <ErrorState
            title={t('message.notSent')}
            message={error && error.length > 0 ? error : t('message.notSentHint')}
            onRetry={onRetry}
          />
        </div>
      ) : null}
    </Fade>
  );
}

/** Memoised: a streaming token must not re-render every bubble above it. */
export const UserMessage = memo(UserMessageBase);
