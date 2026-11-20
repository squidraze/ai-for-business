# Message feedback: a thumb is a stored object

Русская версия: [message-feedback.ru.md](message-feedback.ru.md).

The thumbs under an assistant reply were removed from this app once, on purpose:
there was no endpoint behind them, so a vote reached no backend and survived
nothing, and a control that silently does nothing is worse than no control. As of
**2026-09-05** the endpoint exists, so they are back — wired.

```
POST /api/v1/ai/conversations/{conversation_uuid}/messages/{message_uuid}/feedback
     { "rating": "good" | "bad" | null, "comment"?: "…" }
  →  { message_uuid, feedback_rating, feedback_comment }
```

## What the backend guarantees, and what follows from it

- **The rating is written to the message row first**, and only then pushed to
  Langfuse as a score on the trace that reply came from. A Langfuse outage costs
  the score, never the rating, and never fails the call — so the client has no
  retry logic beyond "the request failed, try again", and no second source of
  truth to reconcile.
- **`AIMessageRead` returns it** (`feedback_rating`, `feedback_comment`), which is
  the only reason a rating can be restored at all: reopening a thread tomorrow
  shows the same filled glyph.
- **`rating: null` clears it.** That is the undo half of a toggle, not a third
  state — pressing the filled thumb sends `null`. An opinion you cannot take back
  is its own kind of broken control.
- **A reply from before the migration answers `422`, permanently.** It carries no
  Langfuse trace to score. That is an answer, not a fault, so it is shown as an
  *informational* toast saying exactly that, never as a retryable error, and it is
  logged at `info` rather than `warn`.

## How it is put together here

| Piece | What it owns |
| --- | --- |
| `lib/api/ai.ts` → `submitMessageFeedback` | the one call; `lib/api/types.ts` carries the request/response shapes |
| `chat/feedback.ts` → `rateMessage` | the toggle, the optimistic update, and the rollback |
| `chat/types.ts` → `AssistantMessage.feedback` | the rating, on the message itself — no side store, because this app owns its message model |
| `chat/history.ts` | narrows `feedback_rating` onto the rebuilt turn |
| `ui/chat/MessageActions.tsx` | the two glyphs, filled rather than merely tinted |

**The rating lives on the message, not in a cache beside it.** The native chat
needs a side store keyed by uuid (assistant-ui has nowhere to carry a rating);
this app has its own store, so the field goes where the reply is and the
optimistic update is a normal `updateAssistantMessage`.

**A turn is stored as several rows, and the rating sits on whichever one was on
screen when it was given.** `toTranscript` folds those rows into one bubble, so
the fold takes the first rating it finds across the turn rather than the last
row's (usually empty) value. Without that, a reply rated live — where the uuid
comes from `ai.run.completed` — would come back from history unrated.

**No spinner and no comment box.** A rating is not worth a loading state: the
glyph fills on the tap and rolls back if the request fails. The API accepts an
optional `comment` (2000 chars) and the client mirror passes it through, but there
is no UI for it yet — a "what went wrong?" sheet is a design question, not a
wiring one.

## Checking it

With no backend — `npm run dev`, open **Thread with history** from the DEV panel:

| Do this | Expect |
| --- | --- |
| Look at the first reply | thumbs-up already filled — it comes back from the fixture's `feedback_rating` |
| Tap thumbs-down on any reply | it fills, the up-thumb clears |
| Tap the filled thumb again | it empties (that is `rating: null` on the wire) |
| Reload the thread from the DEV panel | every rating is still there — the mock stores it on the row, as the backend does |
| Rate the last reply ("…so rating it answers 422") | the thumb fills, then rolls back, with an informational toast: this reply is from before feedback existed |
| Send a message, then rate the reply as soon as it finishes | works — the reply learned its uuid from `ai.run.completed` |

Against the real backend the log lines are `rating saved` and `this reply predates
feedback and cannot be rated`.
