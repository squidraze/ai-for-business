# Attachments arrive with no address: `download_url` and `file_uuid` are both null

Русская версия: [attachment-no-url.ru.md](attachment-no-url.ru.md).

**One line:** `GET /ai/conversations/{uuid}/messages/history` returns attachments
with `status: "ready"`, a real `file_size`, and **no way to fetch the bytes** —
both `download_url` and `file_uuid` come back `null`. The app draws the file, the
user taps it, and there is nothing to open.

This affects **both directions**: files the assistant delivers and files the user
uploaded. Uploading works, the model can read the file, the row is stored
correctly — only the client-facing address is missing.

---

## Evidence

Captured 2026-09-04 19:26–19:30 on dev, read back at 19:34.

### A file the assistant delivered

Assistant message `a8088fc8-d7f7-47f1-983a-f0db3a483beb`, `created_at
2026-09-04T19:26:25`:

```json
{
  "uuid": "81791bd3-98c1-45b8-9d49-0a640524f1ef",
  "filename": "driver_report_aug_2026.xlsx",
  "content_type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "file_size": 5455,
  "modality": null,
  "status": "ready",
  "error": null,
  "file_uuid": null,
  "download_url": null
}
```

### A file the user uploaded

User message `60da20f0-26eb-4083-b52a-2d21160fcb6d`, `created_at
2026-09-04T19:30:24`:

```json
{
  "uuid": "04c8ba51-947c-4ae0-bb9d-8ec65550eef8",
  "filename": "appl-d5.pdf",
  "content_type": "application/pdf",
  "file_size": 65237,
  "modality": "text",
  "status": "ready",
  "error": null,
  "file_uuid": null,
  "download_url": null
}
```

The model read this PDF and summarised its contents in the next turn (a Russian
hydraulic-test form, Appendix Д5) — so the bytes are unquestionably on the server.
Only the client cannot reach them.

### What the client logs on a tap

```
WARN [webchat.attachments] attachment has no url — nothing to open
  {"name": "appl-d5.pdf", "id": "04c8ba51-…", "status": "ready", "error": null,
   "contentType": "application/pdf"}
```

Six taps on the PDF, three on the XLSX, all identical.

---

## Why the client cannot work around it

There is no route to a stored AI attachment. Under `/api/v1/ai/` the only
attachment endpoint in the published spec is:

```
POST /api/v1/ai/attachments      ← upload
```

No `GET`, no download-url route. The file manager does have one —
`GET /api/v1/core/file-manager/files/{file_uuid}/download-url` — but it needs the
`file_uuid` that comes back `null`.

So the client holds the filename, the size, the MIME type and the word "ready",
and has no address of any kind. Nothing can be constructed from a uuid the API
does not accept anywhere.

---

## What the user sees

The tile renders correctly — name, size, file icon — and tapping it now says
"This file isn't available yet." That message is the honest reading of
`download_url: null`, but it is wrong in substance: the file *is* ready, and the
user has no way to get it. Before that message existed, the tap simply did
nothing.

An assistant that builds a report and then cannot hand it over is worse than one
that never offered — the work happened, the tokens were spent, and the result is
unreachable.

---

## Three ways to close it — any one is enough

1. **Populate `download_url` on every read.** Re-presign per request rather than
   storing one URL: a presigned link expires (yours are ~1 hour, judging by the
   `Expires=` on the S3 URLs the model pastes into its answers), and a thread
   reopened tomorrow has to work.
2. **Populate `file_uuid`.** If the file already lives in the file manager, this
   is the cheapest change on your side, and we will resolve the address ourselves
   through the existing `GET /core/file-manager/files/{file_uuid}/download-url`.
3. **Add `GET /api/v1/ai/attachments/{uuid}/download-url`.** The most explicit,
   and the one that never expires from the client's point of view.

Our preference is (1) or (2); (1) is the least work for us, (2) is likely the
least for you. Please say which you pick — the client change differs and is small
either way.

---

## How to verify the fix

1. Upload any file into a chat, or ask for a report as `.xlsx`.
2. Leave the chat and reopen it — this forces a history read rather than the local
   optimistic copy.
3. `GET /ai/conversations/{uuid}/messages/history` must return that attachment with
   a usable `download_url` (or a non-null `file_uuid`).
4. Tapping the tile in the app must open the file.

Step 2 matters: right after an upload the app still holds its own local preview, so
the bug is invisible until the thread is reopened.

---

## Also worth fixing while you are in there

- `status: "ready"` with no address is self-contradictory. If a file can be stored
  but not served, that state deserves its own `status` value and an `error`, so a
  client can say something true about it.
- The same read returns `modality: "text"` for the PDF and `null` for the XLSX.
  Not blocking, but the field's meaning is not obvious from the outside.
