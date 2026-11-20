import { memo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import clsx from 'clsx';

import { send } from '@/bridge/bridge';
import { logger } from '@/lib/logger';

/**
 * Assistant prose. Two constraints shape every choice here:
 *
 * 1. **Streaming.** This re-parses on every token, so the source is routinely
 *    half-written — an unclosed ```fence, a lone `**`, a table with one row.
 *    remark degrades those to literal text or an open block, which is fine; what
 *    is *not* fine is a long unbroken token or a wide table pushing the column
 *    sideways, so everything wraps and every wide block scrolls inside itself.
 * 2. **Untrusted output.** No `rehype-raw`: model-authored HTML never renders.
 *    Links are intercepted and handed to the host — a navigation *in place*
 *    would replace the chat with a web page and there is no way back.
 */

const REMARK_PLUGINS = [remarkGfm];

const log = logger.child('markdown');

/**
 * Hand a tapped link to the host.
 *
 * Logged, without the query string: a download link the model pastes into its
 * answer is a *presigned* URL — its signature is the credential, and it has no
 * business in a log file or a Sentry breadcrumb. Host and path are enough to say
 * "the tap registered and this is where it was pointed", which is the whole
 * question when a user reports that nothing happens.
 */
function openLink(event: React.MouseEvent<HTMLAnchorElement>, href: string | undefined): void {
  event.preventDefault();
  if (!href) return;
  let target: string;
  try {
    const url = new URL(href);
    target = `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    // Not an absolute URL — log what little there is, minus anything after a `?`.
    target = href.split('?')[0];
  }
  log.info('opening a link from a reply', { target, hasQuery: href.includes('?') });
  send('haptic', { style: 'tap' });
  send('open.url', { url: href });
}

const COMPONENTS: Components = {
  p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,

  h1: ({ children }) => (
    <h1 className="mt-4 mb-2 text-[1.25rem] leading-7 font-semibold text-label first:mt-0">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-4 mb-2 text-[1.125rem] leading-6 font-semibold text-label first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-3 mb-1.5 text-[1rem] leading-6 font-semibold text-label first:mt-0">
      {children}
    </h3>
  ),
  h4: ({ children }) => (
    <h4 className="mt-3 mb-1.5 text-[0.9375rem] leading-5 font-semibold text-label first:mt-0">
      {children}
    </h4>
  ),

  ul: ({ children }) => (
    <ul className="my-2 list-disc space-y-1 pl-5 first:mt-0 last:mb-0">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="my-2 list-decimal space-y-1 pl-5 first:mt-0 last:mb-0">{children}</ol>
  ),
  // A list item's paragraph must not add its own vertical rhythm on top of the
  // list's, or a tight list renders double-spaced.
  li: ({ children }) => <li className="[&>p]:my-0">{children}</li>,

  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-border pl-3 text-label-secondary">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-3 border-0 border-t border-border" />,
  strong: ({ children }) => <strong className="font-semibold text-label">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,

  // `touch-manipulation` is not cosmetic: without it a WebView holds every tap for
  // ~300ms waiting for a double-tap-to-zoom, and a link that takes a third of a
  // second to react reads as one that did not react at all. `active:opacity-60`
  // is the other half of that — the page sets `-webkit-tap-highlight-color:
  // transparent`, so without an explicit pressed state a tap has no feedback
  // whatsoever. `anywhere` keeps a presigned download URL, which is one
  // 400-character word, from pushing the column sideways.
  a: ({ href, children }) => (
    <a
      href={href}
      onClick={(event) => openLink(event, href)}
      className="touch-manipulation text-primary underline underline-offset-2 [overflow-wrap:anywhere] active:opacity-60"
    >
      {children}
    </a>
  ),

  // Inline styling is the default; the `pre` rules below neutralise it for a
  // fenced block. Deciding inline-vs-block from props is unreliable in
  // react-markdown v10 (a fence with no language looks exactly like inline code).
  //
  // The fill is the *card* step, not the muted one: a reply is plain text on the
  // screen background, and the muted step is that same background to within a
  // shade — code set in it was indistinguishable from the prose around it.
  code: ({ className, children }) => (
    <code
      className={clsx(
        'rounded border border-border bg-surface px-1 py-0.5 font-mono text-[0.8125rem] text-label',
        className,
      )}
    >
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded-card border border-border bg-surface p-3 text-[0.8125rem] leading-5 [&_code]:border-0 [&_code]:bg-transparent [&_code]:p-0">
      {children}
    </pre>
  ),

  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-[0.875rem]">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-border px-2 py-1 text-left font-semibold text-label">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-border px-2 py-1 align-top text-label">{children}</td>
  ),

  // A model-authored `![](https://…)` would be a remote fetch from an offline,
  // CSP-locked WebView. Attachments have their own tiles; markdown images don't.
  img: () => null,
};

export type MarkdownProps = { text: string };

/**
 * Memoised on `text`: a streaming turn re-renders on every token, and only the
 * part that actually grew should re-parse.
 */
export const Markdown = memo(function Markdown({ text }: MarkdownProps) {
  return (
    <div className="min-w-0 text-[1rem] leading-[1.375rem] text-label [overflow-wrap:anywhere]">
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={COMPONENTS}>
        {text}
      </ReactMarkdown>
    </div>
  );
});
