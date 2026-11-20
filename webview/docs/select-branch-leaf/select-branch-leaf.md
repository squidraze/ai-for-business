# `select-branch` returns a branch with no reply on it

Русская версия: [select-branch-leaf.ru.md](select-branch-leaf.ru.md).

> **Status, 2026-09-04.** The live spec on dev now documents exactly the behaviour
> this report asks for — "pointing at a message that already has a reply under it
> moves the active leaf to the **TIP** of that branch (the deepest descendant …
> see `message_q.get_deepest_descendant`), not the target itself". Our pinned
> OpenAPI snapshot still carries the older wording, so the fix landed after the
> capture below. **It has not been re-verified from the app yet** — the report is
> kept as the record of what was observed and as the test to re-run.

**One line:** after `POST /messages/{uuid}/select-branch`, the following
`GET /messages/history` returns the selected message and **nothing under it** —
the reply that was generated on that branch is not on the path, and it is not
reachable through `?leaf=` either. To the user, switching back to a previous
version of a question deletes the answer that was there.

Everything else in the branching flow behaves correctly (see
[What already works](#what-already-works)) — this report is about one step.

---

## Environment

| | |
| --- | --- |
| Backend | dev (`api` behind the mobile app), 2026-09-03, ~17:08 device time |
| Client | business app (Android), web chat WebView, user `139` |
| Conversation | `0515640a-00ba-44eb-b770-4ef567d84943` |
| Reproduced again in | `1772bfae-939d-45e9-b70e-86e553421d96`, same day ~16:58 |

Both conversations are on the dev database and still exist — a direct DB look at
either settles the open question at the bottom of this file.

---

## Reproduction

1. **New conversation, question A.**
   `POST /api/v1/ai/messages` → user message `bb09c778-5396-4982-8546-4d4bf68c5a60`
   (56 chars). The run completes and an assistant reply is generated and streamed
   to the client.

2. **Edit question A** — the fork.
   `POST /api/v1/ai/conversations/0515640a-…/messages/bb09c778-…/edit` → `202`.
   New user sibling `90050d01-f84f-4ced-852c-22a88150d409` (74 chars), run
   `66a3a749-d9cb-4db7-85c8-c7392626681f`, reply `…ff04df7c` of 1276 chars.

3. **History after the fork — correct.**
   `GET /messages/history?limit=100` → 2 rows:

   ```
   user       90050d01-…8150d409   74ch    sibling_count: 2
   assistant  …ff04df7c          1276ch
   ```

4. **Siblings — correct.**
   `GET /messages/90050d01-…/siblings` →
   `[bb09c778-…, 90050d01-…]`, both `role: "user"`, the edited one at position 2.

5. **Switch back to version 1.**
   `POST /messages/bb09c778-…/select-branch` → `200`

   ```json
   { "conversation_uuid": "0515640a-…", "active_leaf_message_uuid": "bb09c778-5396-4982-8546-4d4bf68c5a60" }
   ```

   The returned active leaf is **the message that was passed in**.

6. **History on the newly active branch — the bug.**
   `GET /messages/history?limit=100` → **1 row**:

   ```
   user  bb09c778-…f68c5a60  56ch  sibling_count: 2
   ```

   The reply generated for question A in step 1 is not there. No assistant row of
   any kind, empty or otherwise.

7. **Same branch addressed explicitly — still nothing.**
   `GET /messages/history?leaf=bb09c778-…&limit=100` → **1 row**, identical to
   step 6.

---

## What we expected

`select-branch` on a message that has descendants should make **the whole branch**
active: the active leaf should be the deepest message reachable from the selected
one along its own active-child chain, not the selected message itself. History
would then answer step 6 with:

```
user       bb09c778-…   56ch
assistant  <reply to A>
```

As it stands, `active_leaf_message_uuid` is echoed back unchanged and
`history` returns the path **to** the leaf, so a branch selected at a *user*
message can never contain its own reply — the reply is a descendant of the leaf,
and descendants are not on the path.

---

## Why the client cannot work around it

The obvious client-side fix would be to re-read the branch addressed by its last
message. It does not exist as an option:

- `history?leaf=X` returns the ancestors of `X` (confirmed in step 7 — passing the
  user message returns only that user message);
- the client has no other uuid to pass. `siblings` on the user message returns
  user messages only; the reply that lives under the archived version was never
  sent to this client, so its uuid is unknown here.

So there is no request the app can make today that returns "the branch under
`bb09c778`". That is why this is filed as a backend issue rather than worked
around.

---

## Impact

The whole premise of branching is that a fork **never destroys** the previous
version — that is what makes "regenerate" and "edit" safe to offer. Right now
walking back to a previous version shows the question with an empty space where
the answer used to be, which reads exactly like data loss. Users report it as
"the AI reply disappeared".

---

## Two possibilities — please confirm which

1. **The active-leaf pointer is not descended** (what the evidence points at).
   `select-branch` sets `active_leaf = <the message passed in>` rather than
   walking down that branch to its last message. Fix is in `select-branch`.

2. **The reply to A was re-parented or dropped by the edit fork.** If the edit
   moved the existing reply onto the new sibling, or unlinked it, then no pointer
   fix helps and the data model needs a look instead.

A direct query on conversation `0515640a-00ba-44eb-b770-4ef567d84943` —
"what rows have `parent = bb09c778-5396-4982-8546-4d4bf68c5a60`" — separates the
two immediately.

### Questions

- Does `select-branch` descend to the deepest descendant of the selected message,
  or does it store the passed uuid as the active leaf?
- Is `history?leaf=X` defined as "the path ending at `X`" (ancestors only)? If so,
  is there any way to ask for the branch **below** a message?
- After `edit` forks a user turn, does the original turn keep its own reply as a
  child?

---

## What already works

Listed so nothing here gets touched by the fix:

- `POST .../edit` — forks a user sibling, answers with a real `message_uuid`, and
  the run that follows produces the reply correctly.
- `GET .../messages/history` — the folded trace and `sibling_count` are right on
  the branch that is actually active (step 3).
- `GET .../messages/{uuid}/siblings` — returns both versions, oldest-first, with
  the correct roles and order (step 4).
- `POST .../select-branch` — answers `200` and the switch itself takes effect;
  only the leaf it lands on is wrong.

---

## Client log, verbatim

Times are the device clock. Uuids are shortened to their last 8 characters by the
client logger; `..f68c5a60` is `bb09c778-5396-4982-8546-4d4bf68c5a60` and
`..8150d409` is `90050d01-f84f-4ced-852c-22a88150d409`.

```
17:08:47.910  run stream ended {"parts":["text(1276)"],"runUuid":"66a3a749-…","textChars":1276}

17:08:48.469  history read {"reason":"after-edit","rows":2,"shape":"u a",
              "wire":["user ..8150d409 74ch siblings:2","assistant ..ff04df7c 1276ch"]}

17:08:48.859  sibling list read {"messageUuid":"..8150d409","position":"2 of 2",
              "roles":["user","user"],"siblings":["..f68c5a60","..8150d409"]}

17:08:51.150  ← 200 POST /messages/bb09c778-…/select-branch

17:08:51.164  switched branch {"to":"..f68c5a60","activeLeaf":"..f68c5a60",
              "leafIsTheSelectedMessage":true,"position":"2 -> 1 of 2"}

17:08:51.424  history read {"reason":"select-branch","rows":1,"shape":"u",
              "wire":["user ..f68c5a60 56ch siblings:2"]}

17:08:51.430  WARN the version switched to has no reply under it
              {"target":"..f68c5a60","activeLeaf":"..f68c5a60","leafIsTheSelectedMessage":true}

17:08:52.056  WARN the same branch, read again by leaf
              {"target":"..f68c5a60","rows":1,"carriesAnAnswer":false,
               "wire":["user ..f68c5a60 56ch siblings:2"]}
```

The last line is the probe described in [Why the client cannot work around
it](#why-the-client-cannot-work-around-it): the same branch requested a second
time with `?leaf=bb09c778-…`, which came back with the user message alone.
