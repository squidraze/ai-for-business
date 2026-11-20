# What is wrong on the backend, as seen from the mobile AI chat

Русская версия: [backend-issues.ru.md](backend-issues.ru.md).

Everything here was read out of stored conversation traces and live event streams
on 2026-09-03 / 2026-09-04, against the dev backend, from the business app's AI
chat. Nothing is inferred from behaviour alone — every item names the conversation,
the row uuids and the exact payload it came from.

Two of the items are blockers: the approval system never runs, and a run can
vanish taking a whole turn with it. The rest are ordinary bugs, plus two contract
requests that would let the client see failures instead of guessing at them.

| # | Issue | Severity | Detail |
| --- | --- | --- | --- |
| 1 | Human approval (HITL) never happens — `GraphInterrupt` is swallowed inside `task` | **Blocker** | [tool-failures §5](../tool-failures/tool-failures.md) |
| 2 | A run can end with no terminal event and persist nothing — the whole turn is lost | **Blocker** | [tool-failures §5](../tool-failures/tool-failures.md) |
| 3 | `search_emails` fails on every call | High | [tool-failures §1](../tool-failures/tool-failures.md) |
| 4 | Three Metabase cards answer `400` | High | [tool-failures §2](../tool-failures/tool-failures.md) |
| 5 | `driver_detail_cards` reports a 12× wrong work-order cost; the user is shown a false −$67k P&L | High | [tool-failures §3](../tool-failures/tool-failures.md) |
| 6 | Driver lookup is whitespace-exact — `'Alex  Boznikov'` is unfindable | Medium | [tool-failures §4](../tool-failures/tool-failures.md) |
| 7 | `select-branch` did not descend to the branch tip | Fixed? | [select-branch-leaf](../select-branch-leaf/select-branch-leaf.md) |
| 8 | No failure flag on a tool result | Contract | [tool-failures](../tool-failures/tool-failures.md) |
| 9 | No field grouping the rows of one assistant turn | Contract | below |
| 10 | Attachments come back with `download_url` **and** `file_uuid` null | High | [attachment-no-url](../attachment-no-url/attachment-no-url.md) |
| 11 | A sibling group mixes roles — `/siblings` returns a user message and an assistant message as versions of each other | Medium | below |
| 12 | `/ai/models` `allowed: []`; timestamps in two timezones | Minor | below |

---

## 1. Approvals never happen — blocker

`POST` an XLSX request, the model delegates to the `code-runner` subagent through
`task`, `execute` inside it is gated, LangGraph raises `GraphInterrupt` to suspend
the graph — and the interrupt is **caught and serialised into a tool-error
string** instead of propagating to the parent graph:

```
Tool 'task' failed: GraphInterrupt: (Interrupt(value={'action_requests': [{'name': 'execute',
'args': {'command': 'pwd && ls -la && python3 --version'}, …}],
'review_configs': [{'action_name': 'execute',
'allowed_decisions': ['approve', 'edit', 'reject', 'respond']}]},
id='f56c438ad28bc213d594dc9cadcc09ed'),). Do not retry blindly — …
```

So: no pause, no `AIPendingAction` row, no `ai.action.pending` event, nothing to
approve. `GET .../pending` would return an empty list and `resume` has no uuid to
name. The model then tells the user "approve the sandbox run if you see a pending
approval prompt" — a prompt that cannot exist.

`GraphInterrupt` is LangGraph control flow, not an error. It must reach the
outermost graph so the checkpointer can persist the paused state; the `task` /
subagent wrapper has to let it (and `ParentCommand`) through untouched, and the
child graph needs a checkpointer of its own.

**Scope:** everything gated behind a subagent — `execute`, `write_file`,
`edit_file`, `deliver_file`, i.e. the entire `code-runner` path: files,
spreadsheets, code execution. Top-level gated tools (`send_email`, `place_call`)
were not exercised in these captures.

Conversation `0a947d85-5334-4491-ba1a-c0e7dca4bc16`, rows
`c47eab02-d528-4288-8e0f-ba59620add8a` and `d0920d87-4bc2-4331-b2ef-ce72f05a0b09`.

## 2. A run can end with no terminal event and lose the whole turn — blocker

Same request, different day, and this time nothing came back at all. Run
`54f8da83-7945-4a53-aee6-3db4e5c5e7da` in conversation
`d5d653e2-072b-4442-b4a7-369691ecc1d6`:

```
seq 2   ai.tool_call  list_analytics_charts  → result seq 3   ok
seq 4   ai.tool_call  get_company_overview   → result seq 5   ok
seq 6   ai.tool_call  run_analytics_chart    → result seq 7   ok
seq 8-9 ai.token      "I have the driver P&L data … Building the XLSX now."
seq 10  ai.tool_call  task
        … silence
```

No `tool_result`, no `ai.action.pending`, and **no terminal event** — not
`ai.run.completed`, not `.error`, not `.cancelled`. By the streaming contract that
run is still open; the client only escaped through its own 60-second watchdog.

Then the turn was **not persisted**. Reopening the conversation a minute later
returns 7 rows ending at the user's own message:

```
user 20d5bde8 "Gimme in xlsx"   ← last row, nothing after it
```

Three successful tool calls, their results and the 82 characters the model had
already written are gone. Tokens were spent, data was fetched, and there is no
record of any of it outside the client's log.

**Reproduced twice more the same day**, in the same conversation, and by then the
pattern had shrunk to its minimum — runs `4d08af72-7de6-46f8-8ad0-7c1eb5825a69`
(13:40) and `c9227f6f-a335-4450-b663-f03bac91db35` (13:42):

```
seq 1-3  ai.token      (29 characters)
seq 4    ai.tool_call  task
         … silence, then our 60-second watchdog
```

No tool result at all this time — not even the `GraphInterrupt` string from §1.
One `task` call is now enough to hang a run outright, and each attempt leaves
another run open server-side with no terminal event.

Two separate guarantees are broken here: every run must publish exactly one
terminal event, and work that reached the user must survive in history.

## 3. `search_emails` fails on every call

Three calls with three different queries, one identical failure:

```
Tool 'search_emails' failed: AttributeError: 'EmailContact' object has no attribute 'get'.
```

Unconditional rather than data-dependent — something iterates `EmailContact`
objects as if they were dicts. The assistant told the user twice that it could not
read their inbox. Conversation `040934db-884f-4fee-a3f2-96b34a3298ef`, rows
`95c920d0-…`, `d286e916-…`, `59fc88e4-…`.

## 4. Three Metabase cards answer `400 Bad Request`

| Card | Chart key | Reached through |
| --- | --- | --- |
| 67 | `driver_fuel_usage` | `run_analytics_chart` |
| 66 | `driver_fuel_cost_vs_efficiency` | `run_analytics_chart` |
| 65 | `driver_fuel_cards` | inside `get_driver_overview` |

All three are the driver-level fuel cards; seven other cards accepted the same
call shape in the same turn and returned data. Card 65 fails **inside** a
successful tool — `get_driver_overview` returns `200` with the failure tucked into
`fuel_error` in its payload, which is invisible from outside (see §8).

## 5. `driver_detail_cards` contradicts the other two sources, and the user sees it

One driver, one 30-day window, three tools, a factor of twelve between them:

| Source | Work-order / fleet expense |
| --- | --- |
| `driver_detail_cards` | **`work_order_cost: 81469.24`** |
| `driver_fleet_expenses` | 7 orders summing to **`6990`** |
| `get_driver_overview` | `fleet_expense_total: 6990.0`, 7 work orders |

`net` is computed from the wrong figure, so the card returns
`net: -67127.57886990801` — and the assistant rendered it as a headline stat:
"Net P&L: **-$67,128** — dragged down by $81,469 in work-order costs", for a
driver whose maintenance in the period was $6,990.

Likely cause worth checking first: the card sums work orders company-wide instead
of filtering by `driver_id`, which `list_analytics_charts` declares required for it.

## 6. Driver lookup is whitespace-exact

`get_driver_overview {"driver": "Alex Boznikov"}` → `"No driver named 'Alex
Boznikov' in this company."` The driver exists; `list_available_drivers` returns
him as `Alex  Boznikov` — **two spaces**. The lookup only succeeded when the model
retried with the surname alone.

Recovering from it cost a 4.7 KB `list_available_drivers` round-trip pulled into
the context, and it worked only because the model happened to guess a shorter
query. Normalising whitespace (and case) on both sides fixes it.

## 7. `select-branch` did not descend to the branch tip — appears fixed

Reported separately in [select-branch-leaf](../select-branch-leaf/select-branch-leaf.md):
switching back to a previous version of a question returned the question with no
reply under it, because the active leaf was parked on the selected message instead
of the deepest descendant of that branch.

The live spec on dev now documents the corrected behaviour ("moves the active leaf
to the TIP of that branch … see `message_q.get_deepest_descendant`"), so this looks
fixed. It has not been re-tested from the app yet — worth one confirmation run.

---

## 8. Contract: a tool result needs a real failure flag

Failures come back as ordinary `ai.tool_result` content, so the client can only
recognise them by matching English prose. Three concrete consequences:

1. **The formats differ.** `Tool 'search_emails' failed: …` and
   `Chart 'driver_fuel_usage' failed to run: …` share no prefix. A heuristic
   written for one silently misses the other — ours did, and all three Metabase
   400s passed through our telemetry unflagged.
2. **A failure inside a success is invisible.** `get_driver_overview` returns `200`
   with `fuel_error` inside its JSON (§4). Nothing outside the backend can know a
   third of that card's data is missing.
3. **An empty result is not a failure and cannot be told apart.** "No driver named
   'Alex Boznikov' in this company." is a legitimate answer, and any string rule
   that catches the two cases above risks catching it too.

Proposed, on both the event and the stored row:

```json
{ "tool": "run_analytics_chart", "tool_call_id": "call_…",
  "ok": false,
  "error": { "kind": "upstream_http", "status": 400, "message": "…" },
  "content": "Chart 'driver_fuel_usage' failed to run: …" }
```

`content` stays as it is — the model reads it and that works. `ok` is for
everyone else. A `partial` marker (or `errors: []`) would additionally cover case 2.

## 9. Contract: history rows carry nothing that groups one turn

`AIMessageRead` is `uuid, role, content, tool_calls, tool_call_id, name,
created_at, attachments, sibling_count` — there is no parent, no `run_uuid`, no
turn id.

A single answer is stored as several assistant rows: the model speaks between its
tool calls ("Got it, pulling the charts…", then the calls, then "here's the
dashboard:", then more calls, then the summary), and each of those is its own row.
The live stream shows one bubble for all of it. Rebuilding the transcript row by
row therefore split finished answers into two or three the moment a thread was
reopened.

We now merge consecutive assistant rows **positionally** — only a user row ends a
turn — which works, but it is inference. A `run_uuid` (or a parent pointer) on the
history rows would make it exact. `created_at` is currently identical across the
rows of one turn, which is a useful hint but not a documented guarantee.

One consequence worth knowing: `sibling_count` sits on the **first** row of a turn
— often the content-less tool-call announcement — so a client that drops empty rows
loses the branch switcher entirely. We key the merged bubble on that first row's
uuid for exactly this reason.

## 11. A sibling group mixes roles

`GET /ai/conversations/{uuid}/messages/{message_uuid}/siblings` answers with a
group that contains **a user message and an assistant message** as alternates of
one another. Five such groups in one conversation
(`d5d653e2-072b-4442-b4a7-369691ecc1d6`, read 2026-09-04 18:18):

```
messageUuid ..fd508fd8  position 1 of 2  roles ["user", "assistant"]  siblings [..fd508fd8, ..87d31f94]
messageUuid ..e8f24eda  position 1 of 2  roles ["user", "assistant"]  siblings [..e8f24eda, ..374bea38]
messageUuid ..51c26238  position 1 of 2  roles ["user", "assistant"]  siblings [..51c26238, ..3ab61870]
messageUuid ..230d8bd4  position 2 of 2  roles ["user", "assistant"]  siblings [..efa94933, ..230d8bd4]
messageUuid ..00215a96  position 2 of 2  roles ["user", "assistant"]  siblings [..1f596bef, ..00215a96]
```

A sibling group is "the versions of one turn", so every member should share a
role: alternates of a question, or alternates of an answer. Mixing them means the
"1 of 2 / 2 of 2" switcher under a question offers to replace it with an answer —
pressing it would swap a user turn for an assistant turn in place.

The same conversation also has one correctly-formed group
(`roles: ["user", "user"]`), so this is not the general case — something is
grouping across the fork boundary in specific circumstances.

## 12. Minor

- `GET /api/v1/ai/models` answers
  `{"default": "~deepseek/…", "allowed": [], "options": [{…one model…}]}` —
  `allowed` is empty while `options` is not. We read `options`, so it is harmless,
  but the two disagree.
- Timestamps on one conversation are in two zones:
  `created_at: 2026-09-04T14:24:42`, `updated_at: 2026-09-04T14:26:31`, but
  `last_message_at: 2026-09-04T07:26:31` — exactly seven hours apart, and the
  message rows agree with `created_at`.

---

## How this was captured

The app's web chat logs every payload it receives verbatim in a debug build, and
forwards those lines to the native logger. Each item above cites the conversation
uuid and the row uuids, so the whole trace is re-readable through
`GET /ai/conversations/{uuid}/messages/history`.

Conversations referenced: `0a947d85-5334-4491-ba1a-c0e7dca4bc16`,
`d5d653e2-072b-4442-b4a7-369691ecc1d6`, `040934db-884f-4fee-a3f2-96b34a3298ef`,
`1772bfae-939d-45e9-b70e-86e553421d96`, `0515640a-00ba-44eb-b770-4ef567d84943`.
