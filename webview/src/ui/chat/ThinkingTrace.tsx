import { useEffect, useRef } from 'react';

/**
 * The model's thinking, while it is still thinking (`ai.reasoning`).
 *
 * Some models write out a plan before they answer, and those deltas arrive on
 * their own stream ahead of the first `ai.token`. This is what fills the wait:
 * the same three dots as before, with the thinking running underneath them, so
 * the pause has a reason on screen instead of being a spinner that says nothing.
 *
 * **It is live-only, and this component is the only place it is ever shown.**
 * The backend does not store it — `ai.run.completed.content` never includes it
 * and no endpoint returns it afterwards — so it is drawn beside the turn rather
 * than inside it (`AssistantMessage.reasoning`, never a `MessagePart`), and the
 * caller unmounts it the moment the first token lands. A reopened thread shows
 * the answer alone, which is exactly what the server has.
 *
 * **Only the tail is shown.** Thinking runs to paragraphs and it is not the
 * answer: the block is two lines tall, pinned to the newest text and faded out
 * at the top, so it reads as movement under the dots rather than a second reply
 * competing with the real one. Dimmed and italic, the same treatment the native
 * chat gives a reasoning part.
 */
export type ThinkingTraceProps = {
  /** The thinking so far. Cumulative — the tail of it is what shows. */
  text: string;
};

export function ThinkingTrace({ text }: ThinkingTraceProps) {
  const ref = useRef<HTMLDivElement>(null);

  // Follow the newest text. The box does not scroll (`overflow-hidden`), so this
  // is the only thing that keeps the latest line in view as deltas arrive.
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [text]);

  if (text.trim().length === 0) return null;

  return (
    <div
      ref={ref}
      aria-hidden
      className="max-h-9 max-w-[80%] overflow-hidden text-[0.8125rem] leading-[1.125rem] italic text-label-tertiary"
      // A fade over the top line rather than a hard cut, so the text reads as
      // scrolling out of view. Tailwind has no mask utility here worth the
      // indirection for one element.
      style={{
        maskImage: 'linear-gradient(to bottom, transparent, black 70%)',
        WebkitMaskImage: 'linear-gradient(to bottom, transparent, black 70%)',
      }}
    >
      {text}
    </div>
  );
}
