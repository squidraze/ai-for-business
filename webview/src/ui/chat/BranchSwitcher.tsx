import { useCallback, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import clsx from 'clsx';

import { send } from '@/bridge/bridge';
import { switchBranch } from '@/chat/branches';
import type { BranchInfo } from '@/chat/types';
import { useTranslation } from '@/i18n';
import { useToast } from '@/ui/primitives';

/**
 * The "n of N" walker under a message that has alternate versions.
 *
 * Editing a question or regenerating an answer forks a **sibling** rather than
 * overwriting anything, so a turn can exist in several versions and the
 * transcript shows one of them. This is how the others are reachable — and it is
 * the only thing that makes forking safe to offer: without it, regenerating an
 * answer would look exactly like destroying the previous one.
 *
 * **It only mounts where there is genuinely something to switch between**
 * (`sibling_count > 1` on a history page). Rendering a permanent "1 of 1" under
 * every turn would put a control on a hundred rows to serve two.
 *
 * **The position can lag the count by one request.** `sibling_count` comes with
 * the history page; *which* version is on screen only comes from `/siblings`,
 * which is read lazily (see `branches.ts`). So this shows the bare count until
 * that lands, with the arrows inert — a switcher that says "2 of 3" before it
 * knows which one it is looking at would be a guess, and pressing it would jump
 * somewhere unexpected.
 */
export type BranchSwitcherProps = {
  /** The message this fork belongs to. Every branch call is keyed by it. */
  messageUuid: string;
  info: BranchInfo;
  className?: string;
};

const ARROW =
  'relative flex size-5 items-center justify-center text-label-secondary transition-opacity ' +
  'after:absolute after:-inset-2 active:opacity-60 disabled:pointer-events-none disabled:opacity-30';

export function BranchSwitcher({ messageUuid, info, className }: BranchSwitcherProps) {
  const { show } = useToast();
  const { t } = useTranslation();
  // Local, because a switch replaces the whole transcript: the store entry this
  // reads (`info.switching`) is cleared by the reload that unmounts this very
  // component, so it cannot be the only thing driving the disabled state.
  const [busy, setBusy] = useState(false);

  const move = useCallback(
    (delta: 1 | -1) => {
      setBusy(true);
      send('haptic', { style: 'tap' });
      void switchBranch(messageUuid, delta)
        .then((ok) => {
          if (!ok) show(t('branch.switchFailed'), { type: 'error' });
        })
        .finally(() => setBusy(false));
    },
    [messageUuid, show, t],
  );

  const known = info.index !== null && info.uuids !== null;
  const locked = busy || info.switching || !known;
  const atStart = !known || info.index === 0;
  const atEnd = !known || info.index === (info.uuids?.length ?? info.count) - 1;

  return (
    <div
      className={clsx('flex h-6 items-center gap-1', className)}
      // One label for the whole control: three separate ones ("previous", "2 of
      // 3", "next") is what a screen reader would otherwise read out per turn.
      aria-label={
        known ? t('branch.version', { index: (info.index ?? 0) + 1, count: info.count }) : undefined
      }
    >
      <button
        type="button"
        aria-label={t('branch.previous')}
        disabled={locked || atStart}
        onClick={() => move(-1)}
        className={ARROW}
      >
        <ChevronLeft size={16} strokeWidth={2} aria-hidden />
      </button>

      <span className="min-w-8 text-center text-[0.75rem] leading-4 text-label-tertiary tabular-nums">
        {known ? `${(info.index ?? 0) + 1}/${info.count}` : info.count}
      </span>

      <button
        type="button"
        aria-label={t('branch.next')}
        disabled={locked || atEnd}
        onClick={() => move(1)}
        className={ARROW}
      >
        <ChevronRight size={16} strokeWidth={2} aria-hidden />
      </button>
    </div>
  );
}
