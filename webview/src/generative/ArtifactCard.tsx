import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';

import { useTranslation } from '@/i18n';
import { logger } from '@/lib/logger';

import { ArtifactView } from './jsx/ArtifactView';

const log = logger.child('generative.artifact');

/**
 * A model-generated view (`ai.artifact.generated`).
 *
 * When the agent decides a chart, table or KPI card says it better than prose it
 * calls `render_ui`, and the backend publishes the result as JSX **source** — a
 * string, not a component. `ArtifactView` renders that against the component
 * whitelist we own (`jsx/primitives.tsx`); this decides what happens when it
 * cannot.
 *
 * **The fallback names the view instead of showing nothing.** There is no way to
 * guarantee a model writes JSX we can render — it may reach for a component that
 * is not on the list, or write an expression the parser refuses — and a silently
 * empty space is the one outcome worth ruling out: the user asked for something
 * and the assistant said it had drawn it. A titled card is a small answer, but it
 * is an honest one, and every path into it is logged with a reason.
 */
export type ArtifactCardProps = {
  title: string;
  jsx: string | null;
  sourceTool?: string;
};

export function ArtifactCard({ title, jsx, sourceTool }: ArtifactCardProps) {
  // Set by `ArtifactView` when the parse or the render failed. Keyed off the
  // payload so a *new* artifact is never suppressed by the previous one's failure.
  const [failedFor, setFailedFor] = useState<string | null>(null);
  const failed = jsx !== null && failedFor === jsx;
  const { t } = useTranslation();

  // The last link in the chain: the event arrived, it parsed, a part was
  // committed, and this is what became of it. Once per artifact, not per render.
  useEffect(() => {
    log.info('generated view reached the transcript', {
      title,
      jsxChars: jsx?.length ?? 0,
      sourceTool,
      // The three outcomes, told apart: nothing to draw, drawn, or refused.
      outcome: jsx === null ? 'no-payload' : 'rendered',
    });
  }, [jsx, sourceTool, title]);

  if (jsx !== null && !failed) {
    return <ArtifactView jsx={jsx} title={title} onFailed={() => setFailedFor(jsx)} />;
  }

  return (
    <div className="my-1 flex w-full items-center gap-3 rounded-card bg-surface px-4 py-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Sparkles size={18} strokeWidth={2} aria-hidden />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-[0.9375rem] leading-5 font-semibold text-label">
          {title}
        </span>
        <span className="text-[0.8125rem] leading-[1.125rem] text-label-tertiary">
          {failed ? t('artifact.failed') : t('artifact.empty')}
        </span>
      </span>
    </div>
  );
}
