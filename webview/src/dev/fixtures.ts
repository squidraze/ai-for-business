/**
 * The data the mock backend serves. Separated from the routing so the shapes can
 * be read against `src/lib/api/types.ts` without the transport noise around them.
 *
 * DEV ONLY — reached exclusively from `src/dev/mockBackend.ts`, which is itself
 * behind the dead-code-eliminated dynamic import in `src/dev/index.ts`.
 *
 * Every field name here comes from `@/lib/api/types` on purpose: the fixtures are
 * typed with the real interfaces, so a contract change breaks the mock at compile
 * time instead of at 3pm in a browser.
 */

import type {
  AIAttachmentRead,
  AIMessageRead,
  AIUploadedFile,
  CursorPageAIMessageRead,
} from '@/lib/api/types';

/* ------------------------------------------------------------------ */
/* Conversations                                                       */
/* ------------------------------------------------------------------ */

/** A seeded thread with a transcript — put this in `VITE_DEV_THREAD_ID` to open it on load. */
export const HISTORY_CONVERSATION_UUID = 'dev00000-0000-4000-8000-000000000001';
/** A seeded thread that exists but has never been used — the empty-state case. */
export const EMPTY_CONVERSATION_UUID = 'dev00000-0000-4000-8000-000000000002';
/** An empty thread with a custom agent — no starters, no voice, the agent named. */
export const AGENT_CONVERSATION_UUID = 'dev00000-0000-4000-8000-000000000003';

/** What the mock stores per conversation. Mutable: a run appends to it. */
export interface MockConversation {
  uuid: string;
  title: string | null;
  model: string | null;
  createdAt: string;
  updatedAt: string;
  /** The **active branch**, oldest-first — what a history load returns. */
  messages: AIMessageRead[];
  /** Connected apps switched off for this conversation. Absent = all on. */
  disabledConnectors?: string[];
  /** The custom agent the conversation is with. Absent = Rooler itself. */
  agent?: { uuid: string; name: string; icon: string | null };
  /**
   * Fork points: every group is the sibling uuids at one, oldest-first. Exactly
   * one member of a group is on `messages` at a time; the rest live in
   * {@link MockConversation.archived} until a select-branch swaps them in.
   *
   * A flat model of branching is enough for the harness: what the UI needs to
   * exercise is "N versions, walk between them", not the parent pointers the real
   * backend keeps.
   */
  branches: string[][];
  /** Messages that exist but are not on the active branch, by uuid. */
  archived: Map<string, AIMessageRead>;
}

/**
 * An inline image so an attachment chip renders a real thumbnail with nothing
 * leaving the browser. `download_url` is a presigned URL on a real backend; a
 * data URI stands in for one and satisfies the same `<img src>`.
 */
const IMAGE_DATA_URI =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMjAi' +
  'IGhlaWdodD0iMjAwIj48cmVjdCB3aWR0aD0iMzIwIiBoZWlnaHQ9IjIwMCIgZmlsbD0iIzFmN2JkMSIvPjx0ZXh0IHg9Ij' +
  'E2MCIgeT0iMTA2IiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSIyMiIgZmlsbD0iI2ZmZiIgdGV4dC1h' +
  'bmNob3I9Im1pZGRsZSI+Qk9MLTQ4MjEucG5nPC90ZXh0Pjwvc3ZnPg==';

/** Timestamps that read as "earlier today" rather than 1970. */
const minutesAgo = (minutes: number): string =>
  new Date(Date.now() - minutes * 60_000).toISOString();

function seedHistory(): MockConversation {
  const messages: AIMessageRead[] = [
    {
      uuid: 'dev-msg-0001',
      role: 'user',
      content: 'Which of my loads are running late this week?',
      created_at: minutesAgo(42),
      attachments: [],
    },
    {
      uuid: 'dev-msg-0002',
      role: 'assistant',
      content:
        'Two of them are behind schedule:\n\n' +
        '- **ST-4822** (Denver → Phoenix) — about 2 hours late, weather on I-70.\n' +
        '- **ST-4830** (Seattle → Boise) — 45 minutes late, waiting on a dock door.\n\n' +
        'Everything else is on time. Want me to notify the customers?',
      created_at: minutesAgo(41),
      attachments: [],
      // Already rated, so the restored-from-history state is on screen the moment
      // the harness opens rather than only after a tap.
      feedback_rating: 'good',
    },
    {
      uuid: 'dev-msg-0003',
      role: 'user',
      content: "Here's the BOL for ST-4822 — does the weight match the rate con?",
      created_at: minutesAgo(12),
      attachments: [
        {
          uuid: 'dev-att-0001',
          filename: 'BOL-4821.png',
          content_type: 'image/svg+xml',
          file_size: 24_918,
          modality: 'image',
          status: 'ready',
          file_uuid: 'dev-file-0001',
          download_url: IMAGE_DATA_URI,
        },
      ],
    },
    {
      uuid: 'dev-msg-0004',
      role: 'assistant',
      content:
        'It does not. The BOL shows **42,150 lb**, the rate confirmation says **41,000 lb** — a ' +
        '1,150 lb difference. That is inside the 5% tolerance on this contract, so it will not ' +
        'reprice, but it is worth a note to the shipper.',
      created_at: minutesAgo(11),
      attachments: [],
    },
  ];

  // A reply from before the feedback migration: it has no trace to score, so the
  // mock answers its `/feedback` with the same `422` the backend does (the uuid is
  // what the mock matches on). Without it the only way to see that toast is to
  // find a genuinely old conversation on a real backend.
  messages.push(
    {
      uuid: 'dev-msg-0005',
      role: 'user',
      content: 'And what did we quote them in March?',
      created_at: minutesAgo(9),
      attachments: [],
    },
    {
      uuid: 'dev-msg-0006-no-feedback',
      role: 'assistant',
      content:
        'In March this lane went out at **$2.14/mile** — $1,840 all-in on 860 miles. This reply ' +
        'is older than the feedback feature, so rating it answers 422.',
      created_at: minutesAgo(8),
      attachments: [],
    },
  );

  // A ready-made fork on the first reply, so the "n of N" switcher is on screen
  // the moment the harness opens — the one part of branching that is otherwise
  // only reachable by first regenerating something.
  const alternate: AIMessageRead = {
    uuid: 'dev-msg-0002-alt',
    role: 'assistant',
    content:
      'Two are behind: **ST-4822** (2h, weather) and **ST-4830** (45m, dock). ' +
      'The rest are on time.',
    created_at: minutesAgo(41),
    attachments: [],
  };

  return {
    uuid: HISTORY_CONVERSATION_UUID,
    title: 'Late loads this week',
    model: 'rooler-fast',
    createdAt: minutesAgo(45),
    updatedAt: minutesAgo(11),
    messages,
    branches: [['dev-msg-0002', alternate.uuid]],
    archived: new Map([[alternate.uuid, alternate]]),
  };
}

function seedEmpty(): MockConversation {
  return {
    uuid: EMPTY_CONVERSATION_UUID,
    title: 'Empty thread',
    model: 'rooler-fast',
    createdAt: minutesAgo(5),
    updatedAt: minutesAgo(5),
    messages: [],
    branches: [],
    archived: new Map(),
  };
}

function seedAgent(): MockConversation {
  return {
    ...seedEmpty(),
    uuid: AGENT_CONVERSATION_UUID,
    title: 'Fuel auditor',
    agent: { uuid: 'agent-0001', name: 'Fuel auditor', icon: null },
  };
}

/** Fresh objects per call — the store mutates them, so seeds must not be shared. */
export function seedConversations(): MockConversation[] {
  return [seedHistory(), seedEmpty(), seedAgent()];
}

export function toHistoryPage(conversation: MockConversation, limit: number): CursorPageAIMessageRead {
  // `sibling_count` is computed by the history endpoint and nowhere else — the
  // same split the real backend has, and the reason the switcher is only ever fed
  // from a history load.
  const items = conversation.messages.map((message) => ({
    ...message,
    sibling_count:
      conversation.branches.find((group) => group.includes(message.uuid))?.length ?? 1,
  }));
  return {
    items,
    meta: {
      limit,
      has_more: false,
      oldest: items[0]?.created_at ?? null,
      newest: items[items.length - 1]?.created_at ?? null,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Attachments                                                         */
/* ------------------------------------------------------------------ */

/** What the host knows about a file it is holding, when it uploads it. */
export interface UploadedFileMeta {
  name: string;
  type: string;
  size: number;
  /**
   * A real backend answers with a presigned URL. The host's own preview data URI
   * stands in for one and satisfies the same `<img src>`, so a sent message
   * shows the thumbnail. `null` falls the chip back to its icon + filename tile —
   * the same path a file the backend is still processing takes.
   */
  previewUri?: string | null;
}

/**
 * What `POST /api/v1/ai/attachments` answers with — the browser-fallback path,
 * where the app holds a real `File` and uploads it itself.
 */
export function uploadedFile(uuid: string, meta: UploadedFileMeta): AIUploadedFile {
  return {
    uuid,
    original_filename: meta.name || 'attachment',
    content_type: meta.type || 'application/octet-stream',
    file_size: meta.size,
  };
}

/** The stored form of an upload: what a message echoes back in `attachments`. */
export function uploadedAttachment(uuid: string, meta: UploadedFileMeta): AIAttachmentRead {
  const contentType = meta.type || 'application/octet-stream';
  return {
    uuid,
    filename: meta.name || 'attachment',
    content_type: contentType,
    file_size: meta.size,
    modality: contentType.startsWith('image/') ? 'image' : 'file',
    status: 'ready',
    file_uuid: uuid,
    download_url: meta.previewUri ?? null,
  };
}
