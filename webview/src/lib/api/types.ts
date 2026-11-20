/**
 * Request/response shapes for the endpoints this screen uses.
 *
 * Mirrors `packages/api/generated/models` in the mobile monorepo — that
 * contract is generated from `packages/api/openapi.json` and is the source of
 * truth. Keep the field names identical; when the contract changes, run
 * `npm run api` there and update these by hand.
 */

export interface AIAttachmentRead {
  uuid: string;
  filename?: string | null;
  content_type?: string | null;
  file_size?: number | null;
  modality?: string | null;
  status: string;
  error?: string | null;
  file_uuid?: string | null;
  download_url?: string | null;
}

export interface AIMessageRead {
  uuid: string;
  role: string;
  content?: string | null;
  tool_calls?: unknown | null;
  tool_call_id?: string | null;
  name?: string | null;
  created_at: string;
  attachments?: AIAttachmentRead[];
  /**
   * The N in "1 of N" — how many versions exist at this fork point.
   *
   * Only trustworthy from `GET .../messages/history`, which computes it for the
   * whole page in one extra query. Everywhere else it defaults to `1`, and that
   * default means "not computed", **not** "definitely no alternates" — so never
   * use it to conclude a message has no siblings outside a history page.
   */
  sibling_count?: number;
  /**
   * The thumbs-up/down already on this reply, when it has one — `'good'`,
   * `'bad'`, or absent.
   *
   * It is what makes the vote survive a reload: the rating lives on the message
   * row, so a thread reopened tomorrow shows the same filled glyph the user left
   * behind. Typed as a plain string because the wire says so; the UI narrows it.
   */
  feedback_rating?: string | null;
  /** The optional note that came with the rating. */
  feedback_comment?: string | null;
}

/**
 * Thumbs up/down on one assistant reply.
 *
 * `rating: null` **clears** a rating that is already there — the undo half of a
 * toggle, not a third state. `comment` is optional and capped at 2000 chars by
 * the backend.
 */
export interface MessageFeedbackRequest {
  rating: 'good' | 'bad' | null;
  comment?: string | null;
}

/** What the feedback endpoint answers with — the row as it now stands. */
export interface MessageFeedbackResponse {
  message_uuid: string;
  feedback_rating?: string | null;
  feedback_comment?: string | null;
}

/** The custom chat agent a conversation belongs to. */
export interface AgentRef {
  uuid: string;
  name: string;
  icon?: string | null;
}

export interface AIConversationRead {
  uuid: string;
  title?: string | null;
  model?: string | null;
  last_message_at?: string | null;
  created_at: string;
  updated_at: string;
  /**
   * Integration ids switched **off** for this conversation (the "+" menu's
   * Connectors). `[]` — or absent, on an older backend — means every app is on.
   */
  disabled_connectors?: string[] | null;
  /** Set when the conversation is with a custom agent rather than Rooler itself. */
  agent?: AgentRef | null;
  /** The company that owns it — organization backend only. */
  company?: { uuid: string; name: string } | null;
}

/** What `PATCH /ai/conversations/{uuid}` accepts. Omitting a field leaves it. */
export interface AIConversationUpdate {
  title?: string;
  model?: string | null;
  /** The **whole** list — the backend replaces, it does not merge. */
  disabled_connectors?: string[];
}

/**
 * One connected outside app (`GET /integrations/connections`). Only the fields
 * the Connectors switches read. `provider_key` is the integration id — the same
 * id `disabled_connectors` holds and `run_connected_app_tool` names before `__`.
 */
export interface ConnectionRead {
  uuid: string;
  provider_key: string;
  provider_display_name?: string | null;
  status: string;
}

export interface PageConnectionRead {
  items: ConnectionRead[];
}

export interface CursorPageMeta {
  limit: number;
  has_more: boolean;
  oldest?: string | null;
  newest?: string | null;
}

export interface CursorPageAIMessageRead {
  items?: AIMessageRead[];
  meta: CursorPageMeta;
}

export interface RunAcceptedResponse {
  conversation_uuid: string;
  /**
   * `null` from `regenerate`: no row exists at accept-time, since the alternate
   * reply has not been generated yet. The real uuid arrives on `ai.run.completed`.
   */
  message_uuid?: string | null;
  run_uuid: string;
  status?: string;
  channel: string;
  created_conversation?: boolean;
}

/**
 * There is no `interrupt_previous` any more, on either request. A conversation may
 * carry several runs at once (subagent fan-out, or a voice session sharing it), so
 * a send is never rejected for a run that is still in flight — sending always
 * creates a new run.
 */
export interface StartMessageRequest {
  content: string;
  file_uuids?: string[];
  conversation_uuid?: string | null;
  model?: string | null;
  /** The connected apps switched off for the conversation this message creates. */
  disabled_connectors?: string[];
  /** Start the conversation with a custom agent instead of Rooler itself. */
  agent_uuid?: string;
  /**
   * Which company owns the conversation this message creates. Required by the
   * organization backend while several companies are selected (422 otherwise);
   * omitted with one, where the company header decides.
   */
  company_uuid?: string;
}

export interface SendMessageRequest {
  content: string;
  file_uuids?: string[];
}

/** Replacement content for a past user turn — forks a sibling, never overwrites. */
export interface EditMessageRequest {
  content: string;
}

/** What `select-branch` answers with: where the conversation is now pointing. */
export interface SelectBranchResponse {
  conversation_uuid: string;
  active_leaf_message_uuid: string;
}

/**
 * A standing approval: until revoked (`always`) or for this conversation
 * (`session`). Counts only on an approve.
 */
export type AllowScope = 'always' | 'session';

/** The decision on one gated (HITL) action, POSTed to `…/pending/{uuid}/resume`. */
export interface ResumeRequest {
  decision: 'approve' | 'reject' | 'edit';
  message?: string | null;
  edited_args?: Record<string, unknown>;
  /** Also stop asking for these tools — see {@link AllowScope}. */
  allow?: AllowScope | null;
}

/**
 * What a resume answers with. `allowed` is what the backend actually **recorded**
 * per tool, which is not always what was asked for: it downgrades `always` to
 * `session` for a tool that leaves the company or moves money.
 */
export interface ResumeAcceptedResponse {
  conversation_uuid: string;
  pending_uuid: string;
  decision: string;
  status?: string;
  channel: string;
  allowed?: Record<string, string>;
}

/**
 * One gated action still waiting on a person (`GET …/pending`). `status` is
 * `pending` while it can be answered, `resolving` once a decision was accepted —
 * and a `resolving` row whose resume task died is stranded until `…/release`.
 * `allow_options` is typed `unknown[]` per tool by the contract; narrow it.
 */
export interface PendingActionRead {
  uuid: string;
  status: string;
  action?: unknown;
  allow_options?: Record<string, unknown[]>;
}

/** One run the backend still considers live (`GET …/runs`). */
export interface AIRunRead {
  uuid: string;
  /** `running` | `awaiting_approval` | … */
  status: string;
  model?: string | null;
  error?: string | null;
  created_at: string;
  finished_at?: string | null;
}

export interface AIUploadedFile {
  uuid: string;
  original_filename: string;
  content_type?: string | null;
  file_size: number;
}

export interface AIAttachmentUploadRead {
  files: AIUploadedFile[];
}

export interface ConnectionTokenResponse {
  token: string;
  url: string;
  channels?: string[];
}
