# A file the assistant builds never arrives — where the chain breaks, and how it should reach the chat

Русская версия: [file-delivery.ru.md](file-delivery.ru.md).

A user asks for a report as an `.xlsx`. Nothing arrives, three attempts in a row,
across two days. This document is two things:

1. **Where it breaks today** — a backend blocker, reproduced five times. The chain
   dies at the *first* gated command inside the subagent, so the file is never
   built, let alone delivered.
2. **An open contract question** — even once it is built, nothing says how a file
   reaches the chat. The client cannot render what it has no contract for, and we
   would rather implement the shape you intend than guess.

Nothing in part 1 is fixable from the client: the event we would have to react to
is never published.

---

## Part 1 — the chain, and where it dies

```
user: "Gimme report in xlsx"
  └─ task(subagent_type: code-runner)          ← delegation
       ├─ execute("pwd && ls -la && python3 --version")   ← GATE #1 — dies here
       ├─ (openpyxl builds the .xlsx)                      ← never reached
       └─ deliver_file(...)                                ← GATE #2 — never reached
```

The very first thing the sandbox subagent does is a trivial `execute` — a
`pwd`/`ls`/`python3 --version` probe. `execute` is gated, and that is where every
attempt ends. `deliver_file` is two steps further down and is never called, so the
"file delivery" feature has never actually run.

**Gating is not the problem.** Default-deny on `execute` / `write_file` /
`deliver_file` is deliberate and correct — a durable, company-visible artefact
should need a human. The problem is that the gate cannot be satisfied: no approval
is ever raised.

### Observed shape A — the interrupt comes back as a tool error

Conversation `0a947d85-5334-4491-ba1a-c0e7dca4bc16`, two attempts (13:51 and
14:11 on 2026-09-04), rows `c47eab02-d528-4288-8e0f-ba59620add8a` and
`d0920d87-4bc2-4331-b2ef-ce72f05a0b09`:

```
Tool 'task' failed: GraphInterrupt: (Interrupt(value={'action_requests': [{'name': 'execute',
'args': {'command': 'pwd && ls -la && python3 --version'},
'description': "Tool execution requires approval\n\nTool: execute\nArgs: {…}"}],
'review_configs': [{'action_name': 'execute',
'allowed_decisions': ['approve', 'edit', 'reject', 'respond']}]},
id='f56c438ad28bc213d594dc9cadcc09ed'),). Do not retry blindly — …
```

`GraphInterrupt` is LangGraph **control flow, not an error**. It was caught inside
the `task` wrapper and serialised into a tool-result string instead of propagating
to the parent graph. Consequences, in order: the run never suspends → no
`AIPendingAction` row → no `ai.action.pending` event → nothing to approve.
`GET .../pending` would answer an empty list and `resume` has no `pending_uuid` to
name.

The model then reads its own failure text and tells the user *"approve the sandbox
run if you see a pending approval prompt"* — a prompt that cannot exist.

### Observed shape B — the run goes silent and loses the turn

Conversation `d5d653e2-072b-4442-b4a7-369691ecc1d6`, three runs:
`54f8da83-7945-4a53-aee6-3db4e5c5e7da` (12:26),
`4d08af72-7de6-46f8-8ad0-7c1eb5825a69` (13:40),
`c9227f6f-a335-4450-b663-f03bac91db35` (13:42). By the last two it was down to the
minimum:

```
seq 1-3  ai.token      (29 characters of "…building the XLSX now")
seq 4    ai.tool_call  task
         … silence
```

No tool result at all — not even the `GraphInterrupt` string from shape A. **No
terminal event either**: not `ai.run.completed`, not `.error`, not `.cancelled`.
By the streaming contract that run is still open; the client only escapes through
its own 60-second watchdog.

And the turn is **not persisted**. Reopening the conversation returns rows ending
at the user's own message — in run `54f8da83` that cost three successful tool
calls, their results, and the 82 characters the model had already written. Tokens
spent, data fetched, no record of any of it outside the client's log.

### What has to change

- **Let `GraphInterrupt` (and `ParentCommand`) propagate.** Wherever the `task` /
  subagent wrapper catches exceptions to turn them into a tool result, these two
  must pass through untouched, so the outermost graph suspends and the checkpointer
  persists the paused state. The child graph needs a checkpointer of its own, or
  there is nothing to resume into.
- **Always publish a terminal event.** A run that ends — however it ends — must
  emit exactly one of `ai.run.completed` / `.error` / `.cancelled`. Today a hung
  `task` emits none, and the only thing that notices is a client-side watchdog.
- **Persist what already happened.** A turn that ran three tools and wrote text
  before it died should not vanish from history.

**Scope:** everything gated behind a subagent — `execute`, `write_file`,
`edit_file`, `deliver_file`, i.e. the whole `code-runner` path: files,
spreadsheets, code execution. Top-level gated tools (`send_email`, `place_call`)
were not exercised in these captures and may be fine.

---

## Part 2 — how should a delivered file reach the chat?

> **Status, 2026-09-04 19:30. The attachment now arrives — with no address on it.**
>
> The backend attaches the file to the assistant message, exactly the shape asked
> for below, and the client maps and draws it. One thing is missing, and it is the
> only thing that matters:
>
> ```json
> {"uuid": "81791bd3-98c1-45b8-9d49-0a640524f1ef",
>  "filename": "driver_report_aug_2026.xlsx",
>  "content_type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
>  "file_size": 5455, "status": "ready", "error": null,
>  "file_uuid": null, "download_url": null}
> ```
>
> `status: "ready"`, `error: null`, a real `file_size` — the file exists and is
> finished. But **`download_url` is null and `file_uuid` is null**, so there is no
> address of any kind. The tile draws, the user taps it, and there is nothing to
> open. Same for a file the *user* uploaded (`appl-d5.pdf`, 65 237 bytes,
> `status: "ready"`, both fields null) — which the model itself read and summarised,
> so the bytes are certainly there.
>
> Nothing on the client can bridge that: under `/api/v1/ai/` the only endpoint is
> `POST /ai/attachments` (upload). There is no GET, no download-url route, and the
> file-manager's `GET /core/file-manager/files/{file_uuid}/download-url` needs the
> `file_uuid` that comes back null.
>
> **Any one of these three closes it:**
>
> 1. populate `download_url` on every read (re-presigned, not stored once — a
>    presign expires and a thread reopened tomorrow must still work);
> 2. populate `file_uuid`, and we will resolve it ourselves through the existing
>    `GET /core/file-manager/files/{file_uuid}/download-url`;
> 3. add `GET /api/v1/ai/attachments/{uuid}/download-url`.
>
> (2) is the cheapest for you if the file already lives in the file manager, and
> costs us one small request. (1) is the least work for us. Either is fine.


This is a question, not a bug report. Once `deliver_file` runs, the contract does
not say what the client should expect, and we have never seen one in a trace — so
there is nothing to implement against.

### What the client can do today

| Path | Status |
| --- | --- |
| A link in the assistant's markdown text | **Works.** Links are tappable and open through the native host (`open.url`, http(s) only). |
| An attachment on the assistant message row | **Dropped.** `AIMessageRead.attachments` is mapped only for `role: "user"`; on an assistant row the client discards it and renders nothing. |
| A link inside a `render_ui` view | **Inert by design.** `<a>` is replaced with plain text inside generated views — that is a deliberate security boundary and will not change. |
| Opening a presigned URL natively | **Works.** The app already opens `download_url`s for files the *user* attached, through the same bridge call it would use here. |

So exactly one path works today, by accident rather than design: a plain link in
the reply text.

### The three shapes we could support

1. **`attachments` on the assistant message**, the same `AIAttachmentRead` the user
   side already uses — `uuid`, `filename`, `content_type`, `file_size`,
   `download_url`. This is the one we would prefer: the chip renders in the bubble,
   it survives a reload because history carries it, and the client already has the
   component and the native open call. It needs no new event and no new schema.
2. **A dedicated event** (`ai.file.delivered` or similar) carrying the same fields,
   plus the row persisted so a reopened thread still shows it. More moving parts,
   and a file that only exists as an event disappears on reload.
3. **A link in the text**, i.e. what happens by accident now. Works, but the file
   is invisible in the transcript — no name, no size, no icon, and the URL expires
   with the presign.

### What we need from you

- Which of the three is intended? If it is (1), does the backend already attach the
  delivered file to the assistant message row, or does `deliver_file` only push it
  to the file manager and mention it in prose?
- Does an assistant-role message ever carry `attachments` today? The schema allows
  it; we have never seen one, and we currently drop them, so this is worth
  confirming before we build the UI.
- How long is `download_url` valid, and is it re-presigned on a later history read?
  A chip that renders an expired URL is worse than no chip.

### What we will do once that is answered

Small, and blocked only on the answer:

1. stop discarding `attachments` on assistant messages in the transcript mapping;
2. render them with the existing `MessageAttachments` component — it already draws
   image previews and file tiles;
3. open them on tap through the existing `attachment.open` bridge call.

Separately, and regardless of the above, we owe two fixes of our own on the
approval flow — neither is the cause of anything in Part 1, but both matter once
approvals start working:

- we do not call `GET /ai/conversations/{uuid}/pending`, so an approval raised
  while the chat screen was closed can never be recovered;
- we do not call `.../release`, so a row stuck in `resolving` cannot be unstuck.

---

## Summary

| Question | Answer |
| --- | --- |
| Is the gating on `deliver_file` a bug? | No — deliberate, and correct. |
| Why does no file arrive? | The run dies at `execute`, the first gated call inside the subagent, because `GraphInterrupt` is swallowed. `deliver_file` is never reached. |
| Is any of that the client's fault? | No. The event the client would react to is never published. |
| Can the client render a delivered file today? | Only if it arrives as a link in the reply text. An attachment on an assistant message is currently discarded. |
| What is blocking the client's part? | Knowing which shape the backend will send. |
