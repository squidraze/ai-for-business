# Rooler AI chat — the WebView app

This repo is the **AI chat screen** of the Rooler **business** mobile app. It is a
React 19 + Vite + Tailwind v4 web app that is built into **one self-contained
`index.html`** and loaded by a `react-native-webview` inside the Expo app at
`mobile-apps/apps/business`.

It is not a website. It is never served to a browser in production, it has no
router, no login screen and no navigation of its own. It renders exactly one
conversation and talks to the app that hosts it over a `postMessage` bridge.

Why a WebView at all, and every design decision behind it:
[`apps/business/docs/ai-chat-webview/ai-chat-webview.md`](https://github.com/Rooler-ai/mobile-apps/blob/main/apps/business/docs/ai-chat-webview/ai-chat-webview.md)
in the mobile monorepo.

---

## How it is embedded

```
mobile-apps/apps/business                      business-app-web-view (this repo)
┌──────────────────────────────────────┐       ┌──────────────────────────────┐
│ WebChatScreen.tsx                    │       │ index.html + src/            │
│  SafeAreaView + ChatHeader (native)  │       │                              │
│  ┌────────────────────────────────┐  │       │  vite build                  │
│  │ <WebView source={file://…}/>   │◀─┼───────┼── dist/index.html  (1 file)  │
│  └────────────────────────────────┘  │       │                              │
│  bridge.ts / handlers.ts             │◀─────▶│  src/bridge/bridge.ts        │
│  webchat/protocol.ts  (a COPY)       │◀──────┼── src/bridge/protocol.ts     │
└──────────────────────────────────────┘       └──────────────────────────────┘
```

Two files cross the boundary, and they only ever travel **out of this repo**:

| Artefact                | Lands at                                                 | Written by             |
| ----------------------- | -------------------------------------------------------- | ---------------------- |
| `dist/index.html`       | `apps/business/assets/webchat/index.html` (git-ignored)  | `npm run sync`, or the app's own `npm run webchat:build` |
| `src/bridge/protocol.ts` | `apps/business/src/features/ai-chat/webchat/protocol.ts` | `npm run sync` only    |

The app side loads the bundle from `file://` (copied to the document directory on
first launch) so `localStorage` works and no megabyte-sized string is pushed
through the bridge on every mount.

**That `file://` is also why this app has no network.** Its origin is `null`, so
every API call is cross-origin, and the backend's CORS allowlist — which sends
`access-control-allow-credentials: true` and therefore cannot fall back to `*` —
answers a `null`-origin preflight with `400 Disallowed CORS origin`. So REST
moved onto the bridge: the app posts `http.request`, the host performs the call
with the session it already holds, and the reply comes back as `http.response`.
axios is still here, whole; only its adapter changed. The Centrifugo websocket is
the one connection this app still opens for itself.

### `src/bridge/protocol.ts` is the single source of truth

The copy in the Expo app carries an `AUTO-GENERATED — DO NOT EDIT` header and is
overwritten by every `npm run sync`. **Changing the bridge means editing it
here**, syncing, and typechecking both repos — a protocol change is a change to
two shipped programs at once, so land them together.

Note that the app's own `npm run webchat:build` copies only the **bundle**. If
you changed `protocol.ts`, run `npm run sync` from this repo.

---

## Running it

### 1. In a browser (the usual loop)

```bash
npm install
cp .env.example .env.local     # optional — every value has a fallback
npm run dev                    # http://localhost:5173
```

There is no native host in a browser tab, so `src/dev/` installs a **mock host**:
it answers the `ready` handshake with a full `init` payload built from the
`VITE_DEV_*` variables, **performs every `http.request` the app posts**, holds
picked files for `attachment.upload`, and logs every web → native message to the
console so the protocol can be watched as you work.

That last point is the shape of the whole harness. The app makes no network
calls of its own — it has one transport, the bridge — so the harness stands in
where the host does rather than patching `XMLHttpRequest`: dev exercises the
exact path a device takes, envelope for envelope.

A **`DEV` button** in the top-right corner opens a small panel — this is how both
themes, the keyboard and the failure states are checked without a device:

| Control                  | Sends                                                 |
| ------------------------ | ----------------------------------------------------- |
| Theme                    | `theme.set` — light ⇄ dark                             |
| Keyboard                 | `insets.set` with `keyboard: 0` ⇄ `320`               |
| Safe area                | `insets.set` with a phone's top/bottom insets          |
| App                      | `app.state` — foreground ⇄ background                  |
| Send nav.back            | `nav.back`, the Android hardware back button           |
| Pick files (as the host) | `attachment.picked`, the native picker path            |
| Network: online/offline  | fails every `http.response` with `ERR_NETWORK`         |
| Fail the next request    | the same, for one request — a loaded thread, a bad send|
| Lose the session         | `session.lost`, i.e. the host is signing the user out  |

The whole harness lives behind `import.meta.env.DEV` and is dead-code eliminated
from the production bundle — see [Verifying the bundle](#verifying-the-bundle).

**Offline** — the mock backend is on by default (`VITE_DEV_MOCK_API`, see
[`.env.example`](.env.example)): `src/dev/mockBackend.ts` answers every
`http.request` from fixtures and replaces `WebSocket` for the page with a fake
Centrifugo socket that streams an AI run token by token. Nothing leaves the
browser. Only the socket is patched — REST arrives over the bridge, and only the
realtime connection is still the web app's own. A slash command at the start of
the message picks what the run does, whatever the panel is set to:

| Prompt         | The run                                                            |
| -------------- | ------------------------------------------------------------------ |
| `/tool <name>` | emits an `ai.tool_call` for that tool                              |
| `/error`       | fails with `ai.run.error`                                          |
| `/cancel`      | is cancelled mid-stream                                            |
| `/hitl`        | pauses on `ai.action.pending` for approval, offering both standing approvals |
| `/hitl session` | the same, but one tool accepts only "Allow for this session"      |
| `/hitl downgrade` | "Always allow" is recorded as `session`, as the backend does for some tools |
| `/hitl stuck`  | the decision is accepted and the run never continues — a stranded `resolving` row |
| `/hitl none`   | no standing approvals at all — Approve / Reject only               |
| `/auto`        | an allowed tool runs without a card (`ai.action.auto_approved`)    |
| `/work`        | a task list (`ai.todos`) and three tool calls, one of them failing |
| `/slow`        | streams slowly — leave the thread and come back to rejoin the run  |
| `/think`       | streams `ai.reasoning` before the first token                      |
| `/task`        | delegates to the `code-runner` subagent, and comes back            |
| `/task hang`   | delegates and the result never arrives — the hung-subagent case    |

The DEV panel's **Agent thread** opens a conversation with a custom agent; the mock
also answers `GET /auth/me/context` (a dispatcher with no `driver:read`),
`GET /ai/attention`, `GET /integrations/connections`, `GET …/runs` and
`GET …/pending` the way the backend does.

The seeded history thread also carries a reply that is already rated and one that
answers `422` on `/feedback` (the pre-migration case), so both feedback states are
on screen without a backend.

Set `VITE_DEV_MOCK_API=0` and the host performs each request for real against
`VITE_DEV_BASE_URL` with `VITE_DEV_TOKEN`. Note where those live: in the *host*,
not in the app — which is the point. On a device no token and no base URL ever
enter the WebView.

### 2. Against the app, on a device or emulator

Run this app's dev server, then point the Expo app at it — the WebView loads the
dev server instead of the bundled asset, so Vite HMR works inside the WebView:

```bash
npm run dev                    # here; the server listens on 0.0.0.0

# in mobile-apps/apps/business/.env
EXPO_PUBLIC_WEBCHAT_ENABLED=true
EXPO_PUBLIC_WEBCHAT_DEV_URL=http://10.0.2.2:5173     # Android emulator
# EXPO_PUBLIC_WEBCHAT_DEV_URL=http://localhost:5173  # iOS simulator
# EXPO_PUBLIC_WEBCHAT_DEV_URL=http://192.168.x.x:5173  # a physical device
```

Then `npx expo run:android` there (Expo Go cannot do this — `react-native-webview`
needs a native build). The dev URL is read only when `__DEV__` is true, so it can
never reach a release build.

With a real host present the mock host does not install: `hasNativeHost()` is
true, the `VITE_DEV_*` values are ignored, and every value in `init` comes from
the app.

### 3. Shipping the bundle

```bash
npm run check                  # typecheck + lint, both must be clean
npm run sync                   # vite build → copies the bundle and protocol.ts
```

`npm run sync` fails loudly if the destination is not the business app. Override
it when your checkout lives elsewhere:

```bash
ROOLER_APP_DIR=/path/to/mobile-apps/apps/business npm run sync
```

It also refuses to deliver a bundle that is not self-contained, and warns when
the bundle passes **800 KB** — every byte is parsed on every cold open of the
chat.

---

## Scripts

| Script              | What it does                                                        |
| ------------------- | ------------------------------------------------------------------- |
| `npm run dev`       | Vite dev server on `0.0.0.0:5173`, with the mock native host         |
| `npm run build`     | `vite build` → one self-contained `dist/index.html`                  |
| `npm run preview`   | Serve the built bundle on `:4173`                                    |
| `npm run typecheck` | `tsc -p tsconfig.app.json --noEmit`                                  |
| `npm run lint`      | `eslint . --max-warnings=0` — a warning is an error                  |
| `npm run check`     | typecheck + lint. **This is the gate; run it before syncing.**       |
| `npm run sync`      | build, verify, and deliver bundle + `protocol.ts` to the Expo app    |

`npm run sync` takes `--skip-build` (deliver the existing `dist/`) and `--force`
(skip the check that the destination really is `@rooler/business`).

---

## The bridge contract

One JSON envelope in both directions: `{ v, type, id?, payload }`. The surface is
narrow and enumerated on purpose — Apple guideline 4.7.2 forbids exposing native
APIs to embedded software, so there is deliberately no "call anything" message.
An unknown `type` is logged and ignored; neither side ever throws on one.

**Native → Web**

| Type                        | Payload                           | Meaning                                                             |
| --------------------------- | --------------------------------- | ------------------------------------------------------------------- |
| `init`                      | `InitPayload`                     | The one handshake reply. Company, user, thread, theme, insets, locale — **no token and no base URL**. |
| `theme.set`                 | `{ theme }`                       | The user flipped the OS/app theme.                                  |
| `locale.set`                | `{ locale }`                      | The app's UI language changed. Strings live in `src/i18n/locales/{en,ru,uz}.json`; the page never detects a language itself. |
| `insets.set`                | `Insets`                          | Safe area or keyboard height changed.                               |
| `session.lost`              | `{ message }`                     | The host lost the session and is signing out. Stop retrying.        |
| `thread.switch`             | `{ threadId }`                    | Show a different conversation.                                      |
| `http.response`             | `HttpResponse`                    | The answer to one `http.request`, matched by `requestId`.           |
| `attachment.picked`         | `{ files: PickedFile[] }`         | The native picker returned.                                         |
| `attachment.pick.cancelled` | —                                 | The user dismissed the picker.                                      |
| `attachment.uploaded`       | `{ id, uuid }` \| `{ id, error }` | The host finished — or failed — the upload it was asked for.        |
| `attachment.thumbnail`      | `{ localId, dataUri }`            | Answer to a thumbnail request; `null` when none.                    |
| `voice.ended`               | `{ conversationUuid }`            | The native voice screen closed.                                     |
| `app.state`                 | `{ active }`                      | Foreground/background.                                              |
| `nav.back`                  | —                                 | Android hardware back. Answer with `nav.consumed`.                  |

**Web → Native**

| Type                           | Payload                       | Meaning                                                          |
| ------------------------------ | ----------------------------- | ---------------------------------------------------------------- |
| `ready`                        | `{ version }`                 | The app is listening. Must be answered with `init`.              |
| `http.request`                 | `HttpRequest`                 | Perform this REST call. `url` is a path; the host holds the session. |
| `http.abort`                   | `{ requestId }`               | Cancel one in-flight call. The reply comes back `ERR_CANCELED`.  |
| `attachment.pick`              | `{ source }`                  | Open the camera / library / files picker.                        |
| `attachment.upload`            | `{ id }`                      | Upload the file the host is still holding.                       |
| `attachment.release`           | `{ id }`                      | Drop that hold — the chip went away, or the message was sent.    |
| `attachment.open`              | `{ url, name, mime }`         | Open an attachment natively.                                     |
| `attachment.thumbnail.request` | `{ localId, url }`            | Render a PDF/video thumbnail natively.                           |
| `clipboard.write`              | `{ text }`                    | Copy.                                                            |
| `haptic`                       | `{ style }`                   | Tap / success / warning feedback.                                |
| `open.url`                     | `{ url }`                     | Hand a link to the browser.                                      |
| `open.voice`                   | `{ conversationUuid }`        | Open the native voice screen.                                    |
| `open.list`                    | —                             | Go to the conversation list.                                     |
| `open.integrations`            | —                             | Open the host's Integrations sheet ("Add / Manage connectors").  |
| `thread.created`               | `{ conversationUuid }`        | The first message created the conversation.                      |
| `thread.titled`                | `{ conversationUuid, title }` | The backend titled it.                                           |
| `thread.changed`               | `{ conversationUuid }`        | The visible conversation changed.                                |
| `nav.consumed`                 | `{ consumed }`                | Whether the web app handled `nav.back`.                          |
| `generative.action`            | `GenerativeAction`            | An allowlisted action from an AI-rendered block.                 |
| `log`                          | `{ level, message, context }` | Forwarded to the native logger → Sentry.                         |
| `error`                        | `{ message, stack, context }` | A crash, with its stack.                                         |

**HTTP over the bridge.** `http.request` carries
`{ requestId, method, url, params?, body? }` — `url` is a **path** (`/api/v1/…`),
never an absolute URL, and there is no header field: the host attaches
`Authorization` and `X-Company-ID` from the session it already holds. The reply is
`{ requestId, ok: true, status, data }` or
`{ requestId, ok: false, status?, code?, message, data? }`; a 4xx/5xx comes back
as a failure **with its body**, because the user-facing error text is read from
`detail` — without it a 413 and a 429 are indistinguishable from being offline. The host also refuses requests itself, with codes
axios never produces: `ERR_FORBIDDEN_TARGET` (a `url` outside `/api/`),
`ERR_TOO_MANY_REQUESTS` (more than eight in flight), `ERR_DUPLICATE_REQUEST`,
`ERR_BAD_REQUEST`. A reply nobody is waiting for is discarded, so a late answer
can never resolve a promise its caller has moved on from.

**Attachments have two lanes.** Natively the host picks the file, keeps it, and
uploads it on `attachment.upload` — what crosses the bridge is an `id` and a
capped preview `dataUri` (images ≤ 1 MB; an empty string otherwise), never the
bytes. In a plain browser tab the `<input type="file">` fallback yields a real
`File` and goes out as ordinary `FormData`; inside the native host that path is
refused on purpose, because multipart cannot cross a JSON bridge.

The types, the guard and the exact payload shapes are in
[`src/bridge/protocol.ts`](src/bridge/protocol.ts); the transport (`send`, `on`,
`once`, `startBridge`) is in [`src/bridge/bridge.ts`](src/bridge/bridge.ts). The
axios adapter that turns a request into `http.request` is in
[`src/lib/api/client.ts`](src/lib/api/client.ts).

---

## Layout

```
src/
├── main.tsx        bridge → crash reporter → dev host (DEV) → ready → mount
├── App.tsx         the boot gate: waiting / failed / chat
├── app/            boot state, the screen, the theme hook
├── bridge/         protocol.ts (source of truth) + the transport
├── lib/api/        axios over the bridge (custom adapter), endpoints, errors
├── realtime/       Centrifugo connection + the AI run stream
├── chat/           store, history, run lifecycle, branches, companies
├── attachments/    picking, uploading, previews
├── generative/     generated views: the JSX renderer and its whitelist
├── ui/             primitives, chat surface, composer
└── dev/            DEV ONLY — the mock native host and the mock backend
```

## The chat, in three rules

These are the parts of the AI contract that shape the code rather than sitting
behind one function, so they are worth knowing before reading `src/chat/`.

**A run is not the conversation.** One conversation can have several runs going
at once (subagent fan-out, or a voice session sharing it), so a terminal event
ends *its* `run_uuid` and nothing more. `run.ts` keeps `activeRuns` as a map and
derives `isRunning` from it; cancel names the run
(`…/runs/{run_uuid}/cancel`) and resume names the paused action
(`…/pending/{pending_uuid}/resume`), because there is no longer "the" one of
either. The composer still refuses a second *send* while one is in flight — that
is this screen’s decision, not the API’s.

**Nothing is overwritten.** Regenerating a reply or editing a past question forks
a **sibling**: the original stays reachable through the "n of N" switcher under
the message. `branches.ts` owns that, and the split in where its two numbers come
from is the whole design — N is `sibling_count`, computed only on the history
page; *n* needs `…/siblings`, so it is read lazily and the switcher shows the bare
count until it lands rather than guessing a position.

Regenerate forks **the reply that was pressed**, not the last one: pressing it on
an older reply cuts the transcript below that reply (it belongs to the branch
being left), exactly as an edit cuts below its question. The one exception to
"nothing is overwritten" is **Delete** in the long-press menu — asked once, then
`DELETE …/messages/{uuid}` and a branch-aware re-read, because the server decides
what else goes with the row (`chat/deletion.ts`).

**A generated view is JSX, and the whitelist is ours.** `render_ui` publishes
the model’s answer as JSX *source* on an `ai.artifact.generated` event, and the
backend writes it against AI Elements’ `JSXPreview` — `react-jsx-parser` plus a
`components` map the host supplies. `generative/jsx/` is the same pairing, so a
view that renders on their reference host renders here. Three things are worth
knowing before touching it:

- `jsx/whitelist.ts` **is** the contract — a tag with no entry there does not
  render, and adding a component the backend can draw is one line in that map
  plus the component itself.
- The model’s `className` is **stripped**. Tailwind only emits classes it saw in
  source, so a class written at runtime resolves to nothing; and the model writes
  `text-gray-500` and `bg-white`, which have no dark mode. Our components own
  their look, and plain HTML is styled by the `.ai-artifact` rules in
  `index.css`. Its desktop grids are no loss on a 390px screen.
- A refused node **logs and nothing more**; the fallback card fires only when the
  subtree came out genuinely empty, measured after render. Escalating on the
  first error replaced perfectly good views with "couldn’t be displayed" because
  one `<img>` inside them had been filtered out.

**A thumb is a stored object.** `POST …/messages/{uuid}/feedback` writes the
rating to the message row and then pushes it to Langfuse as a score, so it
survives a reload (`AIMessageRead.feedback_rating`) and a Langfuse outage costs
the score rather than the vote. Pressing the filled thumb sends `rating: null` —
the undo half of a toggle, not a third state. A reply from before the migration
has no trace to score and answers `422` forever, so that case is an informational
toast in those words, never a retry. See
[`docs/message-feedback`](docs/message-feedback/message-feedback.md).

**Thinking and delegation are live-only, in different ways.** `ai.reasoning` is
the model thinking before it answers: it is never stored, so it rides beside the
parts (`AssistantMessage.reasoning`) instead of inside them and is drawn under
the typing dots until the first token lands — a reasoning *part* would be text a
reopened thread could never reproduce, offered for copy and regenerate as if it
were the answer. A delegation is the opposite: the model calls a tool named
`task` (`{ subagent_type, description }`), everything the subagent does inside is
opaque by design, and the call plus its matching `ai.tool_result` — paired on
`tool_call_id` — are the whole lifecycle. So the card is pending → resolved and
nothing waits for progress events that are not coming. `history.ts` redraws it
from the stored `tool_calls`, and a call whose result never arrived settles as
unfinished rather than spinning forever. See
[`docs/thinking-and-delegation`](docs/thinking-and-delegation/thinking-and-delegation.md).

**Parity with the web client.** Standing approvals, rejoining a run after a
reopen, the "Used N tools" line, the task list, the message queue, the Connectors
switches, role-based starters, "Needs attention" and custom-agent chats all follow
the web client in `rooler_apps` — what was ported, from where, and what was
deliberately left out is in
[`docs/web-parity`](docs/web-parity/web-parity.md).

**A send is text or files.** `content` may be empty as long as `file_uuids` is
not; the backend then gives the model a generic "review the attached file(s)"
instruction but stores the empty content verbatim — so an attachment-only turn
renders as an attachment with no caption, and no placeholder text is invented
here either. A send with neither is a `422`, and never leaves the composer.

## Verifying the bundle

The production bundle is loaded from `file://`, so it must reference **nothing**
outside itself — no CDN, no Google Fonts, no separate JS or CSS file. That is
required for offline use, for Play Data Safety, and to keep Apple 2.5.2
uninteresting. `vite-plugin-singlefile` inlines everything, and `npm run sync`
refuses to deliver a build that breaks the rule.

To check by hand:

```bash
npm run build
ls dist                                   # exactly one file: index.html
grep -c 'src="/\|href="http\|fonts.googleapis' dist/index.html   # 0
grep -c 'dev-host\|webchat-dev-panel\|mock-backend' dist/index.html  # 0
```

The last one is the dev harness: `import.meta.env.DEV` is the literal `false` in
a build, so both the dynamic `import('@/dev')` in `main.tsx` and the body of
`startDevHost()` fold away and nothing under `src/dev/` reaches the output.

## Environment

Every variable is documented in [`.env.example`](.env.example). Put your values
in **`.env.local`** — that name is git-ignored, plain `.env` is not, and these
variables can hold a real access token.

`VITE_*` variables are inlined into the bundle at build time. Nothing secret may
ever go into one for a production build: on a device the company, user, thread,
theme, insets and locale arrive over the bridge in `init`, **the token and the
base URL do not arrive at all** — the host performs every request itself — and
none of the `VITE_DEV_*` values are read.

## House rules

- **TypeScript strict**, and `npm run lint` runs with `--max-warnings=0`.
- **UI strings are English.** There is no i18n layer.
- **Both themes, from the first commit.** Check every new surface in light and
  dark with the DEV panel before calling it done.
- **No new runtime dependencies** without a reason that survives the 800 KB
  budget.
- **Never edit anything under `apps/business/.../webchat/protocol.ts`** — it is
  generated from this repo.
