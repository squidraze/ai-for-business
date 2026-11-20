/**
 * Renders a generated view — the JSX an `ai.artifact.generated` event carried.
 *
 * The backend produces that JSX against AI Elements' `JSXPreview`, which is
 * `react-jsx-parser` plus a host-supplied `components` map. This is the same
 * pairing, so JSX that renders on their reference host renders here: using a
 * different parser would mean the prompt was written against one renderer and
 * read by another, and the differences would surface as views that quietly come
 * out wrong.
 *
 * ## What is allowed through
 *
 * The parser never calls `eval` — it walks an acorn AST — but it does evaluate
 * expressions, so the surface is narrowed on top of it:
 *
 * - **`components` is the whitelist.** A tag with no entry renders as a plain
 *   HTML element or not at all; there is no path from a name in the string to a
 *   component we did not list (see `primitives.tsx`).
 * - **No `bindings`.** The scope is empty, so an expression has nothing to reach
 *   for — no data, no functions, nothing of the app.
 * - **Attributes are filtered**, not sanitised: every `on*` handler,
 *   `dangerouslySetInnerHTML`, inline `style`, and `class`/`className` are
 *   dropped before they reach an element. The first three are the injection
 *   surface; the last is a design decision explained in `primitives.tsx`.
 * - **Tags that load or submit are blacklisted** — script, iframe, img, form and
 *   friends. Under the page's CSP most of them could not fetch anything anyway,
 *   but a blocked `<img>` is still a broken box on the screen.
 *
 * ## Failure is visible, never silent — but a stumble is not a failure
 *
 * `onError` fires per bad node, and most of what it reports is survivable: a
 * blacklisted `<img>` among ten good cards costs the image, not the view. So an
 * error **logs and nothing more**.
 *
 * What triggers the fallback is the outcome, measured after the fact: if the
 * rendered subtree has no elements and no text, nothing reached the screen and
 * the caller names the artifact instead. Driving the fallback off `onError`
 * instead was tried and was wrong in exactly the direction that matters — a view
 * that rendered perfectly well was replaced by "couldn’t be displayed" because
 * one node inside it had been filtered out.
 */
import JsxParser from 'react-jsx-parser';
import { useCallback, useEffect, useRef } from 'react';

import { logger } from '@/lib/logger';

import {
  ARTIFACT_COMPONENT_NAMES,
  BLACKLISTED_ATTRS,
  BLACKLISTED_TAGS,
  COMPONENTS,
} from './whitelist';

const log = logger.child("generative.jsx");

export interface ArtifactViewProps {
  jsx: string;
  /** Named in the log lines, so a failure can be tied to the view that produced it. */
  title: string;
  /** Called only when the subtree came out empty — the caller shows the fallback. */
  onFailed: () => void;
}

export function ArtifactView({ jsx, title, onFailed }: ArtifactViewProps) {
  // `onError` fires per bad node, and a broken payload fires it repeatedly. The
  // first one is the diagnosis; the rest are the same story, and these lines
  // cross the bridge into the native log file. Keyed by the payload rather than a
  // boolean, so a new artifact gets its own first error with nothing to reset.
  const reportedFor = useRef<string | null>(null);

  const handleError = useCallback(
    (error: Error) => {
      if (reportedFor.current === jsx) return;
      reportedFor.current = jsx;
      // Logged, not escalated: this is one node the filter or the parser refused,
      // and the rest of the view is very likely fine. Whether anything actually
      // reached the screen is decided below, by looking.
      log.warn('a node in a generated view was refused', {
        title,
        message: error.message,
        jsxChars: jsx.length,
        known: ARTIFACT_COMPONENT_NAMES,
      });
    },
    [jsx, title],
  );

  // Did anything land? Measured rather than inferred, because every cause — a
  // parse that produced no tree, a payload made entirely of unknown tags, a
  // filtered-out root — ends the same way on screen and only this can tell.
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const empty =
      element.querySelectorAll('*').length === 0 &&
      (element.textContent ?? '').trim() === '';
    if (!empty) return;
    log.warn('generated view rendered nothing — falling back to its title', {
      title,
      jsxChars: jsx.length,
      known: ARTIFACT_COMPONENT_NAMES,
    });
    onFailed();
  }, [jsx, onFailed, title]);

  return (
    <div ref={host} className="w-full">
      <JsxParser
        jsx={jsx}
        components={COMPONENTS}
        // An empty scope: an expression in the payload has nothing to reach for.
        bindings={{}}
        blacklistedAttrs={BLACKLISTED_ATTRS}
        blacklistedTags={BLACKLISTED_TAGS}
        // Plain HTML (`div`, `h2`, `p`, `ul`) is how the model lays a view out, and
        // it is styled by the `.ai-artifact` rules in `index.css` rather than by
        // the classes the model wrote — which are stripped above.
        allowUnknownElements
        autoCloseVoidElements
        renderInWrapper
        className="ai-artifact flex w-full flex-col"
        onError={handleError}
        // Nothing for an unrecognised tag: the whitelist is the contract, and a
        // placeholder box per unknown name would bury the parts that did render.
        renderUnrecognized={() => null}
      />
    </div>
  );
}
