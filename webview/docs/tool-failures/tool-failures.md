# Five tool failures in one workspace, and the field that would let us see them

Русская версия: [tool-failures.ru.md](tool-failures.ru.md).

All four were read out of a single conversation's stored trace on 2026-09-04. None
of them break the assistant — the agent recovers and explains itself to the user
every time — which is exactly why they are invisible in normal use and worth
writing down.

The last section is a contract request rather than a bug: today a failed tool is
indistinguishable from a successful one except by matching English prose, and one
of the four failures below cannot be detected from outside at all.

| # | What | Where |
| --- | --- | --- |
| 1 | `search_emails` fails every single call | `AttributeError: 'EmailContact' object has no attribute 'get'` |
| 2 | Three Metabase cards answer `400` | cards 65, 66, 67 |
| 3 | `driver_detail_cards` reports a work-order cost 12× the other two sources, and the user is shown a −$67k P&L | `work_order_cost: 81469.24` vs `6990` |
| 4 | `get_driver_overview` cannot find a driver whose name has a double space | `'Alex  Boznikov'` |
| 5 | **Human approval never happens** — `GraphInterrupt` is swallowed inside the `task` subagent and returned as a tool error | `Tool 'task' failed: GraphInterrupt: …` |

---

## Environment

| | |
| --- | --- |
| Backend | dev (`api` behind the mobile app) |
| Conversation | `040934db-884f-4fee-a3f2-96b34a3298ef` |
| When | 2026-09-04, rows stamped `13:20:50` – `13:22:47` |
| User | `user_01KRB74HE7ZSW9NWDRJTWK76J5`, company 1 |
| Model | `~deepseek/deepseek-v4-flash-latest` |

Every uuid below is a real row in that conversation's history — the whole trace is
still readable through `GET /ai/conversations/040934db-…/messages/history`.

---

## 1. `search_emails` fails on every call

Three calls in this conversation, three identical failures:

```
Tool 'search_emails' failed: AttributeError: 'EmailContact' object has no attribute 'get'.
Do not retry blindly — consider whether you can answer without it.
```

| Tool call | Args | Result row |
| --- | --- | --- |
| `call_b4020041187541de930545e8` | `{"query": "load", "limit": 10}` | `95c920d0-51b2-41ab-9221-10809ca3cc55` |
| `call_b5a075fd78cd4552bea86bfc` | `{"query": "Boznikov", "limit": 10}` | `d286e916-62d6-4923-80d9-ec297616867c` |
| `call_8c6f55fa1e3b492e8e146c68` | `{"query": "Alex", "limit": 10}` | `59fc88e4-767c-4dd8-b061-c6488d315b0f` |

Different queries, same `AttributeError`, so it looks unconditional rather than
data-dependent: something iterates `EmailContact` objects as if they were dicts.

**User-visible effect.** The assistant told the user twice that it could not read
their inbox — "my email search tool just threw an internal error", and then
"I can't pull his chats right now — the email search tool keeps throwing an
internal error". The feature simply does not work right now, and the only place
that is recorded is the model's own prose.

---

## 2. Three Metabase cards answer `400 Bad Request`

```
Chart 'driver_fuel_usage' failed to run: Client error '400 Bad Request' for url
'https://metabase-rooler.up.railway.app/api/card/67/query'

Chart 'driver_fuel_cost_vs_efficiency' failed to run: Client error '400 Bad Request' for url
'https://metabase-rooler.up.railway.app/api/card/66/query'
```

| Card | Chart key | Reached through | Result row |
| --- | --- | --- | --- |
| 67 | `driver_fuel_usage` | `run_analytics_chart` | `ab3cc225-6c3a-4d7a-ba06-1ecfa555183d` |
| 66 | `driver_fuel_cost_vs_efficiency` | `run_analytics_chart` | `1818d10d-e6ea-4f2e-916b-9818e9196377` |
| 65 | `driver_fuel_cards` | inside `get_driver_overview` | `7ac7317b-2f61-46f1-8891-c6a758e0250e` |

All three are the driver-level **fuel** cards, all three 400, and the parameters
came from the same `run_analytics_chart` call shape that seven other cards
accepted happily in the same turn (`driver_detail_cards`, `driver_weekly_earnings`,
`driver_fleet_expenses`, `driver_safety_cards`, `driver_hr_cards` all returned
data). So it reads as a parameter mismatch on those three cards specifically, not
as a broken caller.

Card 65 is the interesting one: it fails **inside** an otherwise successful tool.
`get_driver_overview` returned `200` with the failure tucked into its payload —

```json
{"period": "last_30_days", "driver": "Alex  Boznikov", …,
 "fuel_error": "driver_fuel_cards failed: Client error '400 Bad Request' for url
                'https://metabase-rooler.up.railway.app/api/card/65/query'"}
```

— which is the case the contract request at the bottom is about.

---

## 3. `driver_detail_cards` reports a work-order cost that contradicts the other two sources

Three tools were asked about the same driver and the same 30-day window
(`2026-08-06` → `2026-09-04`) in one turn. They disagree by a factor of twelve:

| Source | Work-order / fleet expense | Row |
| --- | --- | --- |
| `driver_detail_cards` | **`work_order_cost: 81469.24`** | `62244c6a-d2a4-4850-9932-47590ab74ca2` |
| `driver_fleet_expenses` | 7 orders summing to **`6990`** | `49facafd-06f0-479c-8631-1c0f5c66ad66` |
| `get_driver_overview` | `fleet_expense_total: 6990.0`, `fleet_expense_work_orders: 7` | `7ac7317b-2f61-46f1-8891-c6a758e0250e` |

Two of the three agree exactly. The third is 81 469.24, and because `net` is
computed from it, `driver_detail_cards` returns:

```json
{"trips": 16, "total_revenue": 26466.0, "driver_earnings": 9560.44,
 "work_order_cost": 81469.24, "net": -67127.57886990801}
```

**This reached the user.** The assistant rendered it in a stat card and wrote
"Net P&L: **-$67,128** — dragged down by $81,469 in work-order (maintenance)
costs", under a driver whose actual maintenance in the period was $6,990.

The itemised list from `driver_fleet_expenses` is the whole period: WO-3102
$1,240, WO-3101 $860, WO-001 $0, WO-3103 $0, WO-OWN-001 $1,850, WO-OWN-003
$2,400, WO-OWN-002 $640 — $6,990 exactly, matching `get_driver_overview`.

Our guess, worth checking first: `driver_detail_cards` is summing work orders
**company-wide** rather than filtering by `driver_id`, even though `driver_id` is
declared required for it in `list_analytics_charts`.

---

## 4. `get_driver_overview` cannot find a driver whose stored name has a double space

```
call_6c07f6b8a1f8421bb4f9050f  get_driver_overview {"driver": "Alex Boznikov", "period": "last_30_days"}
  → "No driver named 'Alex Boznikov' in this company."          (row a5709e41-5c2f-420f-90ae-16a57b0e7946)
```

The driver exists. `list_available_drivers`, called immediately afterwards,
returns him as:

```
- Alex  Boznikov — status: covered — (255) 588-8899 (id: 2e64eb09-4924-4503-a7d8-e873d1e35547)
```

— with **two spaces** between the first and last name. The lookup only succeeded
once the model retried with the surname alone (`{"driver": "Boznikov"}`, row
`7ac7317b-…`).

So the name match is exact rather than whitespace-normalised. The cost of that is
not just the failed call: recovering from it made the agent pull the entire driver
list, a 4.7 KB tool result, into the context, and it only worked because the model
happened to guess a shorter query. A user asking about any driver whose record has
a stray double space gets "no such driver".

Normalising whitespace (and case) on both sides of the comparison would fix it.

---

## 5. Human approval never happens: `GraphInterrupt` is swallowed inside `task`

This one is the most consequential of the five: **the approval (HITL) flow does not
run at all for anything reached through a subagent.** No pause, no pending row, no
event, nothing to approve.

Conversation `0a947d85-5334-4491-ba1a-c0e7dca4bc16`, two attempts twenty minutes
apart, both identical. The stored tool result:

```
Tool 'task' failed: GraphInterrupt: (Interrupt(value={'action_requests': [{'name': 'execute',
'args': {'command': 'pwd && ls -la && python3 --version'},
'description': "Tool execution requires approval\n\nTool: execute\nArgs: {'command': '…'}"}],
'review_configs': [{'action_name': 'execute',
'allowed_decisions': ['approve', 'edit', 'reject', 'respond']}]},
id='f56c438ad28bc213d594dc9cadcc09ed'),). Do not retry blindly — consider whether you
can answer without it.
```

| Attempt | `task` call | Result row | Interrupt id |
| --- | --- | --- | --- |
| 1 (13:51) | `call_7525f60a386547c2a1da245a` | `c47eab02-d528-4288-8e0f-ba59620add8a` | `f56c438ad28bc213d594dc9cadcc09ed` |
| 2 (14:11) | `call_cde0a645518149f8ba6280a9` | `d0920d87-4bc2-4331-b2ef-ce72f05a0b09` | `febfea52014c24630cf2806c6068edba` |

The user asked for an XLSX report. The model delegated to the `code-runner`
subagent through `task`; inside it `execute` is gated, LangGraph raised
`GraphInterrupt` to suspend the graph — and that interrupt was **caught and
serialised into a tool-error string** instead of propagating to the parent graph.

What follows, in order:

1. the run never suspends, so no `AIPendingAction` row is created;
2. no `ai.action.pending` is published — we can state that positively: our client
   logs that event by name (`ai.action.pending — run paused for human approval`),
   and it appears nowhere in a capture that contains both attempts;
3. there is therefore nothing to approve. `GET .../pending` would answer an empty
   list, and `resume` has no `pending_uuid` to name;
4. the model reads the failure text and tells the user *"the run keeps getting
   interrupted before it can execute… approve the sandbox run if you see a pending
   approval prompt"* — a prompt that cannot exist. The user is asked to do
   something impossible.

`GraphInterrupt` is LangGraph **control flow, not an error**: it has to travel up
to the outermost graph so the checkpointer can persist the paused state. Wherever
the `task` / subagent wrapper catches exceptions to turn them into a tool result,
it must let `GraphInterrupt` (and `ParentCommand`) through untouched — and the
child graph needs a checkpointer of its own, or there is nothing to resume into.

### The same bug has a second, worse shape: the run goes silent

Conversation `d5d653e2-072b-4442-b4a7-369691ecc1d6`, run
`54f8da83-7945-4a53-aee6-3db4e5c5e7da`, 2026-09-04 14:26 server time. Same request
(an XLSX report), same delegation to `code-runner`, and this time nothing came
back at all:

```
seq 2   ai.tool_call    list_analytics_charts      → ai.tool_result seq 3   ok
seq 4   ai.tool_call    get_company_overview       → ai.tool_result seq 5   ok
seq 6   ai.tool_call    run_analytics_chart        → ai.tool_result seq 7   ok
seq 8-9 ai.token        "I have the driver P&L data for last month (Aug 1–31, 2026).
                         Building the XLSX now."
seq 10  ai.tool_call    task
        …then nothing. No tool_result, no ai.action.pending, no terminal event.
```

Sixty seconds later our own watchdog ended the stream client-side. The run
published **no terminal event** — not `ai.run.completed`, not `ai.run.error`, not
`ai.run.cancelled` — so as far as the contract goes that run is still open.

Worse, **nothing was persisted**. Reopening the conversation a minute later returns
7 rows ending with the user's own message:

```
user      05eada71  "Gimme me report xlsx"
assistant 85a1d41e  "What report would you like? …"
user      99973789  "Driver report"
assistant f66540af  (tool_calls: list_available_drivers)
tool      67c60e76  tool_result:list_available_drivers
assistant 272198a8  "Which driver would you like the report for? …"
user      20d5bde8  "Gimme in xlsx"        ← last row; nothing after it
```

The three successful tool calls, their results and the 82 characters the model had
already written are all gone. The user's question sits there unanswered, and the
only record that anything happened is the client's log.

Reproduced twice more the same day in the same conversation — runs
`4d08af72-7de6-46f8-8ad0-7c1eb5825a69` (13:40) and
`c9227f6f-a335-4450-b663-f03bac91db35` (13:42) — and by then it was down to
`ai.token` ×29 characters, one `ai.tool_call task` at seq 4, then silence. No tool
result at all, not even the `GraphInterrupt` string. One `task` call is enough.

So the same `task`/`GraphInterrupt` path fails in two ways: sometimes the
interrupt comes back as a tool-error string (above), sometimes the run simply
stops publishing and leaves no trace. Both need the interrupt to reach the parent
graph; the second additionally means a run can end without a terminal event, which
the streaming contract says cannot happen.

**Scope.** Everything gated that lives behind a subagent: `execute`, `write_file`,
`edit_file`, `deliver_file` — i.e. the whole `code-runner` path, which is files,
spreadsheets and code execution. This capture says nothing about top-level gated
tools (`send_email`, `place_call`), so those may still pause correctly; the same
test would settle it in a minute.

**Nothing on the client can compensate.** We are not missing an event — the event
is never sent. (Separately, we do not yet call `GET .../pending`, which is our own
gap for approvals raised while the screen was closed; it is unrelated to this one
and would not have helped here.)

---

## The contract request: a real failure flag on a tool result

Everything above is currently detectable by the client only by reading English
prose. `app/ai/tools/…` returns failures as ordinary `ai.tool_result` content, and
your own note in `ui.py`'s neighbourhood already calls this a known gap. Three
concrete consequences we hit:

1. **The formats differ.** `Tool 'search_emails' failed: …` and
   `Chart 'driver_fuel_usage' failed to run: …` do not share a prefix, so a client
   heuristic written against one silently misses the other. Ours did exactly that:
   all three Metabase 400s passed through our telemetry unflagged.
2. **A failure inside a success is invisible.** `get_driver_overview` above
   returned `200` with `fuel_error` inside its JSON. Nothing outside the backend
   can know that a third of that card's data is missing.
3. **An empty result is not a failure, and we cannot tell them apart.**
   `"No driver named 'Alex Boznikov' in this company."` is a perfectly good answer
   — it happens to be wrong here (§4), but it is not an error. Any string-matching
   rule that catches §1 and §2 risks catching this one too.

What would settle it — a flag alongside the content, on both the `ai.tool_result`
event and the stored tool row:

```json
{
  "event_type": "ai.tool_result",
  "data": {
    "tool": "run_analytics_chart",
    "tool_call_id": "call_…",
    "ok": false,
    "error": { "kind": "upstream_http", "status": 400, "message": "…" },
    "content": "Chart 'driver_fuel_usage' failed to run: …"
  }
}
```

`content` can stay exactly as it is — the model reads it and that works. `ok` is
for everyone else. A `partial` marker (or an `errors: []` list) would additionally
cover case 2, where the call succeeded and part of the data did not.

### What the client does with failures today

For context, so the flag is not read as a request for new UI:

- **Nothing is shown to the user.** A failed tool is not a failed run, and the
  agent already explains itself in prose — far better than a banner could. We
  surface an error only when a run finishes having produced no content at all.
- **Raw tool content never reaches the screen.** It is context for the model; we
  drop it while rebuilding the transcript.
- **We log it, and that is the whole point of the flag.** We are the only party
  that sees these results in normal operation and could say "two of nine charts
  failed for this user today".

---

## Minor, from the same capture

- `GET /api/v1/ai/models` answers
  `{"default": "~deepseek/deepseek-v4-flash-latest", "allowed": [], "options": [{…one model…}]}`
  — `allowed` is empty while `options` is not. Harmless for us (we read
  `options`), but the two disagree.
- Timestamps on one conversation are in two different zones:
  `created_at: 2026-09-04T13:20:50`, `updated_at: 2026-09-04T13:50:01`, but
  `last_message_at: 2026-09-04T06:50:38` — exactly seven hours apart. The message
  rows agree with `created_at`, not with `last_message_at`.
