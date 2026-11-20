import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { useTranslation } from '@/i18n';

/**
 * The user bubble, turned into a field.
 *
 * A separate component so the draft can be **initial state seeded at mount**
 * rather than copied out of a prop by an effect: the parent mounts this only
 * while editing, so entering edit mode is a mount and the draft starts from the
 * message every time. Syncing it in an effect instead is the classic cascading
 * render (and what `react-hooks/set-state-in-effect` is there to stop).
 *
 * It deliberately does not know what committing means — the parent decides
 * whether that is an edit, and `run.ts` decides that an edit forks a sibling.
 */
export type MessageEditorProps = {
  /** The text the field opens with — the message as it currently reads. */
  initialText: string;
  onSubmit: (text: string) => void;
  onCancel: () => void;
};

export function MessageEditor({ initialText, onSubmit, onCancel }: MessageEditorProps) {
  const [draft, setDraft] = useState(initialText);
  const { t } = useTranslation();
  const editorRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    // Caret at the end: an edit is almost always a correction or an addition at
    // the tail, and selecting the whole thing invites deleting it by accident.
    editor.setSelectionRange(editor.value.length, editor.value.length);
  }, []);

  // Grow with the content rather than scrolling inside a fixed box — the field
  // stands in for a bubble, and a bubble is as tall as what it holds. Before
  // paint, so a pasted paragraph never shows up one-line-tall for a frame.
  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.style.height = 'auto';
    editor.style.height = `${editor.scrollHeight}px`;
  }, [draft]);

  const trimmed = draft.trim();
  const canSubmit = trimmed.length > 0 && trimmed !== initialText.trim();

  return (
    <div className="flex w-full flex-col gap-2 rounded-bubble bg-surface px-4 py-2.5">
      <textarea
        ref={editorRef}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onCancel();
        }}
        rows={1}
        aria-label={t('message.edit')}
        className="w-full resize-none bg-transparent text-[1rem] leading-[1.375rem] text-label outline-none [overflow-wrap:anywhere]"
      />
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full px-3 py-1.5 text-[0.875rem] leading-4 font-medium text-label-secondary active:opacity-60"
        >
          {t('common.cancel')}
        </button>
        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => onSubmit(trimmed)}
          className="rounded-full bg-primary px-3 py-1.5 text-[0.875rem] leading-4 font-medium text-on-primary active:opacity-80 disabled:bg-primary-disabled"
        >
          {t('common.send')}
        </button>
      </div>
    </div>
  );
}
