/**
 * An offline stand-in for the TMS backend: every endpoint the web app asks for
 * over the bridge, plus the Centrifugo socket that streams a fake AI run
 * (`mockRuns.ts`).
 *
 * DEV ONLY. The module is reached through the dynamic import in `src/dev/index.ts`
 * that `import.meta.env.DEV` folds away in a production build, so nothing here
 * ships in `dist/index.html`.
 *
 * ## Where it intercepts, and why there
 *
 * At the **bridge**, not at the browser transport. The web app no longer issues
 * REST at all: on a device the page is loaded from `file://`, so its origin is
 * `null`, and the backend's CORS allowlist answers `400 Disallowed CORS origin`
 * to that — with `allow-credentials: true` in play, `*` is not available to it
 * either. So the app posts `http.request` and the native host performs the call
 * with the session it already holds.
 *
 * The harness therefore stands in where the host does: `mockHttp.ts` answers
 * `http.request` with `http.response`, calling {@link routeRequest} below. That
 * replaced a patched `XMLHttpRequest`/`fetch` pair, and is both smaller and a
 * far more faithful simulation — dev now exercises the exact code path a device
 * takes, envelope for envelope, instead of a transport the device never uses.
 *
 * The **WebSocket patch stays**. Only REST moved: the realtime connection is
 * still made by the web app itself, so the transport stood in for here has not
 * changed.
 *
 * ## Timing
 *
 * The install is synchronous, and `startDevHost()` runs it before it answers
 * `ready` with `init`. That ordering is the whole point: `applyInit()` starts the
 * API and immediately asks for the model list, the connection token and the
 * thread, and the socket patch has to be in place before the first of those
 * comes back with a `url` to connect to.
 */

import type { HttpMethod } from '@/bridge/protocol';
import type {
  AIAttachmentRead,
  AIAttachmentUploadRead,
  AIConversationRead,
  AIMessageRead,
  ConnectionTokenResponse,
  ResumeRequest,
  RunAcceptedResponse,
} from '@/lib/api/types';

import {
  AGENT_CONVERSATION_UUID,
  EMPTY_CONVERSATION_UUID,
  HISTORY_CONVERSATION_UUID,
  seedConversations,
  toHistoryPage,
  uploadedAttachment,
  uploadedFile,
  type MockConversation,
  type UploadedFileMeta,
} from './fixtures';
import {
  MOCK_WS_URL,
  MockCentrifugoSocket,
  cancelRun,
  getAiChannel,
  listPendings,
  listRuns,
  releaseRun,
  resumeRun,
  setAiChannel,
  startRun,
  type SettledCall,
  type SettledDelegation,
} from './mockRuns';

const uuid = (): string =>
  typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `mock-${Math.random().toString(16).slice(2)}-${Date.now().toString(16)}`;

const nowIso = (): string => new Date().toISOString();

/* ------------------------------------------------------------------ */
/* The store                                                           */
/* ------------------------------------------------------------------ */

const conversations = new Map<string, MockConversation>();
/** Files uploaded this session, so a sent message can echo them back. */
const uploads = new Map<string, AIAttachmentRead>();

function conversation(conversationUuid: string): MockConversation {
  const existing = conversations.get(conversationUuid);
  if (existing) return existing;
  const created: MockConversation = {
    uuid: conversationUuid,
    title: null,
    model: 'rooler-fast',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    messages: [],
    branches: [],
    archived: new Map(),
  };
  conversations.set(conversationUuid, created);
  return created;
}

function appendMessage(target: MockConversation, message: AIMessageRead): void {
  target.messages.push(message);
  target.updatedAt = message.created_at;
}

/**
 * Store a finished reply the way the backend stores one: the trace, then the
 * words.
 *
 * A turn that delegated is **three** rows, not one — the assistant row carrying
 * the `task` call, the `tool` row holding its answer, and the assistant row with
 * the prose — because that is what a re-opened thread has to be rebuilt from
 * (`toTranscript`, `storedDelegations`). Storing only the text is what would let
 * a delegation card render live and then vanish on reload without anyone
 * noticing.
 */
function storeReply(
  target: MockConversation,
  uuidForReply: string,
  text: string,
  delegation?: SettledDelegation,
  calls?: SettledCall[],
): void {
  // The trace a tool-using turn leaves, the way the backend stores it: one
  // assistant row announcing the calls, then a `tool` row per answer.
  if (calls && calls.length > 0) {
    appendMessage(target, {
      uuid: `${uuidForReply}-calls`,
      role: 'assistant',
      content: '',
      tool_calls: calls.map((call) => ({
        id: call.callId,
        type: 'function',
        function: { name: call.name, arguments: JSON.stringify(call.args) },
      })),
      created_at: nowIso(),
      attachments: [],
    });
    calls.forEach((call, index) => {
      if (call.result === null) return;
      appendMessage(target, {
        uuid: `${uuidForReply}-result-${index}`,
        role: 'tool',
        name: call.name,
        tool_call_id: call.callId,
        content: call.result,
        created_at: nowIso(),
        attachments: [],
      });
    });
  }
  if (delegation) {
    appendMessage(target, {
      uuid: `${uuidForReply}-call`,
      role: 'assistant',
      content: '',
      tool_calls: [
        {
          id: delegation.callId,
          type: 'function',
          function: { name: 'task', arguments: JSON.stringify(delegation.args) },
        },
      ],
      created_at: nowIso(),
      attachments: [],
    });
    // A hung subagent never wrote a result row — the reload has to cope.
    if (delegation.result !== null) {
      appendMessage(target, {
        uuid: `${uuidForReply}-result`,
        role: 'tool',
        name: 'task',
        tool_call_id: delegation.callId,
        content: delegation.result,
        created_at: nowIso(),
        attachments: [],
      });
    }
  }

  appendMessage(target, {
    uuid: uuidForReply,
    role: 'assistant',
    content: text,
    created_at: nowIso(),
    attachments: [],
  });
}

function toConversationRead(target: MockConversation): AIConversationRead {
  return {
    uuid: target.uuid,
    title: target.title,
    model: target.model,
    last_message_at: target.messages[target.messages.length - 1]?.created_at ?? null,
    created_at: target.createdAt,
    updated_at: target.updatedAt,
    disabled_connectors: target.disabledConnectors ?? [],
    agent: target.agent ?? null,
  };
}

/**
 * The connected apps the harness pretends the person has: two of their own and a
 * company one, a duplicate connection of one app (one switch, not two), one the
 * assistant never uses and one that is not active — every filter in
 * `chat/connectors.ts` has something to do.
 */
const MOCK_CONNECTIONS = [
  { uuid: 'conn-1', provider_key: 'google-calendar', provider_display_name: 'Google Calendar', status: 'active' },
  { uuid: 'conn-2', provider_key: 'quickbooks', provider_display_name: 'QuickBooks', status: 'active' },
  { uuid: 'conn-3', provider_key: 'notion', provider_display_name: 'Notion', status: 'active' },
  { uuid: 'conn-4', provider_key: 'google-calendar', provider_display_name: 'Google Calendar (work)', status: 'active' },
  { uuid: 'conn-5', provider_key: 'telegram-bot', provider_display_name: 'Telegram bot', status: 'active' },
  { uuid: 'conn-6', provider_key: 'zoom', provider_display_name: 'Zoom', status: 'error' },
];

/** First line of the prompt — the backend auto-titles a conversation much like this. */
function titleFor(prompt: string): string {
  const text = prompt.trim().split('\n')[0];
  if (!text) return 'New conversation';
  return text.length > 48 ? `${text.slice(0, 45)}...` : text;
}

/* ------------------------------------------------------------------ */
/* Attachments                                                         */
/* ------------------------------------------------------------------ */

/**
 * Store an uploaded file and hand back the uuid the message will carry in
 * `file_uuids`. Two callers, because there are two intake paths:
 *
 *  - `hostFiles.ts`, answering `attachment.upload` for a file the *host* is
 *    holding — the native path, and the only one a device has;
 *  - the `POST /api/v1/ai/attachments` route below, for the browser fallback,
 *    where `<input type="file">` handed the app a real `File` and it uploads
 *    through the API like any other request.
 */
export function registerUpload(meta: UploadedFileMeta): string {
  const fileUuid = `dev-file-${uuid()}`;
  uploads.set(fileUuid, uploadedAttachment(fileUuid, meta));
  return fileUuid;
}

/* ------------------------------------------------------------------ */
/* Branching                                                           */
/* ------------------------------------------------------------------ */

/** The sibling group `messageUuid` belongs to, creating it on first fork. */
function branchGroup(target: MockConversation, messageUuid: string): string[] {
  const existing = target.branches.find((group) => group.includes(messageUuid));
  if (existing) return existing;
  const created = [messageUuid];
  target.branches.push(created);
  return created;
}

/** Every version at a fork, oldest-first — the active one plus the archived ones. */
function siblingsOf(target: MockConversation, messageUuid: string): AIMessageRead[] {
  const group = target.branches.find((group) => group.includes(messageUuid));
  if (!group) {
    const self = target.messages.find((message) => message.uuid === messageUuid);
    return self ? [self] : [];
  }
  return group
    .map(
      (uuid) => target.messages.find((message) => message.uuid === uuid) ?? target.archived.get(uuid),
    )
    .filter((message): message is AIMessageRead => message !== undefined);
}

/**
 * Put `messageUuid` on the active branch in place of whichever of its siblings is
 * there now, archiving the one it replaces. Everything after that position is
 * dropped: it was written under the version being left, exactly as on the real
 * backend, where those messages simply belong to the other branch.
 */
function activateBranch(target: MockConversation, messageUuid: string): boolean {
  const group = target.branches.find((group) => group.includes(messageUuid));
  if (!group) return false;

  const index = target.messages.findIndex((message) => group.includes(message.uuid));
  if (index < 0) return false;

  const incoming = target.archived.get(messageUuid);
  if (!incoming) return true; // Already the active one.

  for (const dropped of target.messages.slice(index)) target.archived.set(dropped.uuid, dropped);
  target.messages = [...target.messages.slice(0, index), incoming];
  target.archived.delete(messageUuid);
  return true;
}

/* ------------------------------------------------------------------ */
/* Reading a request                                                   */
/* ------------------------------------------------------------------ */

export type RequestParams = Record<string, string | number | boolean | undefined>;

/** `body` crosses the bridge as JSON, so it arrives already parsed. */
function asRecord(body: unknown): Record<string, unknown> {
  return body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : {};
}

const readString = (source: Record<string, unknown>, key: string): string =>
  typeof source[key] === 'string' ? source[key] : '';

function readStringArray(source: Record<string, unknown>, key: string): string[] {
  const value = source[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

/* ------------------------------------------------------------------ */
/* The REST table                                                      */
/* ------------------------------------------------------------------ */

export interface MockReply {
  status: number;
  /** `null` is a 204 with no body. */
  body: unknown;
}

const ok = (body: unknown): MockReply => ({ status: 200, body });
const accepted = (body: RunAcceptedResponse): MockReply => ({ status: 202, body });
const noContent = (): MockReply => ({ status: 204, body: null });
const fail = (status: number, detail: string): MockReply => ({ status, body: { detail } });

/** Accept the message, store it, and schedule the run that answers it. */
function acceptTurn(
  target: MockConversation,
  payload: Record<string, unknown>,
  fresh: boolean,
): MockReply {
  const content = readString(payload, 'content');
  const fileUuids = readStringArray(payload, 'file_uuids');
  const model = readString(payload, 'model');
  if (model) target.model = model;

  const messageUuid = `dev-msg-${uuid()}`;
  const runUuid = uuid();

  appendMessage(target, {
    uuid: messageUuid,
    role: 'user',
    content,
    created_at: nowIso(),
    attachments: fileUuids
      .map((fileUuid) => uploads.get(fileUuid))
      .filter((attachment): attachment is AIAttachmentRead => attachment !== undefined),
  });

  // The backend auto-titles a conversation shortly after its first run; doing it
  // here is what makes `ensureTitle()` -> `thread.titled` fire in dev.
  if (fresh && !target.title) target.title = titleFor(content);

  startRun({
    conversationUuid: target.uuid,
    runUuid,
    prompt: content,
    fresh,
    onSettled: (text, delegation, calls) =>
      storeReply(target, `dev-msg-${runUuid}`, text, delegation, calls),
  });

  return accepted({
    conversation_uuid: target.uuid,
    message_uuid: messageUuid,
    run_uuid: runUuid,
    status: 'accepted',
    channel: getAiChannel(),
    created_conversation: fresh,
  });
}

/**
 * The endpoint table. `path` is what the app put in `HttpRequest.url` — relative
 * to the host's `baseURL`, never absolute — and `params` is the query it would
 * otherwise have serialised.
 */
export function routeRequest(
  method: HttpMethod,
  path: string,
  params: RequestParams,
  body: unknown,
): MockReply {
  const verb = method.toUpperCase();

  if (verb === 'GET' && path === '/api/v1/realtime/connection-token') {
    const token: ConnectionTokenResponse = {
      token: 'mock-centrifugo-token',
      url: MOCK_WS_URL,
      channels: [getAiChannel()],
    };
    return ok(token);
  }

  // The browser-fallback upload, and the one request whose body is not JSON: in a
  // tab `send()` hands the dev host the envelope as an object, so the `FormData`
  // arrives intact. Inside a real host this endpoint is unreachable — the adapter
  // refuses a multipart body, and `attachment.upload` carries it instead.
  if (verb === 'POST' && path === '/api/v1/ai/attachments') {
    const parts = body instanceof FormData ? body.getAll('files') : [];
    const uploaded: AIAttachmentUploadRead = {
      files: parts.map((entry) => {
        const file = entry instanceof File ? entry : null;
        const meta: UploadedFileMeta = {
          name: file?.name ?? 'attachment',
          type: file?.type ?? 'application/octet-stream',
          size: file?.size ?? 0,
          // A real backend answers with a presigned URL. There is nothing to
          // presign here, so the chip falls back to its icon + filename tile —
          // the same path a file still being processed takes.
          previewUri: null,
        };
        return uploadedFile(registerUpload(meta), meta);
      }),
    };
    return ok(uploaded);
  }

  // POST /api/v1/ai/messages — the first message, which creates the conversation.
  if (verb === 'POST' && path === '/api/v1/ai/messages') {
    const payload = asRecord(body);
    const existing = readString(payload, 'conversation_uuid');
    const target = conversation(existing || uuid());
    // The switches flipped before the conversation existed ride on its first message.
    if (existing === '') target.disabledConnectors = readStringArray(payload, 'disabled_connectors');
    return acceptTurn(target, payload, existing === '');
  }

  // A dispatcher whose role is missing `driver:read`: their own four lose
  // "Available drivers", and the row is topped up from the fallback order.
  if (verb === 'GET' && path === '/api/v1/auth/me/context') {
    return ok({
      user: { id: 'dev-user' },
      memberships: [
        {
          // The company the dev host puts in `init` — see `devHost.ts`.
          company_id:
            (import.meta.env.VITE_DEV_COMPANY_ID as string | undefined) ||
            '00000000-0000-0000-0000-000000000001',
          company_name: 'Dev Logistics',
          role: 'dispatcher',
          permissions: ['load:read', 'analytics:read', 'ar_batch:read', 'ai:chat'],
        },
      ],
      user_features: {},
    });
  }

  if (verb === 'GET' && path === '/api/v1/ai/attention') {
    const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();
    return ok({
      items: [
        {
          uuid: 'att-1',
          kind: 'document_expired',
          severity: 'critical',
          title: 'Medical card expired',
          subtitle: 'Alex Boznikov',
          occurred_at: hoursAgo(50),
          prompt: 'Alex Boznikov’s medical card expired two days ago. What does that block, and what should I do?',
        },
        {
          uuid: 'att-2',
          kind: 'invoice_overdue',
          severity: 'warning',
          title: 'Invoice 30 days overdue',
          subtitle: 'Fulton Foods · $4,820',
          occurred_at: hoursAgo(5),
          prompt: 'Fulton Foods has an invoice 30 days overdue. Summarise it and draft a reminder.',
        },
        {
          uuid: 'att-3',
          kind: 'status_request_pending',
          severity: 'info',
          title: 'Status request waiting',
          subtitle: 'Load ST-4822',
          occurred_at: hoursAgo(0.5),
          prompt: 'A driver status request on load ST-4822 is waiting. What is it and should I approve it?',
        },
      ],
      meta: { total: 7 },
    });
  }

  if (verb === 'GET' && path === '/api/v1/integrations/connections') {
    const status = typeof params.status === 'string' ? params.status : undefined;
    return ok({ items: MOCK_CONNECTIONS.filter((row) => !status || row.status === status) });
  }

  const match = /^\/api\/v1\/ai\/conversations\/([^/]+)(\/.*)?$/.exec(path);
  if (match) {
    const target = conversation(match[1]);
    const rest = match[2] ?? '';

    if (verb === 'POST' && rest === '/messages') {
      return acceptTurn(target, asRecord(body), false);
    }

    // Cancel names the run now: a conversation can have several in flight, so
    // there is no "the" active run to end implicitly.
    const cancelMatch = /^\/runs\/([^/]+)\/cancel$/.exec(rest);
    if (verb === 'POST' && cancelMatch) {
      cancelRun(target.uuid);
      return noContent();
    }

    if (verb === 'GET' && rest === '/runs') return ok(listRuns(target.uuid));
    if (verb === 'GET' && rest === '/pending') return ok(listPendings(target.uuid));

    // Resume names the paused action, for the same reason: more than one can be
    // waiting on a decision at once.
    const resumeMatch = /^\/pending\/([^/]+)\/resume$/.exec(rest);
    if (verb === 'POST' && resumeMatch) {
      const request = asRecord(body);
      const decision = readString(request, 'decision') as ResumeRequest['decision'];
      const allowRaw = readString(request, 'allow');
      const allow = allowRaw === 'always' || allowRaw === 'session' ? allowRaw : undefined;
      const result = resumeRun(target.uuid, decision === 'reject' ? 'reject' : 'approve', allow);
      // The backend answers a decision on nothing open with a 409.
      if (!result) return fail(409, 'This action is already being processed');
      return ok({
        conversation_uuid: target.uuid,
        pending_uuid: resumeMatch[1],
        decision,
        status: 'resuming',
        channel: getAiChannel(),
        allowed: result.allowed,
      });
    }

    const releaseMatch = /^\/pending\/([^/]+)\/release$/.exec(rest);
    if (verb === 'POST' && releaseMatch) {
      if (!releaseRun(target.uuid)) return fail(409, 'This action is not stranded');
      return noContent();
    }

    // A soft delete on the real backend: the row leaves history and nothing else
    // moves. Only the active branch is searched — the menu only offers it there.
    const deleteMatch = /^\/messages\/([^/]+)$/.exec(rest);
    if (verb === 'DELETE' && deleteMatch) {
      const index = target.messages.findIndex((message) => message.uuid === deleteMatch[1]);
      if (index < 0) return { status: 404, body: { detail: 'No such message' } };
      target.messages.splice(index, 1);
      return noContent();
    }

    const messageMatch =
      /^\/messages\/([^/]+)\/(siblings|select-branch|regenerate|edit|feedback)$/.exec(rest);
    if (messageMatch) {
      const messageUuid = messageMatch[1];
      const action = messageMatch[2];

      if (verb === 'GET' && action === 'siblings') return ok(siblingsOf(target, messageUuid));

      if (verb === 'POST' && action === 'feedback') {
        const row = target.messages.find((message) => message.uuid === messageUuid);
        if (!row) return { status: 404, body: { detail: 'No such message' } };
        // The pre-migration case, on demand: a reply with no trace to score
        // answers 422 forever, and the row seeded with this uuid is how that
        // path gets exercised without a backend.
        if (messageUuid.includes('no-feedback')) {
          return {
            status: 422,
            body: { detail: 'This message has no trace and cannot carry feedback.' },
          };
        }
        const requested = asRecord(body).rating;
        const rating = requested === 'good' || requested === 'bad' ? requested : null;
        // Stored on the row, exactly as the backend does — which is what makes a
        // re-opened thread show the rating again.
        row.feedback_rating = rating;
        row.feedback_comment = rating === null ? null : (readString(asRecord(body), 'comment') ?? null);
        return ok({
          message_uuid: messageUuid,
          feedback_rating: row.feedback_rating,
          feedback_comment: row.feedback_comment,
        });
      }

      if (verb === 'POST' && action === 'select-branch') {
        if (!activateBranch(target, messageUuid)) {
          return { status: 404, body: { detail: 'No such branch' } };
        }
        return ok({ conversation_uuid: target.uuid, active_leaf_message_uuid: messageUuid });
      }

      if (verb === 'POST' && action === 'regenerate') {
        // A sibling of the target reply: the old one is archived, not deleted, and
        // the `202` carries `message_uuid: null` because the new row does not
        // exist yet — the real one arrives with the terminal event.
        const index = target.messages.findIndex((message) => message.uuid === messageUuid);
        if (index < 0) return { status: 404, body: { detail: 'No such message' } };

        const group = branchGroup(target, messageUuid);
        const runUuid = uuid();
        const replyUuid = `dev-msg-${runUuid}`;
        group.push(replyUuid);

        for (const dropped of target.messages.slice(index)) target.archived.set(dropped.uuid, dropped);
        target.messages = target.messages.slice(0, index);

        const prompt = [...target.messages].reverse().find((message) => message.role === 'user');
        startRun({
          conversationUuid: target.uuid,
          runUuid,
          prompt: prompt?.content ?? '',
          fresh: false,
          onSettled: (text, delegation, calls) => storeReply(target, replyUuid, text, delegation, calls),
        });

        return accepted({
          conversation_uuid: target.uuid,
          message_uuid: null,
          run_uuid: runUuid,
          status: 'accepted',
          channel: getAiChannel(),
          created_conversation: false,
        });
      }

      if (verb === 'POST' && action === 'edit') {
        // A sibling of the *user* turn, and unlike regenerate it answers with a
        // real message uuid straight away — the edited message exists at once.
        const index = target.messages.findIndex((message) => message.uuid === messageUuid);
        if (index < 0) return { status: 404, body: { detail: 'No such message' } };

        const original = target.messages[index];
        const group = branchGroup(target, messageUuid);
        const content = readString(asRecord(body), 'content');
        const editedUuid = `dev-msg-${uuid()}`;
        group.push(editedUuid);

        for (const dropped of target.messages.slice(index)) target.archived.set(dropped.uuid, dropped);
        target.messages = target.messages.slice(0, index);
        appendMessage(target, {
          uuid: editedUuid,
          role: 'user',
          content,
          created_at: nowIso(),
          attachments: original.attachments ?? [],
        });

        const runUuid = uuid();
        startRun({
          conversationUuid: target.uuid,
          runUuid,
          prompt: content,
          fresh: false,
          onSettled: (text, delegation, calls) =>
      storeReply(target, `dev-msg-${runUuid}`, text, delegation, calls),
        });

        return accepted({
          conversation_uuid: target.uuid,
          message_uuid: editedUuid,
          run_uuid: runUuid,
          status: 'accepted',
          channel: getAiChannel(),
          created_conversation: false,
        });
      }
    }

    if (verb === 'GET' && rest === '/messages/history') {
      return ok(toHistoryPage(target, Number(params.limit) || 100));
    }

    if (verb === 'PATCH' && rest === '') {
      const payload = asRecord(body);
      const title = readString(payload, 'title');
      const model = readString(payload, 'model');
      if (title) target.title = title;
      if (model) target.model = model;
      // The whole list, replaced — the backend does not merge.
      if (Array.isArray(payload.disabled_connectors)) {
        target.disabledConnectors = readStringArray(payload, 'disabled_connectors');
      }
      return ok(toConversationRead(target));
    }

    if (verb === 'GET' && rest === '') return ok(toConversationRead(target));
  }

  console.warn('[mock-backend] no route', verb, path);
  return { status: 404, body: { detail: `No mock route for ${verb} ${path}` } };
}

/* ------------------------------------------------------------------ */
/* Install                                                             */
/* ------------------------------------------------------------------ */

let installed = false;

export const isMockInstalled = (): boolean => installed;

/** The seeded threads the DEV panel can switch to. */
export const MOCK_THREADS = {
  history: HISTORY_CONVERSATION_UUID,
  empty: EMPTY_CONVERSATION_UUID,
  agent: AGENT_CONVERSATION_UUID,
};

/**
 * Idempotent, and synchronous by contract — see the note at the top of the file.
 * Seeds the store and replaces `WebSocket` for this page; the REST half is
 * answered over the bridge by `mockHttp.ts`.
 */
export function installMockBackend(userUuid: string): void {
  if (!import.meta.env.DEV || installed) return;
  installed = true;

  setAiChannel(`ai:user-${userUuid}`);
  for (const seed of seedConversations()) conversations.set(seed.uuid, seed);

  window.WebSocket = new Proxy(window.WebSocket, {
    construct: (target, args: unknown[]) =>
      String(args[0]) === MOCK_WS_URL
        ? (new MockCentrifugoSocket() as unknown as WebSocket)
        : (Reflect.construct(target, args) as WebSocket),
  });

  console.info('%c[mock-backend] installed — no request leaves the browser', 'color:#16a34a', {
    aiChannel: getAiChannel(),
    threads: MOCK_THREADS,
  });
}
