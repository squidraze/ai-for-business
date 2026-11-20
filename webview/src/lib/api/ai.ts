import { api } from './client';
import type {
  AIAttachmentUploadRead,
  AIConversationRead,
  AIConversationUpdate,
  ConnectionRead,
  PageConnectionRead,
  AIMessageRead,
  ConnectionTokenResponse,
  CursorPageAIMessageRead,
  EditMessageRequest,
  MessageFeedbackRequest,
  MessageFeedbackResponse,
  AIRunRead,
  PendingActionRead,
  ResumeAcceptedResponse,
  ResumeRequest,
  RunAcceptedResponse,
  SelectBranchResponse,
  SendMessageRequest,
  StartMessageRequest,
} from './types';

/**
 * Oldest-first page of a conversation's messages.
 *
 * Branch-aware: with no `leaf` it returns the conversation's currently-active
 * branch, which is what the transcript renders. Pass a message uuid as `leaf` to
 * read a different branch without making it active.
 */
export async function listMessageHistory(
  conversationUuid: string,
  params: { limit?: number; before?: string; after?: string; leaf?: string } = {},
  signal?: AbortSignal,
): Promise<CursorPageAIMessageRead> {
  const { data } = await api().get<CursorPageAIMessageRead>(
    `/api/v1/ai/conversations/${conversationUuid}/messages/history`,
    { params: { limit: 100, ...params }, signal },
  );
  return data;
}

/** First message of a brand-new conversation — this is what creates it. */
export async function startMessage(
  body: StartMessageRequest,
  signal?: AbortSignal,
): Promise<RunAcceptedResponse> {
  const { data } = await api().post<RunAcceptedResponse>('/api/v1/ai/messages', body, { signal });
  return data;
}

export async function sendMessage(
  conversationUuid: string,
  body: SendMessageRequest,
  signal?: AbortSignal,
): Promise<RunAcceptedResponse> {
  const { data } = await api().post<RunAcceptedResponse>(
    `/api/v1/ai/conversations/${conversationUuid}/messages`,
    body,
    { signal },
  );
  return data;
}

/**
 * Rate one assistant reply — `'good'`, `'bad'`, or `null` to clear it.
 *
 * The rating is stored on the message row first and only then pushed to Langfuse
 * as a score, so a Langfuse outage never loses a vote and never fails this call.
 * Keyed by the reply's **server uuid**: a turn that has not been persisted yet
 * cannot be rated, which is why the buttons wait for one (see `MessageActions`).
 *
 * **A reply from before the feedback migration answers `422`** — it carries no
 * Langfuse trace to score. That is a real answer, not a fault, and the UI says so
 * in those words rather than offering a retry that cannot succeed.
 */
export async function submitMessageFeedback(
  conversationUuid: string,
  messageUuid: string,
  body: MessageFeedbackRequest,
): Promise<MessageFeedbackResponse> {
  const { data } = await api().post<MessageFeedbackResponse>(
    `/api/v1/ai/conversations/${conversationUuid}/messages/${messageUuid}/feedback`,
    body,
  );
  return data;
}

/**
 * Cooperative cancel: the run ends with a terminal `ai.run.cancelled` event.
 *
 * The run is named explicitly. A conversation can have more than one run in
 * flight, so there is no "the" active run to cancel implicitly — the uuid comes
 * from the `202` that accepted the send, or from {@link listActiveRuns}.
 */
export async function cancelRun(conversationUuid: string, runUuid: string): Promise<void> {
  await api().post(`/api/v1/ai/conversations/${conversationUuid}/runs/${runUuid}/cancel`);
}

/**
 * Answer one gated action. Keyed by the action, not the conversation: several can
 * be paused at once, so the decision has to say which one it is answering.
 */
export async function resumePending(
  conversationUuid: string,
  pendingUuid: string,
  body: ResumeRequest,
): Promise<ResumeAcceptedResponse> {
  const { data } = await api().post<ResumeAcceptedResponse>(
    `/api/v1/ai/conversations/${conversationUuid}/pending/${pendingUuid}/resume`,
    body,
  );
  return data;
}

/**
 * Free a gated action stranded in `resolving` — a decision was accepted and the
 * task that should have resumed the run died, so answering it again does nothing.
 * The backend refuses an early release with a `409`.
 */
export async function releasePending(conversationUuid: string, pendingUuid: string): Promise<void> {
  await api().post(`/api/v1/ai/conversations/${conversationUuid}/pending/${pendingUuid}/release`);
}

/**
 * Runs the backend still considers live. A run outlives the screen that started
 * it, and its `run_uuid` was only ever known from the `202` — this is how a
 * reopened conversation finds out a reply is still being written.
 */
export async function listActiveRuns(conversationUuid: string): Promise<AIRunRead[]> {
  const { data } = await api().get<AIRunRead[]>(
    `/api/v1/ai/conversations/${conversationUuid}/runs`,
  );
  return Array.isArray(data) ? data : [];
}

/**
 * Gated actions still waiting on a person. The approval card is drawn from the
 * **event**, so a conversation reopened after it was published has no other way
 * to get the card — or the `pending_uuid` a resume is keyed by — back.
 */
export async function listPendingActions(conversationUuid: string): Promise<PendingActionRead[]> {
  const { data } = await api().get<PendingActionRead[]>(
    `/api/v1/ai/conversations/${conversationUuid}/pending`,
  );
  return Array.isArray(data) ? data : [];
}

/* ---------------------------------------------------------------- */
/* Branching                                                         */
/* ---------------------------------------------------------------- */

/**
 * A fresh alternate reply to whatever `messageUuid` (role `assistant`) replied to.
 * A **sibling**, never an overwrite — the original stays reachable on its own
 * branch. The `202`'s `message_uuid` is `null`: the new row does not exist yet.
 */
export async function regenerateMessage(
  conversationUuid: string,
  messageUuid: string,
  signal?: AbortSignal,
): Promise<RunAcceptedResponse> {
  const { data } = await api().post<RunAcceptedResponse>(
    `/api/v1/ai/conversations/${conversationUuid}/messages/${messageUuid}/regenerate`,
    undefined,
    { signal },
  );
  return data;
}

/**
 * New content for a past user turn (`messageUuid` must be role `user`), forked as
 * a sibling. Unlike regenerate this **does** return a real `message_uuid`
 * synchronously — the edited user message exists the moment the call is accepted.
 */
export async function editMessage(
  conversationUuid: string,
  messageUuid: string,
  body: EditMessageRequest,
  signal?: AbortSignal,
): Promise<RunAcceptedResponse> {
  const { data } = await api().post<RunAcceptedResponse>(
    `/api/v1/ai/conversations/${conversationUuid}/messages/${messageUuid}/edit`,
    body,
    { signal },
  );
  return data;
}

/** Every version at a fork point, oldest-first — the list behind "n of N". */
export async function listSiblings(
  conversationUuid: string,
  messageUuid: string,
  signal?: AbortSignal,
): Promise<AIMessageRead[]> {
  const { data } = await api().get<AIMessageRead[]>(
    `/api/v1/ai/conversations/${conversationUuid}/messages/${messageUuid}/siblings`,
    { signal },
  );
  return data;
}

/**
 * Soft-delete one message (and its attachments): it drops out of history and out
 * of the context the next turn is built from. `204`, no body.
 *
 * The backend decides what else goes with it, so the caller re-reads the
 * transcript afterwards instead of splicing the row out on screen.
 */
export async function deleteMessage(conversationUuid: string, messageUuid: string): Promise<void> {
  await api().delete(`/api/v1/ai/conversations/${conversationUuid}/messages/${messageUuid}`);
}

/** Jump the active branch to an existing message. No run is started. */
export async function selectBranch(
  conversationUuid: string,
  messageUuid: string,
): Promise<SelectBranchResponse> {
  const { data } = await api().post<SelectBranchResponse>(
    `/api/v1/ai/conversations/${conversationUuid}/messages/${messageUuid}/select-branch`,
  );
  return data;
}

export async function getConversation(conversationUuid: string): Promise<AIConversationRead> {
  const { data } = await api().get<AIConversationRead>(
    `/api/v1/ai/conversations/${conversationUuid}`,
  );
  return data;
}

/**
 * The person's active connected apps (theirs, plus the company's where they may
 * read integrations — the endpoint applies that itself): what the assistant may
 * act in, and what the Connectors switches list.
 */
export async function listActiveConnections(): Promise<ConnectionRead[]> {
  const { data } = await api().get<PageConnectionRead>('/api/v1/integrations/connections', {
    params: { status: 'active' },
  });
  return Array.isArray(data?.items) ? data.items : [];
}

export async function updateConversation(
  conversationUuid: string,
  body: AIConversationUpdate,
): Promise<AIConversationRead> {
  const { data } = await api().patch<AIConversationRead>(
    `/api/v1/ai/conversations/${conversationUuid}`,
    body,
  );
  return data;
}

export async function uploadAttachments(
  files: File[],
  signal?: AbortSignal,
): Promise<AIAttachmentUploadRead> {
  const form = new FormData();
  for (const file of files) form.append('files', file);
  const { data } = await api().post<AIAttachmentUploadRead>('/api/v1/ai/attachments', form, {
    signal,
  });
  return data;
}

export async function getRealtimeConnectionToken(): Promise<ConnectionTokenResponse> {
  const { data } = await api().get<ConnectionTokenResponse>('/api/v1/realtime/connection-token');
  return data;
}
