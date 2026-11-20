/**
 * What a branch operation actually did, in a form you can read in a log file.
 *
 * Branching is the one flow where the screen is rewritten by a *second* request:
 * a fork (edit / regenerate) or a `select-branch` is followed by a fresh history
 * read, and whatever that read answers replaces the transcript wholesale. So when
 * a reply "disappears", the question is never "did the UI lose it" in the
 * abstract — it is one of exactly three, and they have different owners:
 *
 *   1. the reply is **not in the history response** at all → the backend either
 *      has not persisted it yet or is still pointing at the other branch;
 *   2. the reply **is** in the response but not on screen → we dropped it while
 *      folding the trace ({@link toTranscript} in `history.ts`);
 *   3. the reply is on screen → the bug is elsewhere (render, scroll, key).
 *
 * Everything here exists to make that answer fall out of the log instead of out
 * of a debugging session, so `verdict` is the field to read first.
 *
 * **No message content ever goes in.** These lines cross the bridge into the
 * native log file and into Sentry breadcrumbs, and an AI answer is the last thing
 * that belongs there — the same rule `run.ts`'s `describeError` follows. Lengths,
 * roles and uuids only.
 */
import type { AIMessageRead } from '@/lib/api/types';

import type { ChatMessage, MessagePart } from './types';

/**
 * Enough of a uuid to match two lines up by eye, and not enough to fill a log
 * with 36-character strings. Collisions do not matter here: everything compared
 * is compared on the full uuid, this is only what gets printed.
 */
export function shortUuid(uuid: string | null | undefined): string {
  if (!uuid) return '-';
  return uuid.length <= 8 ? uuid : `..${uuid.slice(-8)}`;
}

/**
 * One line per row of the history response, in wire order — *before* any folding.
 * This is the half that says what the backend sent, so it is what proves or clears
 * the backend.
 */
export function describeRawHistory(items: readonly AIMessageRead[]): string[] {
  return items.map((item) => {
    const flags: string[] = [`${(item.content ?? '').length}ch`];
    // The tool's own name, because a `tool` row is only worth anything once you
    // know which call it answers — and it is what decides whether the row folds
    // into a view or is dropped as plumbing.
    if (item.tool_call_id) flags.push(`tool_result${item.name ? `:${item.name}` : ''}`);
    if (item.tool_calls) flags.push('tool_calls');
    if ((item.sibling_count ?? 1) > 1) flags.push(`siblings:${item.sibling_count}`);
    const attachments = item.attachments ?? [];
    if (attachments.length) {
      // A chip with no `download_url` draws its icon-and-filename tile instead of
      // the photo, so the ratio is the difference between "the image is missing"
      // and "the backend is still processing it".
      const withUrl = attachments.filter((one) => Boolean(one.download_url)).length;
      flags.push(`att:${attachments.length} urls:${withUrl}`);
    }
    return `${item.role || '?'} ${shortUuid(item.uuid)} ${flags.join(' ')}`;
  });
}

/** The same, for what is actually on screen — the half that says what we did with it. */
export function describeTranscript(messages: readonly ChatMessage[]): string[] {
  return messages.map((message) => {
    if (message.role === 'user') {
      return `user ${shortUuid(message.uuid)} ${message.text.length}ch ${message.status}`;
    }
    const chars = message.parts.reduce(
      (total, part) => total + (part.type === 'text' ? part.text.length : 0),
      0,
    );
    const views = message.parts.filter((part) => part.type === 'tool-call').length;
    const files = message.attachments.length;
    return `assistant ${shortUuid(message.uuid)} ${chars}ch parts:${message.parts.length}${
      views ? ` views:${views}` : ''
    }${files ? ` att:${files}` : ''} ${message.status}`;
  });
}

/**
 * Where one message ended up after a reload — the field to read first when a
 * reply went missing.
 *
 * `dropped-locally` is the only verdict that points at this app; the other two
 * point at the history response, which is the backend's answer about which branch
 * is active and what is on it.
 */
export type MessageVerdict =
  | 'on-screen'
  | 'dropped-locally'
  | 'absent-from-history'
  | 'no-uuid-to-check';

export function verdictFor(
  uuid: string | undefined,
  items: readonly AIMessageRead[],
  messages: readonly ChatMessage[],
): MessageVerdict {
  if (!uuid) return 'no-uuid-to-check';
  if (messages.some((message) => message.uuid === uuid)) return 'on-screen';
  if (items.some((item) => item.uuid === uuid)) return 'dropped-locally';
  return 'absent-from-history';
}

/** True when anything at all is wrong — used to pick `warn` over `info`. */
export function isMissing(verdict: MessageVerdict): boolean {
  return verdict === 'dropped-locally' || verdict === 'absent-from-history';
}

/**
 * Would this part put anything on screen?
 *
 * A text part has to have more than whitespace. A generative block is assumed to
 * draw — the registry decides, and it logs its own refusal for a tool it does not
 * know. The one case that is knowably blank is an artifact whose payload carried
 * no `jsx`: the card renders nothing at all, which is how an empty bubble with a
 * copy button under it ends up in a reopened thread.
 */
function partRenders(part: MessagePart): boolean {
  if (part.type === 'text') return part.text.trim().length > 0;
  const args: unknown = part.args;
  if (args && typeof args === 'object' && 'jsx' in args) {
    const jsx: unknown = (args as { jsx?: unknown }).jsx;
    return typeof jsx === 'string' && jsx.trim().length > 0;
  }
  return true;
}

/**
 * Assistant messages that survived the fold and will still draw an empty bubble.
 *
 * These are the worst kind of transcript row: the message has parts, so nothing
 * drops it, and every one of those parts renders to nothing — so the user gets a
 * blank bubble with a copy and a regenerate button under it and no way to tell
 * what was supposed to be there.
 */
export function emptyBubbles(messages: readonly ChatMessage[]): string[] {
  return messages
    .filter(
      (message) =>
        message.role === 'assistant' &&
        message.parts.length > 0 &&
        !message.parts.some(partRenders),
    )
    .map((message) => {
      const parts = message.role === 'assistant' ? message.parts : [];
      return `${shortUuid(message.uuid)} parts:${parts
        .map((part) => (part.type === 'text' ? 'text' : 'view'))
        .join('+')}`;
    });
}

/**
 * The turn structure, in one string: `u a a a` is one question answered by three
 * separate assistant bubbles.
 *
 * This is the shape a *reload* can differ from a *stream* on. A live run puts one
 * assistant message on screen no matter how many times the model stopped to think
 * between tool calls — every token of it lands in the same bubble. History stores
 * each of those pauses as its own assistant row, so folding the trace row by row
 * turns one answer into several, and the user watches a finished reply split
 * itself apart the moment the fork's reload lands.
 */
export function describeTurnShape(messages: readonly ChatMessage[]): string {
  return messages.map((message) => (message.role === 'user' ? 'u' : 'a')).join(' ');
}

/** The longest run of assistant messages with no question between them. */
export function longestAssistantStreak(messages: readonly ChatMessage[]): number {
  let longest = 0;
  let current = 0;
  for (const message of messages) {
    current = message.role === 'assistant' ? current + 1 : 0;
    longest = Math.max(longest, current);
  }
  return longest;
}

/**
 * Does the transcript still end with an answer?
 *
 * The specific failure being watched for is a branch switch that lands on a user
 * turn with nothing under it: `select-branch` moved the pointer to the sibling
 * itself and the active branch was never walked down to its leaf, so the reply
 * that belongs to that version is simply not on the path the history endpoint
 * returned. It looks exactly like "the AI answer vanished".
 */
export function trailingRole(messages: readonly ChatMessage[]): string {
  return messages[messages.length - 1]?.role ?? 'none';
}
