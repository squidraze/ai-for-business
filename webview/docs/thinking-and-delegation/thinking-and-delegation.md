# Thinking and delegation: two events that used to be dead on the wire

Русская версия: [thinking-and-delegation.ru.md](thinking-and-delegation.ru.md).

On **2026-09-05** the backend turned on two things the streaming contract had
always described but never sent:

- **`ai.reasoning`** now fires on any text turn (never on voice — reasoning costs
  latency a live call cannot afford).
- **`ai.tool_call.args`** now carries the model's real, complete arguments
  (it was always `null` before), and the event also carries **`tool_call_id`**,
  the same field `ai.tool_result` has — so a call can be paired with its own
  result instead of matched by tool name.

Both are implemented here. This is what they mean for the screen, and what was
deliberately *not* done.

---

## 1. Thinking (`ai.reasoning`)

Some models write out a plan before they answer. When they do, the deltas arrive
on their own stream, batched like `ai.token`, **before the first `ai.token`** and
never interleaved after text has started. Not every turn has them — a model or a
turn that does not think simply never emits one, so nothing may wait for a first
delta.

**It is live-only, and that is the whole design constraint.** The backend stores
none of it: `ai.run.completed.content` never includes it and no endpoint returns
it afterwards. So:

| Decision                                             | Why                                                                                                                       |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Carried on `AiRunChunk.reasoning`, **not** as a part | A `MessagePart` is content: it would be copied, regenerated, folded into history — and then vanish on the next thread open |
| Lives on `AssistantMessage.reasoning`                | Beside the turn, so nothing that walks `parts` can pick it up by accident                                                 |
| Drawn only while the turn has no text yet            | The contract's own rule: switch to the answer view on the first `ai.token`                                                |
| Only the tail is shown, two lines, faded at the top  | Thinking runs to paragraphs and it is not the answer                                                                      |

`ThinkingTrace` is the component; `AssistantMessage` mounts it under the typing
dots and both leave together on the first token.

## 2. Delegation (the `task` tool)

The model does not "spawn a subagent" on the wire — it calls a tool literally
named `task`, with arguments `{ subagent_type, description }`:

```jsonc
{ "event_type": "ai.tool_call", "run_uuid": "…", "seq": 4,
  "data": { "tool": "task", "tool_call_id": "call_…",
            "args": { "subagent_type": "code-runner",
                      "description": "Build an xlsx report of August work orders" } } }
```

That is drawn as a card the moment it arrives, and resolved on the matching
`ai.tool_result` — paired on `tool_call_id`, falling back to arrival order when a
result carries none.

**There is nothing in between, by design.** What the subagent does internally —
running code, reading and writing files — is opaque to this channel. So the card
is a single pending → resolved state, never a progress list: building it as steps
would leave a permanently half-finished checklist on screen.

Three states, because there are only ever two events plus the run ending:

| State     | When                                                                            |
| --------- | -------------------------------------------------------------------------------- |
| `running` | the call arrived; nothing has answered it yet                                    |
| `done`    | its `ai.tool_result` arrived and does not read as a failure                      |
| `failed`  | the result reads as a failure, **or** the stream ended without one ever arriving |

That last case is not hypothetical: a `task` call that hangs and takes the whole
run with it is a live backend bug (see
[backend-issues §2](../backend-issues/backend-issues.md)), and a card left
spinning would claim a subagent is still working when nothing is listening any
more. `streamAiRun` settles every open delegation when the stream ends —
`done` if the run completed, `failed` if it errored, stalled or was stopped.

**A reopened thread redraws it.** The call is stored on the assistant row's
`tool_calls` (OpenAI shape: `{ id, function: { name, arguments } }`, arguments as
a JSON string) and its answer is a separate `tool` row. `toTranscript` reads both
— a pre-pass indexes the results, because the answer row comes after the call it
belongs to — so the wait that shaped the turn survives a reload. A delegation with
**no** stored result comes back as `failed`, for the same reason as above.

Everything *other* than `task` and `render_ui` is still not drawn: those calls are
the model fetching context, and committing a part for each one is what used to put
an invisible block in the turn and warn "unknown generative-UI tool" on every
render.

## 3. What deliberately did not change

- **The Excel offer.** After presenting data that would naturally be a
  spreadsheet, the model now offers an export in its own words instead of building
  one unasked. That is ordinary reply text on `ai.token` — no new event, no client
  work, and nothing here treats it specially.
- **`ai.step`** is still reserved and still not emitted. No handler was added for
  an event that does not exist.
- **`args` stays optional.** A call whose argument stream was truncated still
  fires with `args: null`, so every read of it is defensive.

## 4. Checking it

With no backend at all — `npm run dev`, then in the composer:

| Type       | Expect                                                                                                          |
| ---------- | ----------------------------------------------------------------------------------------------------------------- |
| `/think`   | dots, thinking text scrolling under them, both replaced by the answer on the first token                        |
| `/task`    | a short thought, a line of text, a **Delegating to code-runner** card that spins ~1.8s and then reads **Done**   |
| `/task hang` | the same card, still spinning — after the 60s watchdog it settles to **Didn't finish** and the turn is marked interrupted |

Then reopen the thread from the DEV panel: the delegation card comes back
resolved, and the thinking does not come back at all. Both are correct.

Against the real backend, the log lines to read are `ai.tool_call — delegating to
a subagent`, `a delegation came back` (which says whether it paired on
`tool_call_id` or on arrival order), and `run stream ended`, whose
`reasoningChars` and `unresolvedDelegations` say what the turn actually received.
