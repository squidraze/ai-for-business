import { useCallback, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';

import { useAttachmentsReady, usePendingAttachments } from '@/attachments';
import { send } from '@/bridge/bridge';
import type { ThreadTarget } from '@/bridge/protocol';
import { getChatState } from '@/chat';
import { isUserMessage } from '@/chat/types';
import { useChatActions, useChatState } from '@/chat/useChat';
import { useTranslation } from '@/i18n';
import { getErrorMessage } from '@/lib/api/errors';
import { ChatSkeleton, ErrorBoundary, ErrorState, Fade, useToast } from '@/ui/primitives';

import { AssistantMessage } from './AssistantMessage';
import { DeleteMessageSheet } from './DeleteMessageSheet';
import { EmptyThread } from './EmptyThread';
import { QueuedMessages } from './QueuedMessages';
import { MessageMenu, type MessageMenuAction, type MessageMenuTarget } from './MessageMenu';
import { ScrollToBottomButton } from './ScrollToBottomButton';
import { UserMessage } from './UserMessage';

/**
 * The conversation transcript.
 *
 * **Scrolling.** The list opens on the newest message and stays there while
 * tokens stream in — unless the user has scrolled away, in which case it must
 * not yank them back. That is done with an explicit "pinned" flag plus a
 * `ResizeObserver` on the content, rather than an inverted list: inversion
 * fights text selection in a browser, and `flex-direction: column-reverse` would
 * also bottom-align a three-message thread, which the Figma does not do (a short
 * transcript starts at the top).
 *
 * **States**, in this order: loading → error → empty → data. A failed history
 * load must never look like an empty conversation, so `EmptyThread` is reachable
 * only from a `ready` status.
 *
 * **The message menu lives here, not in the rows.** One portal for the whole
 * transcript rather than one per message: a hundred rows would otherwise each
 * carry the machinery for a panel only one of them can show, and the memoised
 * rows would re-render whenever it opened. A row only reports *that* it was
 * held and *where*; this decides what the menu says.
 */

/**
 * How long the skeleton and the real transcript overlap. The native
 * `ChatSkeleton` crossfades over `EXPO_PUBLIC_FADE_MS` (500 by default) and the
 * host paints it on top of this WebView until the page is ready, so the handover
 * has to happen at the same speed or it reads as two separate loads.
 */
const SKELETON_FADE_MS = 500;

/** How far up the user must scroll before "jump to latest" appears. */
const JUMP_THRESHOLD = 240;
/** Slack around the bottom that still counts as pinned (rounding, keyboard). */
const PIN_TOLERANCE = 32;

export type MessageListProps = {
  /** Layout only — the page shell owns the composer and the insets. */
  className?: string;
};

export function MessageList({ className }: MessageListProps) {
  const { messages, historyStatus, historyError, threadId, isRunning } = useChatState();
  const { deleteMessage, editUserMessage, regenerate, retryHistory, retryLastSend, sendMessage } =
    useChatActions();
  const attachments = usePendingAttachments();
  const attachmentsReady = useAttachmentsReady();
  const { show } = useToast();
  const { t } = useTranslation();

  // The held message, or null. Holds the measured rect rather than the element:
  // the menu is placed once, and a transcript that grows underneath it (a token
  // arriving) must not drag the panel around.
  const [menu, setMenu] = useState<MessageMenuTarget | null>(null);
  // Which user bubble is currently an editor, if any. One at a time, and owned
  // here rather than in the row: a row is memoised and unmounts on every history
  // reload, which is exactly what a branch switch does.
  //
  // It is stamped with the thread it belongs to and read back through that stamp,
  // rather than cleared from an effect on `threadId`. Same outcome, one render
  // instead of two — and the open editor can never be reattached to a message in
  // a thread it was not opened in. (A *branch* switch needs no clearing at all: the
  // message it was opened on is gone from the list, so no row matches the id.)
  const [editing, setEditing] = useState<{ threadId: ThreadTarget; id: string } | null>(null);
  const editingId = editing && editing.threadId === threadId ? editing.id : null;
  const openEditor = useCallback(
    (id: string) => setEditing({ threadId: getChatState().threadId, id }),
    [],
  );
  const closeEditor = useCallback(() => setEditing(null), []);

  // The message waiting on "Delete this message?", if any — stamped with its
  // thread for the same reason `editing` is.
  const [deleting, setDeleting] = useState<{ threadId: ThreadTarget; id: string } | null>(null);
  const deletingId = deleting && deleting.threadId === threadId ? deleting.id : null;
  const askToDelete = useCallback(
    (id: string) => setDeleting({ threadId: getChatState().threadId, id }),
    [],
  );
  const confirmDelete = useCallback(async () => {
    if (!deletingId) return;
    const ok = await deleteMessage(deletingId);
    if (!ok) show(t('message.deleteFailed'), { type: 'error' });
  }, [deleteMessage, deletingId, show, t]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  // A ref, not state: it is read from a scroll handler and a ResizeObserver on
  // every frame of a stream, and re-rendering the transcript for it would be
  // exactly the cost this component is trying to avoid.
  const pinnedRef = useRef(true);
  const [showJump, setShowJump] = useState(false);

  const scrollToBottom = useCallback((behavior: ScrollBehavior) => {
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTo({ top: element.scrollHeight, behavior });
    pinnedRef.current = true;
    setShowJump(false);
  }, []);

  const handleScroll = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    pinnedRef.current = distance <= PIN_TOLERANCE;
    // `setState` no-ops on an unchanged boolean, so this only re-renders on a flip.
    setShowJump(distance > JUMP_THRESHOLD);
  }, []);

  // Follow the stream. Observing the content (not the messages array) catches
  // every growth — a token, an image finishing its layout, a generative block —
  // in one place, with no timers.
  useEffect(() => {
    const content = contentRef.current;
    const element = scrollRef.current;
    if (!content || !element) return;
    const observer = new ResizeObserver(() => {
      if (pinnedRef.current) element.scrollTop = element.scrollHeight;
    });
    observer.observe(content);
    // And the scroll container: the keyboard shrinks *it*, never the content,
    // so a content-only observer never fires when the composer takes focus and
    // a pinned transcript is left stranded behind the keyboard.
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // A new thread opens pinned, with no leftover jump button from scrolling up in
  // the previous one. `historyStatus` is in the deps because the transcript only
  // has a height once the history has landed.
  useEffect(() => {
    pinnedRef.current = true;
    const element = scrollRef.current;
    if (!element) return;
    // One frame later: the new thread's rows have to be laid out before there is
    // a height to pin to. `handleScroll` then derives the jump button from the
    // real position rather than this effect guessing at it.
    const frame = window.requestAnimationFrame(() => {
      element.scrollTop = element.scrollHeight;
      handleScroll();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [threadId, historyStatus, handleScroll]);

  const openMenu = useCallback(
    (
      element: HTMLElement,
      createdAt: string,
      align: 'start' | 'end',
      actions?: MessageMenuAction[],
    ) => {
      // The hold is over — confirm it by touch, the way every native chat does,
      // before the panel appears.
      send('haptic', { style: 'tap' });
      setMenu({ rect: element.getBoundingClientRect(), createdAt, align, actions });
    },
    [],
  );

  const handleEditSubmit = useCallback(
    (messageId: string, text: string) => {
      closeEditor();
      // Failures land on the message itself, same as a send.
      void editUserMessage(messageId, text).catch(() => {});
    },
    [closeEditor, editUserMessage],
  );

  const handleRegenerate = useCallback(
    (messageId: string) => {
      // The reply that was pressed, not the last one. Failures land on the
      // message itself (`status: 'error'`), so nothing to do here beyond keeping
      // the rejection from going unhandled.
      void regenerate(messageId).catch(() => {});
    },
    [regenerate],
  );

  const handleRetrySend = useCallback(() => {
    void retryLastSend().catch(() => {});
  }, [retryLastSend]);

  const handleRetryHistory = useCallback(() => {
    void retryHistory().catch(() => {});
  }, [retryHistory]);

  const handleSuggestion = useCallback(
    (prompt: string) => {
      // The same gate the composer's send button applies: an in-flight or failed
      // upload must block the send, because `takeUploadedUuids()` returns only
      // the completed ones and the attachment would drop off the message
      // silently. Say which of the two it is — the fixes differ.
      if (!attachmentsReady) {
        const hasFailed = attachments.some((attachment) => attachment.status === 'error');
        show(
          hasFailed
            ? t('attachments.someFailed')
            : t('attachments.stillUploading'),
          { type: 'error' },
        );
        return;
      }
      void sendMessage(prompt).catch(() => {});
    },
    [attachments, attachmentsReady, sendMessage, show, t],
  );

  const isLoading = historyStatus === 'idle' || historyStatus === 'loading';
  const isEmpty = historyStatus === 'ready' && messages.length === 0;

  return (
    <div className={clsx('relative flex min-h-0 flex-1 flex-col', className)}>
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        {/* `relative` so the leaving skeleton can lie over the arriving content
            (`absoluteOnExit`) instead of pushing it down for half a second. */}
        <div ref={contentRef} className="relative flex min-h-full flex-col">
          <Fade
            show={isLoading}
            enterMs={SKELETON_FADE_MS}
            absoluteOnExit
            className="flex min-h-full flex-1 flex-col"
          >
            <ChatSkeleton />
          </Fade>

          {isLoading ? null : historyStatus === 'error' ? (
            <ErrorState
              fullScreen
              message={getErrorMessage(historyError, t('chat.loadFailed'))}
              onRetry={handleRetryHistory}
            />
          ) : isEmpty ? (
            <EmptyThread onSelect={handleSuggestion} disabled={isRunning} />
          ) : (
            // No virtualiser: a thread is one page of history (100 messages) and
            // the message components are memoised, so a streaming token re-renders
            // one row. If threads ever paginate, a windowing layer goes here —
            // around this map, keeping the same row markup.
            <div className="flex flex-col gap-3 px-[14px] pt-3 pb-4">
              {messages.map((message, index) => {
                const previous = index > 0 ? messages[index - 1] : undefined;
                // A send that never reached the server is marked on *both*
                // messages by `run.ts` (the placeholder reply is appended before
                // the POST). The user bubble owns that failure and already offers
                // the retry, so the reply beside it must not offer a second one.
                const sendFailed =
                  previous !== undefined && isUserMessage(previous) && previous.status === 'failed';

                // Editing forks this turn on the server, so it needs a message the
                // server knows about — a bubble whose send never landed has no
                // uuid to fork from. And not while a run is live: the edit would
                // start a second one, which this screen deliberately does not do.
                const canEdit =
                  isUserMessage(message) && Boolean(message.uuid) && !isRunning;
                // Delete is keyed by the server uuid too, so a turn that never
                // landed — or a reply still waiting for `ai.run.completed` to name
                // it — has no row. While a run is live the row is there but dimmed:
                // the reply being written hangs off the branch it would change.
                const deleteAction: MessageMenuAction | null = message.uuid
                  ? {
                      label: t('message.delete'),
                      destructive: true,
                      disabled: isRunning,
                      onSelect: () => askToDelete(message.id),
                    }
                  : null;

                return (
                  // One malformed generative block degrades to a card instead of
                  // white-screening the whole transcript.
                  <ErrorBoundary key={message.id} name="chat/message" resetKey={message.id}>
                    {isUserMessage(message) ? (
                      <UserMessage
                        message={message}
                        onRetry={handleRetrySend}
                        isEditing={editingId === message.id}
                        onEditCancel={closeEditor}
                        onEditSubmit={(text) => handleEditSubmit(message.id, text)}
                        onLongPress={(element) =>
                          openMenu(
                            element,
                            message.createdAt,
                            'end',
                            [
                              ...(canEdit
                                ? [
                                    {
                                      label: t('message.edit'),
                                      onSelect: () => openEditor(message.id),
                                    },
                                  ]
                                : []),
                              ...(deleteAction ? [deleteAction] : []),
                            ],
                          )
                        }
                      />
                    ) : (
                      <AssistantMessage
                        message={message}
                        onRegenerate={handleRegenerate}
                        sendFailed={sendFailed}
                        onLongPress={(element) =>
                          openMenu(
                            element,
                            message.createdAt,
                            'start',
                            deleteAction ? [deleteAction] : undefined,
                          )
                        }
                      />
                    )}
                  </ErrorBoundary>
                );
              })}
              {/* Written while the reply above was running; they go out by
                  themselves, one at a time, once it is done. */}
              <QueuedMessages />
            </div>
          )}
        </div>
      </div>

      {menu ? <MessageMenu target={menu} onClose={() => setMenu(null)} /> : null}

      <DeleteMessageSheet
        isOpen={deletingId !== null}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        disabled={isRunning}
      />

      {/* Always mounted: the button owns both halves of its fade, so the parent
          must not be the thing that rips it out of the tree (see the component). */}
      <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
        <ScrollToBottomButton
          show={showJump}
          className="pointer-events-auto"
          onPress={() => scrollToBottom('smooth')}
        />
      </div>
    </div>
  );
}
