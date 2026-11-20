# Parity with the web client's AI chat

Русская версия: [web-parity.ru.md](web-parity.ru.md).

The same assistant has a chat in the web app (`rooler_apps`,
`apps/web/widgets/deep-agent-chat`). On 2026-10-23 this screen was brought up to
it. This page records what was ported, where each rule comes from, and what was
left out on purpose. Read it before changing any of these: the two clients are
meant to answer the same person the same way.

The web client's own guide is `docs/guides/deep-agent-api.md` in `rooler_apps`. It
is the most precise description of the backend contract both clients use.

## What came across

| Feature | Here | Web source |
| --- | --- | --- |
| "Always allow" / "Allow for this session" on the approval card, and the card saying what was **recorded** (`allowed`) rather than what was pressed | `chat/allow.ts`, `generative/PendingActionCard.tsx` | `lib/allow-choices.ts`, `features/deep-agent/lib/allow-options.ts` |
| "Ran automatically: …" (`ai.action.auto_approved`) | `generative/AutoApprovedChip.tsx` | `ui/auto-approved-chip.tsx` |
| Rejoining a run after a reopen: `GET …/runs` + `GET …/pending`, a 10 s recheck, and freeing a stranded `resolving` row | `chat/run.ts` → `recoverRuns` | `realtime/use-restore-conversation-runs.ts` |
| One "Used N tools" line per reply, a card per call, and app calls named "Google Calendar · List events" | `chat/toolCalls.ts`, `ui/chat/ToolCallsGroup.tsx` | `ui/tool-calls-group.tsx`, `ui/tool-call-card.tsx`, `lib/connected-app-tool.ts`, `lib/persisted-tool-calls.ts` |
| The task list (`ai.todos`, `write_todos` from history) | `ui/chat/TodoList.tsx` | `ui/todo-list.tsx`, `lib/todos.ts` |
| Queueing a message written while a reply runs, with "Send now" and "Remove" | `chat/queue.ts`, `ui/chat/QueuedMessages.tsx` | `lib/queued-messages.ts`, `ui/queued-messages-list.tsx` |
| Connectors switches (`disabled_connectors`) in the "+" sheet | `chat/connectors.ts`, `ui/composer/ConnectorsPanel.tsx` | `ui/composer-plus-menu.tsx`, `lib/use-chat-connectors.ts` |
| Four starter chips chosen by role and permissions | `chat/starters.ts`, `chat/access.ts` | `lib/chat-starters.ts` (+ `docs/guides/ai-chat-starters.md`) |
| "Needs attention" (`GET /ai/attention`) | `chat/attention.ts`, `ui/chat/EmptyThread.tsx` | `ui/needs-attention.tsx` |
| A custom agent's chat: its name, no starters, no voice | `ChatState.agent`, `EmptyThread`, `ChatScreen` | `docs/guides/ai-agents.md` |

## Rules worth knowing before touching them

**A standing approval is offered only when every tool on the card accepts it.**
The card's tools are the keys of `allow_options`, not the names on its rows: a
connected-app row names the inner action, and the key is the tool the backend
records the approval against. The native screen uses the same rule
(`toolPermissions.utils.ts`).

**A joined run follows its conversation when it has no uuid.** A run paused on an
approval is not always in `GET …/runs`, and `GET …/pending` carries no run uuid.
So a restored card's stream adopts whichever run of that conversation speaks next.
After the decision, that is the `ai.run.resumed` of the run being waited on
(`StreamJoinOptions` in `realtime/aiEvents.ts`).

**A joined run only ever sees the tail of its reply.** When it ends, history is
re-read, but only once it contains the reply's own uuid from `ai.run.completed`.
Until then it is re-read a few times, and after that what streamed is left on
screen. A blind replacement could swap the answer the user just watched for a
thread that ends at their question.

**A tool call is not a part.** The "Used N tools" line and the task list ride
beside the parts, like the thinking. They sit above the reply as a whole. Three
calls are never cards, because they draw something of their own: `render_ui` (the
view), `task` (the delegation card) and `write_todos` (the task list).

**A failed tool result is recognised by its shape, never by a flag.** There is no
flag on the wire. `Tool 'x' failed: …`, `Chart 'x' failed to run: …` and
`{error}` / `{is_error: true}` are the three shapes recognised. The first two
share no prefix (`backend-issues` §8), so a check written for one silently misses
the other. The result decides the chip on a card, and nothing more.

**A message written mid-reply waits.** Sending it would hang it off the same
parent as the reply in progress and fork the conversation. So it waits, in memory,
for the current thread only. "Send now" stops the reply and waits a second before
sending: a run started the instant another is cancelled can hang on the backend.
On a phone, Enter is a newline, so a Send button sits beside Stop while a reply
runs and something is drafted.

**Connectors are one switch per app, and the whole list is PATCHed.** In a new
chat the list waits for the first message (`disabled_connectors` on
`POST /ai/messages`). The last choice is remembered under the web client's
`localStorage` key. "Add / Manage connectors" opens the host's Integrations sheet
(`open.integrations`), because connecting an app is an OAuth flow in the system
browser.

**Role and permissions come from `GET /auth/me/context`**, the membership of the
company in `init`. If that read fails, every chip stays visible, which is the web
client's rule while auth is resolving.

## Left out on purpose

- **Raw recharts in generated views.** The web whitelist also lets `AreaChart`,
  `XAxis`, `ResponsiveContainer` and the other recharts primitives through, plus
  `StatTrendCard`. Those serve artifacts from the shadcn MCP server
  (`source_tool: "shadcn"`), not `render_ui`. The vocabulary the backend published
  for `render_ui` is the flat `BarChart` / `LineChart` / `PieChart`
  (`{title, unit, data}`) this app already draws, and recharts would add hundreds
  of KB to a bundle that is already over budget.
- **Thinking only in debug.** The web client shows `ai.reasoning` only with
  `?debug=true`. Here it stays under the typing dots for everyone, as it was.
- **Starting a chat with a custom agent.** The app has no agents screen to start
  one from. Opening a conversation that already has an agent works.
- **The voice settings and the dictation button** belong to the native voice
  screen, not to this page.
- **Things the web client does not have either:** a tool-permissions screen (the
  native app has one), the scheduled-agent inbox, renaming a conversation and
  loading older history pages.

## Checking it

Everything above has a slash command in the mock backend (see the README) and was
run against it in a headless Chrome at 390×844, in both themes. It has not been
run on a device or against the real backend yet.
