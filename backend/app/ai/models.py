"""AI chat tables: conversations, messages (a tree via parent pointers), runs,
pending approvals, standing tool permissions, uploaded attachments."""

import uuid as uuid_lib
from datetime import datetime, timezone

from sqlalchemy import JSON, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


def _uuid() -> str:
    return str(uuid_lib.uuid4())


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Conversation(Base):
    __tablename__ = "ai_conversations"
    id: Mapped[int] = mapped_column(primary_key=True)
    uuid: Mapped[str] = mapped_column(String(36), unique=True, index=True, default=_uuid)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    model: Mapped[str | None] = mapped_column(String(100), nullable=True)
    disabled_connectors: Mapped[list] = mapped_column(JSON, default=list)
    active_leaf_uuid: Mapped[str | None] = mapped_column(String(36), nullable=True)
    last_message_at: Mapped[datetime | None] = mapped_column(nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=utcnow)
    deleted: Mapped[bool] = mapped_column(default=False)
    # who owns it: "chat" (the chat list) or a feature such as "schedule"; only
    # "chat" conversations are listed in the chat list, all open normally by uuid
    source: Mapped[str] = mapped_column(String(20), default="chat", server_default="chat", index=True)


class Message(Base):
    __tablename__ = "ai_messages"
    id: Mapped[int] = mapped_column(primary_key=True)
    uuid: Mapped[str] = mapped_column(String(36), unique=True, index=True, default=_uuid)
    conversation_id: Mapped[int] = mapped_column(ForeignKey("ai_conversations.id"), index=True)
    # previous row in the chain (None = first message)
    parent_uuid: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    # for assistant/tool rows: the user message this turn answers (regenerate siblings)
    anchor_uuid: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    run_uuid: Mapped[str | None] = mapped_column(String(36), nullable=True)
    role: Mapped[str] = mapped_column(String(20))
    content: Mapped[str | None] = mapped_column(Text, nullable=True)
    tool_calls: Mapped[list | None] = mapped_column(JSON, nullable=True)
    tool_call_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    attachment_uuids: Mapped[list] = mapped_column(JSON, default=list)
    # Context only the model sees, prepended to a user message (never shown in the chat).
    model_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    # the first assistant row of a turn: the WebView keys a folded turn on it
    # (regenerate / siblings / feedback), so the sibling group lives here
    is_turn_head: Mapped[bool] = mapped_column(default=False)
    feedback_rating: Mapped[str | None] = mapped_column(String(10), nullable=True)
    feedback_comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    deleted: Mapped[bool] = mapped_column(default=False)


class Run(Base):
    __tablename__ = "ai_runs"
    id: Mapped[int] = mapped_column(primary_key=True)
    uuid: Mapped[str] = mapped_column(String(36), unique=True, index=True, default=_uuid)
    conversation_id: Mapped[int] = mapped_column(ForeignKey("ai_conversations.id"), index=True)
    user_id: Mapped[int] = mapped_column(Integer, index=True)
    # running | awaiting_approval | completed | cancelled | error
    status: Mapped[str] = mapped_column(String(30), default="running")
    model: Mapped[str | None] = mapped_column(String(100), nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    # the user message this run answers, and the current tail of the chain
    anchor_uuid: Mapped[str | None] = mapped_column(String(36), nullable=True)
    head_uuid: Mapped[str | None] = mapped_column(String(36), nullable=True)
    turn_head_uuid: Mapped[str | None] = mapped_column(String(36), nullable=True)
    fresh: Mapped[bool] = mapped_column(default=False)
    steps: Mapped[int] = mapped_column(default=0)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(nullable=True)


class PendingAction(Base):
    __tablename__ = "ai_pending_actions"
    id: Mapped[int] = mapped_column(primary_key=True)
    uuid: Mapped[str] = mapped_column(String(36), unique=True, index=True, default=_uuid)
    conversation_id: Mapped[int] = mapped_column(ForeignKey("ai_conversations.id"), index=True)
    run_uuid: Mapped[str] = mapped_column(String(36), index=True)
    # pending | resolving | resolved | cancelled
    status: Mapped[str] = mapped_column(String(20), default="pending")
    # [{id, name, args}] — the gated tool calls waiting on a decision
    calls: Mapped[list] = mapped_column(JSON, default=list)
    actions: Mapped[list] = mapped_column(JSON, default=list)
    allow_options: Mapped[dict] = mapped_column(JSON, default=dict)
    decision: Mapped[str | None] = mapped_column(String(20), nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


class ToolPermission(Base):
    __tablename__ = "ai_tool_permissions"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, index=True)
    tool: Mapped[str] = mapped_column(String(100))
    scope: Mapped[str] = mapped_column(String(20))  # always | session
    conversation_id: Mapped[int | None] = mapped_column(Integer, nullable=True)  # set for session
    created_at: Mapped[datetime] = mapped_column(default=utcnow)


class Attachment(Base):
    __tablename__ = "ai_attachments"
    id: Mapped[int] = mapped_column(primary_key=True)
    uuid: Mapped[str] = mapped_column(String(36), unique=True, index=True, default=_uuid)
    user_id: Mapped[int] = mapped_column(Integer, index=True)
    filename: Mapped[str] = mapped_column(String(255))
    content_type: Mapped[str] = mapped_column(String(100), default="application/octet-stream")
    file_size: Mapped[int] = mapped_column(default=0)
    path: Mapped[str] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
