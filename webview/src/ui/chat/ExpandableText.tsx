import { useState } from 'react';

import { useTranslation } from '@/i18n';

/**
 * A sent prompt, folded when it is long enough to push the reply off the screen.
 *
 * **Why the transcript and not the composer.** While a prompt is being written
 * the field grows with it and that is the point — the writer is reading their
 * own sentence. Once it is sent it becomes history: a pasted job description or
 * a dictated paragraph then stands between the previous answer and the new one,
 * and the reply the prompt was written for starts below the fold. So the fold
 * happens exactly where the native app folds a long note — in the bubble, after
 * the send — and the composer is untouched.
 *
 * **Characters, not lines.** `line-clamp` would be the CSS answer, but it clamps
 * what *fits*, and what fits in this bubble depends on the font the host app
 * loaded, the device's text-size setting and the 85% the bubble takes of a phone
 * that may be 320 or 480 points wide. The same prompt would fold on one phone
 * and not on another, which is impossible to describe and impossible to test.
 * A character count folds the same prompt everywhere.
 *
 * It is {@link FOLD_MIN_CHARS} because that is roughly where a bubble stops
 * being a message and starts being a document — about five lines at this size —
 * and because a fold on anything shorter costs a tap to read two more words.
 */

/** Past this many characters a sent prompt is folded. */
export const FOLD_MIN_CHARS = 200;

/**
 * Below this, cutting at a word would throw away too much of what is shown, so
 * the cut lands mid-word instead. Only a prompt whose first {@link FOLD_MIN_CHARS}
 * characters are one unbroken run — a URL, a base64 blob — reaches it.
 */
const FOLD_MIN_KEPT_CHARS = 150;

/** The visible head of a folded prompt: {@link FOLD_MIN_CHARS}, cut at a word. */
function foldHead(text: string): string {
  const head = text.slice(0, FOLD_MIN_CHARS);
  // Greedy up to the last whitespace in the head — `\s`, so a newline counts:
  // cutting a dictated paragraph mid-line reads worse than cutting it at the
  // line it was broken on.
  const atWord = /^[\s\S]*\s/.exec(head)?.[0].trimEnd() ?? '';
  return atWord.length >= FOLD_MIN_KEPT_CHARS ? atWord : head.trimEnd();
}

export type ExpandableTextProps = {
  /** The prompt as it was sent. */
  text: string;
  /** Classes for the paragraph that holds it — the caller owns the type scale. */
  className?: string;
};

/**
 * The control is **inline**, on the last visible line, the way
 * `packages/ui/shared/ExpandableText` draws it natively: a block of text with a
 * link-coloured "More" after the ellipsis, and "Less" after the full text once
 * it is open. A button on its own row would be a second element inside a bubble
 * whose whole job is to be one.
 *
 * It takes the brand colour rather than the label's, because nothing else in a
 * user bubble is tappable and a grey word in the middle of grey text is not
 * discoverable. `useLongPress` already treats a press that starts on a button as
 * the button's, so the message menu does not open on top of the expansion.
 */
export function ExpandableText({ text, className }: ExpandableTextProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  const foldable = text.length > FOLD_MIN_CHARS;
  const folded = foldable && !expanded;

  return (
    <p className={className}>
      {folded ? foldHead(text) : text}
      {foldable ? (
        <>
          {folded ? '… ' : ' '}
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            className="font-medium text-primary active:opacity-70"
          >
            {folded ? t('message.more') : t('message.less')}
          </button>
        </>
      ) : null}
    </p>
  );
}
