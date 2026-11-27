import { memo, useCallback, useMemo } from 'react';

import { useBranchInfo } from '@/chat/branches';
import type { AssistantMessage as AssistantMessageModel } from '@/chat/types';
import { messageText } from '@/chat/types';
import { renderToolBlock } from '@/generative';
import { useTranslation } from '@/i18n';
import { ErrorBoundary, ErrorState, Fade, useLongPress } from '@/ui/primitives';

import { BranchSwitcher } from './BranchSwitcher';
import { MessageAttachments } from './MessageAttachments';
import { Markdown } from './Markdown';
import { MessageActions } from './MessageActions';
import { StoppedBanner } from './StoppedBanner';
import { ThinkingTrace } from './ThinkingTrace';
import { TodoList } from './TodoList';
import { ToolCallsGroup } from './ToolCallsGroup';
import { TypingIndicator } from './TypingIndicator';

export type AssistantMessageProps = {
  message: AssistantMessageModel;
  /**
   * Re-run *this* turn, named by its local id. Wired to
   * `useChatActions().regenerate`, which forks the reply it is given — not
   * whichever reply happens to be last.
   */
  onRegenerate: (messageId: string) => void;
  /**
   * The send this turn is a reply to never reached the server, so its failure
   * belongs to the user's bubble (`MessageList` derives this). See below.
   */
  sendFailed?: boolean;
  /** Press-and-hold on the turn — the caller opens `MessageMenu` on it. */
  onLongPress?: (element: HTMLElement) => void;
};

/**
 * An assistant turn. Figma 3234:70940: plain text on the screen background, no
 * bubble, capped at ~80% of the column, with the action row beneath it.
 *
 * A turn resolves to one of five presentations, in this order:
 *   - **typing** — streaming with nothing emitted yet → `TypingIndicator`.
 *   - **error** — the run failed → the shared `ErrorState` with a retry, *below*
 *     whatever did stream, so a partial answer is never discarded.
 *   - **stopped** — the user cancelled → `StoppedBanner`, neutral. Cancelling is
 *     not a failure and must not read as red.
 *   - **empty** — a clean completion that produced nothing at all. That is a
 *     failure to respond, not a blank message with a lone action row.
 *   - **normal** — the text, then the action row.
 *
 * The two failures render the app's one error component at full size, inside the
 * transcript — which is what the native turn does with the same component. A
 * transcript-only compact variant was tried and removed: it made a failure in
 * here look like nothing else in the app.
 *
 * **One failure, one retry.** `run.ts` marks a failed *send* on both messages —
 * the user's (`status: 'failed'`) and this placeholder's (`status: 'error'`) —
 * because the placeholder is appended before the POST. Drawing both gave one
 * event two different retry offers. The rule: a send that never reached the
 * server is the user bubble's failure (its own `ErrorState`); only a run the
 * backend *accepted* and then failed is this message's. `sendFailed` is how this
 * component learns which of the two it is looking at.
 *
 * The action row never mounts while the run is live, so a half-streamed answer
 * cannot be copied or regenerated. It *does* accompany the stopped banner when
 * partial text was captured, so that text stays copyable.
 *
 * **Regenerating forks rather than replaces.** `POST .../regenerate` creates a
 * sibling of this reply, so the previous answer is still there — reachable
 * through the switcher that appears in this row once there is more than one. That
 * pairing is the point: an answer you can replace but not get back is a worse
 * offer than no regenerate button at all.
 *
 * **No timestamp in the action row.** The Figma draws one after the two glyphs;
 * it moved into the long-press menu, for the same reason the user bubble's did —
 * see `UserMessage`. Holding the turn anywhere opens it.
 *
 * **Entrances.** Every block fades in over 250ms, the native turn's
 * `FadeIn.duration(250)`. The typing dots also fade *out*, over the incoming
 * text rather than above it (`absoluteOnExit`, hence the `relative` root) —
 * unmounting them on the frame the first token lands reads as a flinch.
 *
 * **Thinking is not a part.** `ai.reasoning` streams for real now, but it is
 * live-only — the backend stores none of it — so it arrives beside the parts, on
 * `message.reasoning`, and is drawn under the typing dots by `ThinkingTrace`
 * until the first token lands. Making it a `MessagePart` would put text in the
 * turn that a reopened thread can never reproduce, and would offer it for copy
 * and regenerate as if it were the answer.
 */
function AssistantMessageBase({
  message,
  onRegenerate,
  sendFailed = false,
  onLongPress,
}: AssistantMessageProps) {
  const { parts, status, error, attachments, reasoning, toolCalls, todos } = message;
  const { t } = useTranslation();
  // No-op when the caller passed nothing, so the hook's rules stay unconditional.
  const longPress = useLongPress(onLongPress ?? (() => {}));
  const branch = useBranchInfo(message.uuid, message.siblingCount);

  // A tool-call part counts as content even before any text arrives: the backend
  // drew something, so the turn is not blank and the dots must go.
  const hasContent =
    parts.some((part) => (part.type === 'text' ? part.text.length > 0 : true)) ||
    attachments.length > 0;
  const isStreaming = status === 'streaming';
  const isTyping = isStreaming && !hasContent;
  const isFailure = status === 'error' && !sendFailed;
  // `complete` with nothing to show is the same broken outcome as `empty`.
  const isEmptyReply = status === 'empty' || (status === 'complete' && !hasContent);
  const isStopped = status === 'stopped';
  const showActions = !isStreaming && hasContent && !isFailure && !isEmptyReply;

  const text = useMemo(() => messageText(message), [message]);
  const messageId = message.id;
  const regenerateThis = useCallback(() => onRegenerate(messageId), [onRegenerate, messageId]);

  // The send never landed: this placeholder has nothing of its own to say, and
  // rendering it would be the second retry offer for one event.
  if (sendFailed && !hasContent) return null;

  return (
    <div {...longPress} className="relative flex w-full flex-col items-start gap-2">
      {/* The wait, with a reason when there is one: the dots always, and under
          them whatever the model is thinking. Both go together the instant the
          first token arrives — see `ThinkingTrace`. */}
      <Fade show={isTyping} enterMs={250} absoluteOnExit>
        <div className="flex flex-col gap-1">
          <TypingIndicator />
          {reasoning ? <ThinkingTrace text={reasoning} /> : null}
        </div>
      </Fade>

      {/* The plan, then the work, then the answer — the web client's order. Both
          ride beside the parts, so they sit above the reply as a whole rather
          than inside it. */}
      {todos && todos.length > 0 ? (
        <Fade enterMs={250} className="w-full">
          <ErrorBoundary name="chat/todos">
            <TodoList todos={todos} live={isStreaming} />
          </ErrorBoundary>
        </Fade>
      ) : null}
      {toolCalls && toolCalls.length > 0 ? (
        <Fade enterMs={250} className="w-full">
          <ErrorBoundary name="chat/tool-calls">
            <ToolCallsGroup calls={toolCalls} live={isStreaming} />
          </ErrorBoundary>
        </Fade>
      ) : null}

      {parts.map((part, index) =>
        part.type === 'text' ? (
          part.text.length > 0 ? (
            // The 80% cap is on prose only — a generative block sizes itself.
            // Figma 3234:70940 measures the reply text at 279 of the column's
            // 362px, so the cap is the design's, not a leftover.
            // Per part, so a block that arrives mid-answer fades in on its own
            // rather than replaying the whole turn's entrance.
            <Fade key={`text-${index}`} enterMs={250} className="max-w-[80%]">
              <Markdown text={part.text} />
            </Fade>
          ) : null
        ) : (
          <Fade key={part.toolCallId} enterMs={250} className="w-full">
            {/* A block draws model-written args; one bad block must not take
                the prose of the reply down with it. */}
            <ErrorBoundary name={`generative/${part.toolName}`}>
              {renderToolBlock(part)}
            </ErrorBoundary>
          </Fade>
        ),
      )}

      {/* Files the turn produced — an XLSX the sandbox built, a PDF it fetched.
          They arrive with history rather than with the stream, so on a live turn
          this fills in a moment after the text (see `syncDeliveredFiles`), and the
          same tile is drawn as for a file the user sent. No caption: the reply's
          own prose is right above it. */}
      {attachments.length > 0 ? (
        <Fade enterMs={250}>
          <ErrorBoundary name="chat/attachments">
            <MessageAttachments attachments={attachments} align="start" />
          </ErrorBoundary>
        </Fade>
      ) : null}

      {isFailure ? (
        <Fade enterMs={250} className="w-full">
          <ErrorState
            title={t('reply.failedTitle')}
            message={
              error && error.length > 0
                ? error
                : t('reply.failedMessage')
            }
            onRetry={regenerateThis}
          />
        </Fade>
      ) : isStopped ? (
        <Fade enterMs={250} className="w-full">
          <StoppedBanner onRetry={regenerateThis} />
        </Fade>
      ) : isEmptyReply ? (
        <Fade enterMs={250} className="w-full">
          <ErrorState
            title={t('reply.emptyTitle')}
            message={t('reply.emptyMessage')}
            onRetry={regenerateThis}
          />
        </Fade>
      ) : null}

      {/* One row: the actions, and — only where this turn actually has alternate
          versions — the walker between them. The switcher survives a stopped or
          failed turn, which the actions do not: those versions still exist and
          are still worth getting back to. */}
      {showActions || (branch && message.uuid) ? (
        <div className="flex items-center gap-3">
          {showActions ? (
            <MessageActions
              text={text}
              onRegenerate={regenerateThis}
              messageId={message.id}
              messageUuid={message.uuid}
              feedback={message.feedback}
              feedbackPending={message.feedbackPending}
            />
          ) : null}
          {branch && message.uuid ? (
            <BranchSwitcher messageUuid={message.uuid} info={branch} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Memoised: only the message whose parts changed re-renders as tokens arrive. */
export const AssistantMessage = memo(AssistantMessageBase);
