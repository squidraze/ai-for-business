/**
 * The conversation transcript. `MessageList` is the whole surface — it owns the
 * history states, the scroll pinning and the jump button; everything else is
 * exported so the composer and the dev harness can reuse the same pieces.
 */

export { MessageList } from './MessageList';
export type { MessageListProps } from './MessageList';

export { AssistantMessage } from './AssistantMessage';
export type { AssistantMessageProps } from './AssistantMessage';

export { UserMessage } from './UserMessage';
export type { UserMessageProps } from './UserMessage';

export { ExpandableText, FOLD_MIN_CHARS } from './ExpandableText';
export type { ExpandableTextProps } from './ExpandableText';

export { MessageActions } from './MessageActions';
export type { MessageActionsProps } from './MessageActions';

export { formatMessageTimestamp } from './messageTime';

export { MessageMenu } from './MessageMenu';
export type { MessageMenuProps, MessageMenuTarget } from './MessageMenu';

export { MessageAttachments } from './MessageAttachments';
export type { MessageAttachmentsProps } from './MessageAttachments';

export { TypingIndicator } from './TypingIndicator';

export { ThinkingTrace } from './ThinkingTrace';
export type { ThinkingTraceProps } from './ThinkingTrace';

export { StoppedBanner } from './StoppedBanner';

export { EmptyThread } from './EmptyThread';
export type { EmptyThreadProps } from './EmptyThread';

export { ScrollToBottomButton } from './ScrollToBottomButton';
export type { ScrollToBottomButtonProps } from './ScrollToBottomButton';

export { Markdown } from './Markdown';
export type { MarkdownProps } from './Markdown';

export { ImageViewer } from './ImageViewer';
export type { ImageViewerProps } from './ImageViewer';
