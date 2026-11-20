import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from 'react';
import { ArrowUp, AudioLines, Paperclip, Square } from 'lucide-react';
import clsx from 'clsx';

import { onUploadError, useAttachmentsReady, usePendingAttachments } from '@/attachments';
import { send } from '@/bridge/bridge';
import type { ThreadTarget } from '@/bridge/protocol';
import { getCompanyForNewThread } from '@/chat/companies';
import { useChatActions, useChatState } from '@/chat/useChat';
import { useTranslation } from '@/i18n';
import { IconButton, useToast } from '@/ui/primitives';

import { AttachmentPickerSheet } from './AttachmentPickerSheet';
import { ComposerAttachments } from './ComposerAttachments';


/**
 * The message composer — Figma `Rooler-AI` 3234:70940 / 3234:71111.
 *
 * A card pinned to the bottom of the screen, 14px from each edge, with two
 * stacked rows: the growing text field, and the action row (attach + company pill
 * on the left, one 36px slot on the right). Attachment chips sit **above** both
 * when there are any — the order the native composer uses: what you attached,
 * then the caption you are writing for it, then the controls.
 *
 * The right-hand slot holds exactly one button at a time and cross-fades between
 * three mutually exclusive states, so it reads as a single control morphing
 * rather than buttons shuffling in a row:
 *
 *  - **stop** — a run is streaming (`isRunning`).
 *  - **send** — otherwise. *Disabled* until the message is actually sendable:
 *    there must be text or at least one attachment (a photo with no caption is a
 *    complete message — see `sendMessage`), and every attachment must have
 *    finished uploading. Disabled, never hidden — the user has to be able to see
 *    why they cannot send yet.
 *  - **voice** — idle with nothing drafted at all, and only when `showVoice`.
 *
 * Two icon choices worth not re-litigating:
 *  - **attach is a paperclip**, not the native composer's `Plus`. Figma
 *    3234:70940 draws `attachment-01` in that slot; the `Plus` orb belongs to
 *    the pre-redesign screen.
 *  - **voice is `AudioLines`**, the glyph the native voice orb uses, on the
 *    redesign's flat brand circle. The Figma frames have no voice button at all
 *    (they show the send slot in both its states), so the *shape* follows the
 *    slot it shares and only the glyph comes from the native screen.
 */

/** Figma: the text grows to ~128px, then scrolls. */
const MAX_TEXTAREA_PX = 128;
/** Short enough that the send<->stop swap stays snappy. */
const SLOT_FADE_MS = 160;
/** Below this the "keyboard" is rounding noise, not a keyboard. */
const KEYBOARD_EPSILON_PX = 24;
/** Breathing room between the composer card and a toast floating above it. */
const TOAST_GAP_PX = 8;

/* ------------------------------------------------------------------ */
/* Draft                                                               */
/* ------------------------------------------------------------------ */

/**
 * The draft lives in module state, not component state: it has to survive a
 * thread switch within the session, which a `useState` in a component that is
 * remounted (or re-keyed) on that switch cannot do.
 *
 * Keyed *by thread*, though — "survives a thread switch" means the draft comes
 * back when you return to the thread you typed it in, not that one string
 * follows you into every other thread. Empty drafts are dropped rather than
 * stored, so the map only ever holds the threads actually typed in this session.
 */
const drafts = new Map<ThreadTarget, string>();
const draftListeners = new Set<() => void>();

const getDraft = (threadId: ThreadTarget): string => drafts.get(threadId) ?? '';

function subscribeDraft(listener: () => void): () => void {
  draftListeners.add(listener);
  return () => {
    draftListeners.delete(listener);
  };
}

function setDraft(threadId: ThreadTarget, next: string): void {
  if (next === getDraft(threadId)) return;
  if (next === '') drafts.delete(threadId);
  else drafts.set(threadId, next);
  for (const listener of [...draftListeners]) listener();
}

/* ------------------------------------------------------------------ */
/* Keyboard                                                            */
/* ------------------------------------------------------------------ */

/**
 * How far the composer must lift itself to clear the keyboard — the single most
 * fragile part of this screen, so read this before changing it.
 *
 * There are two platforms and they behave differently:
 *
 *  - **Android** (`softwareKeyboardLayoutMode: "resize"`) shrinks the WebView
 *    itself. `window.innerHeight` shrinks with it, the app shell's flex column
 *    re-lays-out, and the composer is already above the keyboard. Nothing to do.
 *  - **iOS** (WKWebView) does *not* resize the layout viewport. Only
 *    `visualViewport` shrinks, so the composer stays where it was, under the
 *    keyboard, unless we move it ourselves.
 *
 * Measuring the *overlap* rather than branching on a UA string handles both with
 * one code path, and — crucially — cannot apply a translate on top of a resize:
 * where the viewport resized, `innerHeight - visualViewport.height` is already
 * ~0, so the lift is 0. This is also why the caller must not add
 * `--inset-keyboard` to the padding while a lift is active; the host reports
 * that number as a cross-check, and using both would double-count on iOS.
 *
 * Returns `null` when there is no `visualViewport` at all (an old WebView), and
 * the caller falls back to the host-reported CSS variable.
 */
function useKeyboardLift(): number | null {
  const [lift, setLift] = useState<number | null>(() => (window.visualViewport ? 0 : null));

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    // The iOS keyboard animation fires these events per frame; coalescing to one
    // rAF keeps us to a single layout read + write per painted frame.
    let frame = 0;
    const measure = (): void => {
      frame = 0;
      // `offsetTop` matters because iOS scrolls the layout viewport under the
      // visual one when a field near the bottom is focused; without it the
      // composer over-lifts by exactly that scroll.
      const covered = window.innerHeight - viewport.height - viewport.offsetTop;
      setLift(covered > KEYBOARD_EPSILON_PX ? Math.round(covered) : 0);
    };
    const schedule = (): void => {
      if (frame === 0) frame = requestAnimationFrame(measure);
    };

    measure();
    viewport.addEventListener('resize', schedule);
    viewport.addEventListener('scroll', schedule);
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      viewport.removeEventListener('resize', schedule);
      viewport.removeEventListener('scroll', schedule);
    };
  }, []);

  return lift;
}

/**
 * Bottom padding for the composer shell, given the measured keyboard lift.
 *
 * Padding rather than a `translateY`, and that is the whole point: a transform
 * takes no layout space, so a lifted composer floats *over* the newest message
 * instead of shrinking the transcript. The shell is a flex sibling of the
 * message list, so growing its padding shrinks the list and the last message
 * stays visible — the same trick the native composer plays (see
 * `ChatScreen/hooks/composerLift.hooks.ts` in the app).
 */
function bottomPadding(lift: number | null): string {
  // No `visualViewport` to measure: trust the host's numbers instead.
  if (lift === null) return 'calc(var(--inset-bottom) + var(--inset-keyboard) + 14px)';
  // Lifted — the keyboard covers the home indicator, so its inset collapses.
  if (lift > 0) return `${lift + 14}px`;
  return 'calc(var(--inset-bottom) + 14px)';
}

/**
 * Publish the composer's top edge to `--toast-offset`, so a toast floats just
 * above the card instead of landing on its action row.
 *
 * `Toast` anchors itself at `calc(var(--inset-bottom) + var(--toast-offset))`,
 * so what we publish is a `calc()` that cancels the inset back out: the result
 * is exactly the card's top edge measured up from the bottom of the layout
 * viewport, plus a gap.
 *
 * Measuring the rect rather than adding up paddings is what makes the keyboard
 * case work for free — `getBoundingClientRect()` already reflects the lift, and
 * a `position: fixed` toast resolves `bottom` against the same
 * layout viewport the rect is relative to, so the toast rides up with the
 * composer on iOS with no second calculation to keep in sync.
 *
 * Everything funnels through one rAF: the observer fires on a growing textarea
 * and on chips appearing, the `lift` effect covers the card *moving* without
 * resizing (which no observer reports). A toast one frame behind the composer
 * is invisible; two layout reads in a frame are not.
 */
function useToastOffset(card: RefObject<HTMLDivElement | null>, lift: number | null): void {
  const scheduleRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const element = card.current;
    if (!element) return;
    const root = document.documentElement;

    let frame = 0;
    const publish = (): void => {
      frame = 0;
      const top = Math.round(
        window.innerHeight - element.getBoundingClientRect().top + TOAST_GAP_PX,
      );
      root.style.setProperty('--toast-offset', `calc(${top}px - var(--inset-bottom))`);
    };
    const schedule = (): void => {
      if (frame === 0) frame = requestAnimationFrame(publish);
    };

    scheduleRef.current = schedule;
    schedule();

    // Guarded: the oldest WebViews we support predate the app, not
    // ResizeObserver — but a missing one must degrade to "published once", not
    // to a crashed composer.
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    observer?.observe(element);

    return () => {
      scheduleRef.current = null;
      if (frame !== 0) cancelAnimationFrame(frame);
      observer?.disconnect();
      // Back to the stylesheet default — the composer is the only thing that
      // knows this number, so it must not outlive it.
      root.style.removeProperty('--toast-offset');
    };
  }, [card]);

  // The card moves without resizing when the keyboard opens; nothing observes
  // that, so republish from the same rAF path.
  useEffect(() => {
    scheduleRef.current?.();
  }, [lift]);
}

/* ------------------------------------------------------------------ */
/* Composer                                                            */
/* ------------------------------------------------------------------ */

export type ComposerProps = {
  /**
   * Show the microphone in the send slot when there is nothing drafted. Voice
   * itself is native — the button only posts `open.voice`.
   */
  showVoice?: boolean;
  /** Layout only — outer spacing. Not fills. */
  className?: string;
};

export function Composer({ showVoice = true, className }: ComposerProps) {
  const attachments = usePendingAttachments();
  const attachmentsReady = useAttachmentsReady();
  const { isRunning, conversationUuid, threadId } = useChatState();
  // The getter's identity changes with the thread, which is exactly when
  // `useSyncExternalStore` must re-read — so switching threads swaps the draft.
  const readDraft = useCallback(() => getDraft(threadId), [threadId]);
  const text = useSyncExternalStore(subscribeDraft, readDraft, readDraft);
  const { sendMessage, stop } = useChatActions();
  const { show } = useToast();
  const { t } = useTranslation();

  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const lift = useKeyboardLift();

  // A toast anchors itself above the composer; only the composer knows how tall
  // it currently is, so it publishes that number rather than the shell guessing.
  useToastOffset(cardRef, lift);

  // One toast per upload failure, from the one component that is always mounted.
  // It cannot live in `ComposerAttachments`: a rejection (too large, over the
  // cap) fires with no chip on screen, and that component renders nothing then.
  useEffect(() => onUploadError((message) => show(message, { type: 'error' })), [show]);

  // Autosize: reset to `auto` first, or `scrollHeight` only ever reports the
  // height we last set and the field can never shrink back.
  useLayoutEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, MAX_TEXTAREA_PX)}px`;
  }, [text]);

  const hasText = text.trim().length > 0;
  const hasDraft = hasText || attachments.length > 0;
  // The one send gate. **Text or an attachment** — the backend now accepts a send
  // whose `content` is empty as long as `file_uuids` is not (and gives the model a
  // generic "review the attached file(s)" instruction), so attaching a photo and
  // pressing send is a complete message. It stores the empty content verbatim, so
  // the turn renders as "no text, one attachment" rather than a fabricated caption
  // — which is why nothing is synthesised on this side either.
  //
  // Every attachment must still have finished uploading: `takeUploadedUuids()`
  // returns only the completed ones, so sending early drops the rest silently.
  // That check is vacuously true with nothing attached.
  //
  // A run in progress does not block it any more: a message written while the
  // reply is still coming is **queued** (`chat/queue.ts`) and goes out once the
  // reply is done, instead of forking the conversation.
  const canSend = hasDraft && attachmentsReady;

  const handleSend = useCallback(() => {
    if (!canSend) return;
    send('haptic', { style: 'tap' });
    const outgoing = text.trim();
    // Cleared before the send so a synchronous re-render cannot repaint the
    // draft the user just posted.
    setDraft(threadId, '');
    sendMessage(outgoing);
  }, [canSend, text, sendMessage, threadId]);

  const handleStop = useCallback(() => {
    send('haptic', { style: 'tap' });
    stop();
  }, [stop]);

  const handleAttach = useCallback(() => {
    send('haptic', { style: 'tap' });
    setIsPickerOpen(true);
  }, []);

  const handleVoice = useCallback(() => {
    // Every other button in this row confirms itself by touch; the native orbs
    // all do too (`hapticTap` lives inside `IconOrbButton`). This one was the
    // single silent control in the composer.
    send('haptic', { style: 'tap' });
    // A call on a thread that does not exist yet starts one, so it carries the
    // company the pill picked for it (only while several are selected).
    const companyUuid = conversationUuid === null ? getCompanyForNewThread() : undefined;
    send('open.voice', companyUuid ? { conversationUuid, companyUuid } : { conversationUuid });
  }, [conversationUuid]);

  const isStopSlot = isRunning;
  const isVoiceSlot = showVoice && !hasDraft && !isRunning;
  const isSendSlot = !isStopSlot && !isVoiceSlot;

  return (
    <div
      className={clsx('shrink-0 px-[14px]', className)}
      style={{
        // Lifted by the measured overlap where the viewport did not resize (iOS);
        // where it did (Android) the lift is 0 and the flex layout has already
        // done the work — the two can never both apply. No CSS transition:
        // `visualViewport` already fires once per frame of the keyboard's own
        // animation, and a transition on top of that is what makes a WebView
        // composer lag behind the keyboard.
        paddingBottom: bottomPadding(lift),
      }}
    >
      {/* No stroke: neither Figma frame draws one — the card is a white surface
          on the grey screen, and in dark it is the app's card convention the
          other way up (a zinc-900 card on the zinc-800 screen). */}
      <div ref={cardRef} className="overflow-hidden rounded-composer bg-surface">
        {/* Above the text — the chips, only when something is attached. */}
        <ComposerAttachments />

        {/* Row 1 — text. `min-h` + centring rather than symmetric padding, so a
            single line sits on the row's optical centre while a wrapped one still
            keeps its 10px above and below. */}
        <div className="flex min-h-[48px] items-center px-3 py-2.5">
          <textarea
            ref={textareaRef}
            rows={1}
            value={text}
            onChange={(event) => setDraft(threadId, event.target.value)}
            // Figma 3234:71095 spells it "Your massage..." — the typo is the
            // design's, not the copy's, so it ships corrected.
            placeholder={t('composer.placeholder')}
            aria-label={t('composer.message')}
            // Enter inserts a newline and sending is the button only: this is a
            // touch keyboard, and a Send key there would make a multi-line
            // message impossible to type.
            enterKeyHint="enter"
            autoCapitalize="sentences"
            autoCorrect="on"
            spellCheck
            className={clsx(
              'block w-full resize-none bg-transparent text-[1rem] leading-[1.375rem] text-label',
              'overflow-y-auto placeholder:text-label-tertiary',
            )}
            style={{ maxHeight: MAX_TEXTAREA_PX }}
          />
        </div>

        {/* Row 2 — actions. */}
        <div className="flex items-center justify-between gap-2 p-1.5">
          <div className="flex min-w-0 items-center gap-1.5">
            <IconButton icon={Paperclip} onPress={handleAttach} label={t('composer.addAttachment')} />
            {/* forBusiness: one fake company, so the company pill is never shown. */}
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {/* While a reply runs and something is drafted, send sits beside stop:
                it queues the message rather than sending it (see `canSend`). On a
                desktop that is Enter; here Enter is a newline, so it needs a button. */}
            {isRunning && hasDraft ? (
              <IconButton
                icon={ArrowUp}
                onPress={handleSend}
                label={t('composer.send')}
                variant="primary"
                disabled={!canSend}
              />
            ) : null}
            {/* One 36px slot for all three states, stacked so a state change
                cross-fades in place. The inactive layers stay mounted — that is
                what makes it a fade — but are inert and hidden from assistive
                tech, so only ever one of them is a real button. */}
            <div className="relative h-9 w-9 shrink-0">
              <Slot active={isStopSlot}>
                <IconButton
                  icon={Square}
                  onPress={handleStop}
                  label={t('composer.stop')}
                  variant="primary"
                  // Lucide ships no filled square and the stop glyph has to read as
                  // solid at 20px — fill the outline with its own stroke colour.
                  className="[&_svg]:fill-current"
                />
              </Slot>
  
              <Slot active={isSendSlot}>
                <IconButton
                  icon={ArrowUp}
                  onPress={handleSend}
                  label={t('composer.send')}
                  variant="primary"
                  disabled={!canSend}
                />
              </Slot>
  
              <Slot active={isVoiceSlot}>
                <IconButton
                  icon={AudioLines}
                  onPress={handleVoice}
                  label={t('composer.voiceMode')}
                  variant="primary"
                />
              </Slot>
            </div>
          </div>
        </div>
      </div>

      <AttachmentPickerSheet isOpen={isPickerOpen} onClose={() => setIsPickerOpen(false)} />
    </div>
  );
}

/** One layer of the cross-fading send slot. */
function Slot({ active, children }: { active: boolean; children: React.ReactNode }) {
  return (
    <div
      inert={!active}
      aria-hidden={active ? undefined : true}
      className={clsx(
        'absolute inset-0 transition-opacity ease-out',
        active ? 'opacity-100' : 'pointer-events-none opacity-0',
      )}
      style={{ transitionDuration: `${SLOT_FADE_MS}ms` }}
    >
      {children}
    </div>
  );
}
