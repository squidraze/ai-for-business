"""Conversation tree helpers, serialisation, and the model context."""

import base64
import hashlib
import hmac
import json
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.ai.models import Attachment, Conversation, Message, utcnow
from app.config import settings

TEXT_TYPES = ("text/", "application/json", "application/xml", "application/csv", "application/x-yaml")
TEXT_EXT = (".txt", ".md", ".csv", ".json", ".xml", ".yaml", ".yml", ".log", ".html", ".py", ".js", ".ts")
MAX_TEXT_ATTACHMENT = 30000
MAX_IMAGE_BYTES = 8 * 1024 * 1024


def iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat().replace("+00:00", "Z")


# ---------------------------------------------------------------- tree


def get_message(db: Session, conv: Conversation, uuid: str) -> Message | None:
    return db.scalar(select(Message).where(Message.conversation_id == conv.id, Message.uuid == uuid))


def chain(db: Session, conv: Conversation, leaf_uuid: str | None) -> list[Message]:
    """Root → leaf, deleted rows included (callers filter)."""
    if not leaf_uuid:
        return []
    rows = {m.uuid: m for m in db.scalars(select(Message).where(Message.conversation_id == conv.id))}
    out: list[Message] = []
    cur = rows.get(leaf_uuid)
    seen = set()
    while cur is not None and cur.uuid not in seen:
        seen.add(cur.uuid)
        out.append(cur)
        cur = rows.get(cur.parent_uuid) if cur.parent_uuid else None
    out.reverse()
    return out


def latest_leaf(db: Session, conv: Conversation, from_uuid: str) -> str:
    """Follow the newest child down from `from_uuid`."""
    cur = from_uuid
    for _ in range(10000):
        child = db.scalar(
            select(Message)
            .where(Message.conversation_id == conv.id, Message.parent_uuid == cur)
            .order_by(Message.id.desc())
            .limit(1)
        )
        if child is None:
            return cur
        cur = child.uuid
    return cur


def sibling_rows(db: Session, conv: Conversation, msg: Message) -> list[Message]:
    """Every version at the fork point `msg` sits at, oldest first."""
    if msg.role == "user":
        q = select(Message).where(
            Message.conversation_id == conv.id,
            Message.role == "user",
            Message.deleted.is_(False),
            (Message.parent_uuid == msg.parent_uuid) if msg.parent_uuid else Message.parent_uuid.is_(None),
        )
    elif msg.is_turn_head and msg.anchor_uuid:
        q = select(Message).where(
            Message.conversation_id == conv.id,
            Message.is_turn_head.is_(True),
            Message.anchor_uuid == msg.anchor_uuid,
            Message.deleted.is_(False),
        )
    else:
        return [msg]
    return list(db.scalars(q.order_by(Message.id)))


def turn_head_for(db: Session, conv: Conversation, msg: Message) -> Message | None:
    """The first assistant row of the turn `msg` belongs to."""
    if msg.is_turn_head:
        return msg
    if not msg.run_uuid:
        return None
    return db.scalar(
        select(Message).where(
            Message.conversation_id == conv.id, Message.run_uuid == msg.run_uuid, Message.is_turn_head.is_(True)
        )
    )


def add_message(db: Session, conv: Conversation, **fields) -> Message:
    m = Message(conversation_id=conv.id, **fields)
    db.add(m)
    now = utcnow()
    conv.updated_at = now
    conv.last_message_at = now
    db.flush()
    return m


# ---------------------------------------------------------------- attachments


def file_signature(uuid: str) -> str:
    return hmac.new(settings.JWT_SECRET.encode(), f"file:{uuid}".encode(), hashlib.sha256).hexdigest()[:32]


def download_url(att: Attachment) -> str:
    base = settings.BACKEND_PUBLIC_URL.rstrip("/")
    return f"{base}/api/v1/ai/files/{att.uuid}?sig={file_signature(att.uuid)}"


def attachment_read(att: Attachment) -> dict:
    ct = att.content_type or "application/octet-stream"
    return {
        "uuid": att.uuid,
        "filename": att.filename,
        "content_type": ct,
        "file_size": att.file_size,
        "modality": "image" if ct.startswith("image/") else "file",
        "status": "ready",
        "error": None,
        "file_uuid": att.uuid,
        "download_url": download_url(att),
    }


def attachments_for(db: Session, uuids: list[str]) -> list[Attachment]:
    if not uuids:
        return []
    rows = {a.uuid: a for a in db.scalars(select(Attachment).where(Attachment.uuid.in_(uuids)))}
    return [rows[u] for u in uuids if u in rows]


# ---------------------------------------------------------------- serialisation


def message_read(db: Session, m: Message, sibling_count: int = 1) -> dict:
    return {
        "uuid": m.uuid,
        "role": m.role,
        "content": m.content,
        "tool_calls": m.tool_calls,
        "tool_call_id": m.tool_call_id,
        "name": m.name,
        "created_at": iso(m.created_at),
        "attachments": [attachment_read(a) for a in attachments_for(db, m.attachment_uuids or [])],
        "sibling_count": sibling_count,
        "feedback_rating": m.feedback_rating,
        "feedback_comment": m.feedback_comment,
    }


def conversation_read(conv: Conversation) -> dict:
    return {
        "uuid": conv.uuid,
        "title": conv.title,
        "model": conv.model,
        "last_message_at": iso(conv.last_message_at),
        "created_at": iso(conv.created_at),
        "updated_at": iso(conv.updated_at),
        "disabled_connectors": conv.disabled_connectors or [],
        "agent": None,
        "company": None,
    }


def history(db: Session, conv: Conversation, leaf: str | None = None) -> list[dict]:
    rows = [m for m in chain(db, conv, leaf or conv.active_leaf_uuid) if not m.deleted]
    out = []
    for m in rows:
        count = 1
        if m.role == "user" or m.is_turn_head:
            count = len(sibling_rows(db, conv, m)) or 1
        out.append(message_read(db, m, count))
    return out


def preview_text(db: Session, conv: Conversation) -> str | None:
    """Last prose line of the active branch (mobile chat list)."""
    for m in reversed(chain(db, conv, conv.active_leaf_uuid)):
        if not m.deleted and m.role in ("user", "assistant") and (m.content or "").strip():
            return m.content.strip()[:200]
    return None


def message_count(db: Session, conv: Conversation) -> int:
    return db.scalar(select(func.count(Message.id)).where(Message.conversation_id == conv.id)) or 0


# ---------------------------------------------------------------- model context


def _user_content(db: Session, m: Message):
    atts = attachments_for(db, m.attachment_uuids or [])
    if not atts:
        return m.content or ""
    parts: list[dict] = []
    text = m.content or ""
    extra = []
    for a in atts:
        ct = (a.content_type or "").lower()
        path = Path(a.path)
        if not path.exists():
            extra.append(f"[attachment {a.filename}: file missing]")
            continue
        if ct.startswith("image/") and a.file_size <= MAX_IMAGE_BYTES:
            b64 = base64.b64encode(path.read_bytes()).decode()
            parts.append({"type": "image_url", "image_url": {"url": f"data:{ct};base64,{b64}"}})
        elif ct.startswith(TEXT_TYPES) or a.filename.lower().endswith(TEXT_EXT):
            body = path.read_bytes()[: MAX_TEXT_ATTACHMENT * 4].decode("utf-8", errors="replace")[:MAX_TEXT_ATTACHMENT]
            extra.append(f'<attachment name="{a.filename}">\n{body}\n</attachment>')
        else:
            extra.append(f"[attachment {a.filename} ({ct or 'binary'}, {a.file_size} bytes) — content not readable]")
    if extra:
        text = (text + "\n\n" + "\n\n".join(extra)).strip()
    return [{"type": "text", "text": text or "(see attachments)"}] + parts


def model_context(db: Session, conv: Conversation, head_uuid: str | None) -> list[dict]:
    """The chain up to `head_uuid`, in OpenAI Chat Completions shape, kept valid:
    every assistant `tool_calls` entry is answered by a tool row, and no tool row
    is orphaned (a deleted or still-pending call is dropped from the request)."""
    rows = [m for m in chain(db, conv, head_uuid) if not m.deleted]
    answered = {m.tool_call_id for m in rows if m.role == "tool" and m.tool_call_id}
    out: list[dict] = []
    offered: set[str] = set()
    for m in rows:
        if m.role == "user":
            out.append({"role": "user", "content": _user_content(db, m)})
        elif m.role == "assistant":
            calls = [c for c in (m.tool_calls or []) if c.get("id") in answered]
            msg: dict = {"role": "assistant", "content": m.content or ""}
            if calls:
                msg["tool_calls"] = calls
                offered.update(c["id"] for c in calls)
            if msg["content"] or calls:
                out.append(msg)
        elif m.role == "tool":
            if m.tool_call_id in offered:
                out.append({"role": "tool", "tool_call_id": m.tool_call_id, "content": m.content or ""})
    return out


def parse_args(raw) -> dict:
    if isinstance(raw, dict):
        return raw
    try:
        v = json.loads(raw or "{}")
        return v if isinstance(v, dict) else {}
    except (json.JSONDecodeError, TypeError):
        return {}
