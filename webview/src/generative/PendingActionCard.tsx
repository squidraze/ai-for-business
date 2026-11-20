/**
 * Human-in-the-loop (HITL) approval card.
 *
 * When an AI run reaches an action that needs human sign-off the backend
 * publishes `ai.action.pending`. The run is paused, not finished. That event is
 * surfaced inline in the assistant turn through the generative-UI tool path
 * (`renderToolBlock` special-cases `HITL_PENDING_TOOL_NAME`), so it arrives in
 * order relative to the surrounding text. A card can also come back from
 * `GET …/pending` when a conversation is reopened (`recoverRuns`).
 *
 * The user approves or rejects; `resumeAction` POSTs the decision and the backend
 * continues the same run on the channel, streaming straight back into the open
 * turn. A failed resume is recoverable — the buttons come back with an
 * `ErrorState` and retry, because the run is still waiting on this card.
 *
 * **Standing approvals.** When `allow_options` says every tool on the card
 * accepts it, the card also offers "Allow for this session" / "Always allow" —
 * an approve that stops the assistant asking for the same tool. What the card
 * says afterwards comes from the answer's `allowed`, not from the button: the
 * backend downgrades `always` to `session` for a tool that leaves the company or
 * moves money, and the card must not claim more than was recorded.
 *
 * **A stranded card.** A row restored in `resolving` had its decision accepted
 * and the task that should have resumed the run died; answering again does
 * nothing. Its only action is to free it (`…/release`), after which it is an
 * ordinary card again.
 */
import { CheckCircle2, ShieldQuestion, TriangleAlert, XCircle } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { send } from '@/bridge/bridge';
import { ALLOW_LABEL, cardAllowChoices, readAllowOptions, recordedScope } from '@/chat/allow';
import { useChatActions } from '@/chat/useChat';
import { t as translate, useTranslation } from '@/i18n';
import { getErrorMessage } from '@/lib/api/errors';
import type { AllowScope } from '@/lib/api/types';
import { logger } from '@/lib/logger';
import type { HitlPendingArgs } from '@/realtime/aiEvents';
import { ErrorState, PrimaryButton } from '@/ui/primitives';

const log = logger.child('hitl');

type Decision = 'approve' | 'reject';

/** One press: the decision, and on an approve the standing scope it carried. */
type Choice = { decision: Decision; allow?: AllowScope };

/** A single action awaiting approval, normalised for display. */
interface NormalizedAction {
  title: string;
  detail?: string;
}

/**
 * The backend action payload is `unknown` — its shape is not in any generated
 * model — so normalise defensively: an array of actions, a single action object,
 * or a bare string all collapse to rows we can render without assuming a schema.
 */
function normalizeActions(actions: unknown): NormalizedAction[] {
  const toRow = (item: unknown): NormalizedAction | null => {
    if (item == null) return null;
    if (typeof item === 'string') return item.trim() ? { title: item.trim() } : null;
    if (typeof item !== 'object') return { title: String(item) };

    const obj = item as Record<string, unknown>;
    const pick = (...keys: string[]): string | undefined => {
      for (const key of keys) {
        const value = obj[key];
        if (typeof value === 'string' && value.trim().length > 0) return value.trim();
      }
      return undefined;
    };

    return {
      title: pick('title', 'name', 'tool', 'tool_name', 'action', 'type') ?? translate('approval.actionFallback'),
      detail: pick('description', 'summary', 'detail', 'message'),
    };
  };

  const rows = Array.isArray(actions) ? actions : [actions];
  return rows.map(toRow).filter((row): row is NormalizedAction => row !== null);
}

/** What the card says once the decision went through. */
function resolvedText(decision: Decision, scope: AllowScope | null): string {
  if (decision === 'reject') return translate('approval.rejected');
  if (scope === 'always') return translate('approval.approvedAlways');
  if (scope === 'session') return translate('approval.approvedSession');
  return translate('approval.approved');
}

// `conversationUuid` is deliberately not read: `resumeAction` is keyed by the
// pending action, and the store already knows which conversation it belongs to.
export function PendingActionCard({ pendingUuid, actions, allowOptions, status }: HitlPendingArgs) {
  const { resumeAction, releaseAction } = useChatActions();
  const { t } = useTranslation();

  // The press the user committed to — the loading, resolved and retry paths all
  // need to know which button it was. `null` until they choose.
  const [choice, setChoice] = useState<Choice | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resolved, setResolved] = useState<{ decision: Decision; scope: AllowScope | null } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [stranded, setStranded] = useState(status === 'resolving');
  const [releasing, setReleasing] = useState(false);

  const rows = normalizeActions(actions);
  const allowChoices = useMemo(() => cardAllowChoices(readAllowOptions(allowOptions)), [allowOptions]);

  const submit = useCallback(
    (next: Choice) => {
      // Approving or rejecting is a commitment, and the native orbs confirm one
      // by touch; this card is the only place in the transcript that acts on the
      // user's behalf, so it must not be the silent one.
      send('haptic', { style: 'tap' });
      setChoice(next);
      setError(null);
      setIsSubmitting(true);
      // Async work needs its own catch — no boundary sees a rejected promise.
      void resumeAction(pendingUuid, next.decision, next.allow ? { allow: next.allow } : {})
        .then((accepted) => {
          const scope = next.decision === 'approve' ? recordedScope(accepted.allowed) : null;
          // Asked for one thing and got another — worth a line, since the card is
          // about to say the weaker one.
          if (next.allow && scope !== next.allow) {
            log.info('the backend recorded a different standing approval', {
              pendingUuid,
              asked: next.allow,
              recorded: scope,
            });
          }
          setResolved({ decision: next.decision, scope });
        })
        .catch((cause: unknown) => {
          log.error('resume failed', { pendingUuid, decision: next.decision, cause });
          setError(getErrorMessage(cause, t('approval.submitFailed')));
        })
        .finally(() => setIsSubmitting(false));
    },
    [pendingUuid, resumeAction, t],
  );

  const release = useCallback(() => {
    send('haptic', { style: 'tap' });
    setError(null);
    setReleasing(true);
    void releaseAction(pendingUuid)
      .then(() => setStranded(false))
      .catch((cause: unknown) => {
        log.error('release failed', { pendingUuid, cause });
        setError(getErrorMessage(cause, t('approval.freeFailed')));
      })
      .finally(() => setReleasing(false));
  }, [pendingUuid, releaseAction, t]);

  // Resolved — the decision was accepted; a compact confirmation, no buttons.
  if (resolved) {
    const approved = resolved.decision === 'approve';
    const Icon = approved ? CheckCircle2 : XCircle;
    return (
      <div className="my-2 flex items-center gap-2 rounded-card border border-border bg-surface px-4 py-3">
        <Icon
          size={18}
          className={approved ? 'shrink-0 text-success' : 'shrink-0 text-danger'}
          aria-hidden
        />
        <p className="text-[0.875rem] text-label-secondary">
          {resolvedText(resolved.decision, resolved.scope)}
        </p>
      </div>
    );
  }

  const busy = isSubmitting || releasing;
  const pressed = (decision: Decision, allow?: AllowScope) =>
    isSubmitting && choice?.decision === decision && choice.allow === allow;

  return (
    <div className="my-2 rounded-card border border-border bg-surface p-4">
      <div className="mb-3 flex items-center gap-2">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-muted text-label">
          {stranded ? (
            <TriangleAlert size={18} className="text-warning" aria-hidden />
          ) : (
            <ShieldQuestion size={18} aria-hidden />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[0.9375rem] font-semibold text-label">
            {stranded ? t('approval.strandedTitle') : t('approval.title')}
          </p>
          <p className="text-[0.8125rem] text-label-secondary">
            {stranded ? t('approval.strandedMessage') : t('approval.message')}
          </p>
        </div>
      </div>

      {rows.length > 0 ? (
        <div className="mb-3 flex flex-col gap-2">
          {rows.map((row, i) => (
            <div key={`${row.title}-${i}`} className="rounded-xl bg-surface-muted px-3 py-2.5">
              <p className="text-[0.875rem] font-medium text-label">{row.title}</p>
              {row.detail ? (
                <p className="mt-0.5 whitespace-pre-line text-[0.8125rem] leading-5 text-label-secondary">
                  {row.detail}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {error ? (
        <div className="mb-3">
          <ErrorState
            title={stranded ? t('approval.freeFailedTitle') : t('approval.submitFailedTitle')}
            message={error}
            onRetry={() => (stranded ? release() : choice && submit(choice))}
          />
        </div>
      ) : null}

      {stranded ? (
        <PrimaryButton className="w-full" loading={releasing} disabled={busy} onPress={release}>
          {t('approval.free')}
        </PrimaryButton>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <PrimaryButton
              variant="neutral"
              className="flex-1"
              loading={pressed('reject')}
              disabled={busy}
              onPress={() => submit({ decision: 'reject' })}
            >
              {t('approval.reject')}
            </PrimaryButton>
            <PrimaryButton
              className="flex-1"
              loading={pressed('approve')}
              disabled={busy}
              onPress={() => submit({ decision: 'approve' })}
            >
              {t('approval.approve')}
            </PrimaryButton>
          </div>
          {/* Narrowest first, under the plain answer: a standing approval is the
              bigger commitment, so it is never the first thing under a thumb. */}
          {allowChoices.map((scope) => (
            <PrimaryButton
              key={scope}
              variant="neutral"
              className="w-full"
              loading={pressed('approve', scope)}
              disabled={busy}
              onPress={() => submit({ decision: 'approve', allow: scope })}
            >
              {t(ALLOW_LABEL[scope])}
            </PrimaryButton>
          ))}
        </div>
      )}
    </div>
  );
}
