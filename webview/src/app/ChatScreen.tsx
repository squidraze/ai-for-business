import { useCallback } from 'react';

import { useChatState } from '@/chat/useChat';
import { MessageList } from '@/ui/chat';
import { Composer } from '@/ui/composer';

/**
 * The whole screen: transcript above, composer below, nothing else.
 *
 * There is no header here on purpose — the native host renders the real one
 * (title, back, new chat) above the WebView so it keeps working while this
 * bundle boots. `--inset-top` is therefore usually 0; it is honoured anyway
 * because the host owns that number and may not always be 0 (a future
 * full-bleed layout, a landscape notch).
 *
 * The column does not scroll: only the transcript does. A WebView whose <body>
 * scrolls rubber-bands the composer off the screen when the keyboard opens.
 */
export function ChatScreen() {
  const { agent } = useChatState();
  /**
   * A tap anywhere in the transcript dismisses the keyboard, the way every
   * native chat does. `pointerdown` rather than `click` so it also fires at the
   * start of a scroll drag, and only text entry is blurred — blurring whatever
   * happens to be focused would kill a button press mid-tap.
   *
   * **A tap that lands on a control is left alone**, which is what
   * `keyboardShouldPersistTaps="handled"` buys the native list. Closing the
   * keyboard on `pointerdown` changes `visualViewport`, and the composer and
   * transcript re-lay-out *before* the `click` that follows — so with the
   * keyboard open, a tap on "Try again", on a suggestion chip or on a message
   * action would land wherever that button had moved to, i.e. nowhere. Dismissing
   * only for taps on the background keeps both behaviours: the keyboard still
   * closes when you tap the conversation, and a control still gets its press.
   */
  const dismissKeyboard = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const target = event.target;
    if (
      target instanceof Element &&
      target.closest('button, a, [role="button"], input, textarea, label, select')
    ) {
      return;
    }

    const active = document.activeElement;
    if (active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement) {
      active.blur();
    }
  }, []);

  return (
    <div
      className="flex h-full flex-col overflow-hidden bg-screen"
      style={{
        paddingTop: 'var(--inset-top)',
        paddingLeft: 'var(--inset-left)',
        paddingRight: 'var(--inset-right)',
      }}
    >
      <div
        onPointerDown={dismissKeyboard}
        // The child-fill rule keeps the layout correct whichever way MessageList
        // sizes itself: it owns its own scrolling, this only gives it the space.
        className="flex min-h-0 flex-1 flex-col [&>*]:min-h-0 [&>*]:flex-1"
      >
        <MessageList />
      </div>

      {/*
       * Pinned by the flex column, not by `position: fixed` — a fixed element
       * inside a WebView drifts while the keyboard animates. The composer owns
       * its own `--inset-bottom` / `--inset-keyboard` padding, so none is added
       * here or it would be applied twice.
       */}
      <div className="shrink-0">
        {/* A conversation with a custom agent cannot go to voice yet (the web
            client hides it for the same reason), so the slot stays send. */}
        <Composer showVoice={!agent} />
      </div>
    </div>
  );
}
