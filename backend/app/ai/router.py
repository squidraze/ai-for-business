"""Every endpoint the WebView chat (and the mobile chat list) calls under /api/v1/ai."""

import mimetypes
import re
import uuid as uuid_lib
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.ai import runner, service, tools
from app.ai.models import Attachment, Conversation, Message, PendingAction, Run, utcnow
from app.auth import User, get_current_user
from app.config import settings
from app.db import get_db
from app.realtime import ai_channel

router = APIRouter(prefix="/api/v1/ai", tags=["ai"])

MAX_UPLOAD_BYTES = 20 * 1024 * 1024


# ---------------------------------------------------------------- schemas


class StartMessageIn(BaseModel):
    content: str = ""
    file_uuids: list[str] = []
    conversation_uuid: str | None = None
    model: str | None = None
    disabled_connectors: list[str] | None = None
    agent_uuid: str | None = None
    company_uuid: str | None = None


class SendMessageIn(BaseModel):
    content: str = ""
    file_uuids: list[str] = []


class EditIn(BaseModel):
    content: str


class FeedbackIn(BaseModel):
    rating: Literal["good", "bad"] | None = None
    comment: str | None = None


class ConversationUpdate(BaseModel):
    title: str | None = None
    model: str | None = None
    disabled_connectors: list[str] | None = None


class ResumeIn(BaseModel):
    decision: Literal["approve", "reject", "edit"]
    message: str | None = None
    edited_args: dict | None = None
    allow: Literal["always", "session"] | None = None


# ---------------------------------------------------------------- helpers


def _conv(db: Session, user: User, conversation_uuid: str) -> Conversation:
    conv = db.scalar(
        select(Conversation).where(
            Conversation.uuid == conversation_uuid, Conversation.user_id == user.id, Conversation.deleted.is_(False)
        )
    )
    if not conv:
        raise HTTPException(404, "Conversation not found")
    return conv


def _msg(db: Session, conv: Conversation, message_uuid: str) -> Message:
    m = service.get_message(db, conv, message_uuid)
    if not m or m.deleted:
        raise HTTPException(404, "Message not found")
    return m


def _accepted(conv: Conversation, user: User, run: Run, message_uuid: str | None, created: bool) -> dict:
    return {
        "conversation_uuid": conv.uuid,
        "message_uuid": message_uuid,
        "run_uuid": run.uuid,
        "status": "accepted",
        "channel": ai_channel(user.id),
        "created_conversation": created,
    }


def _own_files(db: Session, user: User, file_uuids: list[str]) -> list[str]:
    if not file_uuids:
        return []
    rows = db.scalars(select(Attachment.uuid).where(Attachment.uuid.in_(file_uuids), Attachment.user_id == user.id))
    found = set(rows)
    return [u for u in file_uuids if u in found]


def _start_turn(db: Session, user: User, conv: Conversation, content: str, file_uuids: list[str], parent: str | None, fresh: bool):
    if not content.strip() and not file_uuids:
        raise HTTPException(422, "Message is empty")
    m = service.add_message(
        db, conv, parent_uuid=parent, role="user", content=content, attachment_uuids=_own_files(db, user, file_uuids)
    )
    conv.active_leaf_uuid = m.uuid
    db.commit()
    run = runner.create_run(db, conv, user.id, anchor_uuid=m.uuid, head_uuid=m.uuid, fresh=fresh)
    runner.spawn(run.uuid)
    return m, run


# ---------------------------------------------------------------- conversations


@router.post("/messages", status_code=202)
def start_message(body: StartMessageIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    created = False
    if body.conversation_uuid:
        conv = _conv(db, user, body.conversation_uuid)
    else:
        conv = Conversation(
            user_id=user.id,
            model=body.model or None,
            disabled_connectors=sorted(set(body.disabled_connectors or [])),
        )
        db.add(conv)
        db.flush()
        created = True
    m, run = _start_turn(db, user, conv, body.content, body.file_uuids, conv.active_leaf_uuid, fresh=created)
    return _accepted(conv, user, run, m.uuid, created)


@router.get("/conversations")
def list_conversations(
    limit: int = Query(30, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    base = select(Conversation).where(Conversation.user_id == user.id, Conversation.deleted.is_(False))
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    rows = db.scalars(
        base.order_by(func.coalesce(Conversation.last_message_at, Conversation.created_at).desc()).limit(limit).offset(offset)
    )
    items = []
    for c in rows:
        item = service.conversation_read(c)
        item["preview"] = service.preview_text(db, c)
        items.append(item)
    return {"items": items, "total": total}


@router.get("/conversations/{conversation_uuid}")
def get_conversation(conversation_uuid: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return service.conversation_read(_conv(db, user, conversation_uuid))


@router.patch("/conversations/{conversation_uuid}")
def update_conversation(
    conversation_uuid: str, body: ConversationUpdate, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    conv = _conv(db, user, conversation_uuid)
    if body.title is not None and body.title.strip():
        conv.title = body.title.strip()[:255]
    if body.model is not None:
        conv.model = body.model or None
    if body.disabled_connectors is not None:
        conv.disabled_connectors = sorted(set(body.disabled_connectors))
    conv.updated_at = utcnow()
    db.commit()
    return service.conversation_read(conv)


@router.delete("/conversations/{conversation_uuid}", status_code=204)
def delete_conversation(conversation_uuid: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    conv = _conv(db, user, conversation_uuid)
    conv.deleted = True
    db.commit()
    for r in db.scalars(select(Run).where(Run.conversation_id == conv.id, Run.status.in_(["running"]))):
        t = runner.TASKS.get(r.uuid)
        if t:
            t.cancel()
    return Response(status_code=204)


@router.post("/conversations/{conversation_uuid}/messages", status_code=202)
def send_message(
    conversation_uuid: str, body: SendMessageIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    conv = _conv(db, user, conversation_uuid)
    m, run = _start_turn(db, user, conv, body.content, body.file_uuids, conv.active_leaf_uuid, fresh=not conv.title)
    return _accepted(conv, user, run, m.uuid, False)


@router.get("/conversations/{conversation_uuid}/messages/history")
def message_history(
    conversation_uuid: str,
    limit: int = Query(100, ge=1, le=500),
    before: str | None = None,
    after: str | None = None,
    leaf: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    conv = _conv(db, user, conversation_uuid)
    items = service.history(db, conv, leaf)
    # cursor: `before`/`after` are message uuids on the branch
    if before:
        idx = next((i for i, m in enumerate(items) if m["uuid"] == before), None)
        if idx is not None:
            items = items[:idx]
    if after:
        idx = next((i for i, m in enumerate(items) if m["uuid"] == after), None)
        if idx is not None:
            items = items[idx + 1 :]
    has_more = len(items) > limit
    if has_more:
        items = items[-limit:]
    return {
        "items": items,
        "meta": {
            "limit": limit,
            "has_more": has_more,
            "oldest": items[0]["uuid"] if items else None,
            "newest": items[-1]["uuid"] if items else None,
        },
    }


@router.delete("/conversations/{conversation_uuid}/messages/{message_uuid}", status_code=204)
def delete_message(
    conversation_uuid: str, message_uuid: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    conv = _conv(db, user, conversation_uuid)
    m = _msg(db, conv, message_uuid)
    m.deleted = True
    # an assistant turn goes as a whole (its tool rows too)
    if m.role == "assistant" and m.run_uuid:
        for row in db.scalars(select(Message).where(Message.conversation_id == conv.id, Message.run_uuid == m.run_uuid)):
            row.deleted = True
    db.commit()
    return Response(status_code=204)


@router.get("/conversations/{conversation_uuid}/messages/{message_uuid}/siblings")
def siblings(conversation_uuid: str, message_uuid: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    conv = _conv(db, user, conversation_uuid)
    m = _msg(db, conv, message_uuid)
    if m.role == "assistant":
        m = service.turn_head_for(db, conv, m) or m
    rows = service.sibling_rows(db, conv, m)
    return [service.message_read(db, r, len(rows)) for r in rows]


@router.post("/conversations/{conversation_uuid}/messages/{message_uuid}/select-branch")
def select_branch(
    conversation_uuid: str, message_uuid: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    conv = _conv(db, user, conversation_uuid)
    m = _msg(db, conv, message_uuid)
    conv.active_leaf_uuid = service.latest_leaf(db, conv, m.uuid)
    db.commit()
    return {"conversation_uuid": conv.uuid, "active_leaf_message_uuid": conv.active_leaf_uuid}


@router.post("/conversations/{conversation_uuid}/messages/{message_uuid}/regenerate", status_code=202)
def regenerate(conversation_uuid: str, message_uuid: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    conv = _conv(db, user, conversation_uuid)
    m = _msg(db, conv, message_uuid)
    if m.role == "user":
        anchor = m
    else:
        anchor = service.get_message(db, conv, m.anchor_uuid) if m.anchor_uuid else None
    if not anchor:
        raise HTTPException(422, "Nothing to regenerate")
    conv.active_leaf_uuid = anchor.uuid
    db.commit()
    run = runner.create_run(db, conv, user.id, anchor_uuid=anchor.uuid, head_uuid=anchor.uuid, fresh=False)
    runner.spawn(run.uuid)
    return _accepted(conv, user, run, None, False)


@router.post("/conversations/{conversation_uuid}/messages/{message_uuid}/edit", status_code=202)
def edit(
    conversation_uuid: str, message_uuid: str, body: EditIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    conv = _conv(db, user, conversation_uuid)
    m = _msg(db, conv, message_uuid)
    if m.role != "user":
        raise HTTPException(422, "Only a user message can be edited")
    new, run = _start_turn(db, user, conv, body.content, list(m.attachment_uuids or []), m.parent_uuid, fresh=False)
    return _accepted(conv, user, run, new.uuid, False)


@router.post("/conversations/{conversation_uuid}/messages/{message_uuid}/feedback")
def feedback(
    conversation_uuid: str,
    message_uuid: str,
    body: FeedbackIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    conv = _conv(db, user, conversation_uuid)
    m = _msg(db, conv, message_uuid)
    m.feedback_rating = body.rating
    m.feedback_comment = (body.comment or None) if body.rating else None
    if m.feedback_comment:
        m.feedback_comment = m.feedback_comment[:2000]
    db.commit()
    return {"message_uuid": m.uuid, "feedback_rating": m.feedback_rating, "feedback_comment": m.feedback_comment}


# ---------------------------------------------------------------- runs & approvals


@router.get("/conversations/{conversation_uuid}/runs")
def active_runs(conversation_uuid: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    conv = _conv(db, user, conversation_uuid)
    rows = db.scalars(
        select(Run).where(Run.conversation_id == conv.id, Run.status.in_(["running", "awaiting_approval"])).order_by(Run.id)
    )
    return [
        {
            "uuid": r.uuid,
            "status": r.status,
            "model": r.model,
            "error": r.error,
            "created_at": service.iso(r.created_at),
            "finished_at": service.iso(r.finished_at),
        }
        for r in rows
    ]


@router.post("/conversations/{conversation_uuid}/runs/{run_uuid}/cancel", status_code=204)
async def cancel_run(conversation_uuid: str, run_uuid: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    conv = _conv(db, user, conversation_uuid)
    run = db.scalar(select(Run).where(Run.uuid == run_uuid, Run.conversation_id == conv.id))
    if not run:
        raise HTTPException(404, "Run not found")
    await runner.cancel(db, run)
    return Response(status_code=204)


@router.get("/conversations/{conversation_uuid}/pending")
def list_pending(conversation_uuid: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    conv = _conv(db, user, conversation_uuid)
    rows = db.scalars(
        select(PendingAction)
        .where(PendingAction.conversation_id == conv.id, PendingAction.status.in_(["pending", "resolving"]))
        .order_by(PendingAction.id)
    )
    return [{"uuid": p.uuid, "status": p.status, "action": p.actions, "allow_options": p.allow_options} for p in rows]


@router.post("/conversations/{conversation_uuid}/pending/{pending_uuid}/resume")
def resume(
    conversation_uuid: str,
    pending_uuid: str,
    body: ResumeIn,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    conv = _conv(db, user, conversation_uuid)
    p = db.scalar(select(PendingAction).where(PendingAction.uuid == pending_uuid, PendingAction.conversation_id == conv.id))
    if not p:
        raise HTTPException(404, "Pending action not found")
    if p.status != "pending":
        raise HTTPException(409, "This action is already being processed")
    run = db.scalar(select(Run).where(Run.uuid == p.run_uuid))
    if not run or run.status != "awaiting_approval":
        raise HTTPException(409, "The run is no longer waiting for approval")
    p.status = "resolving"
    p.decision = body.decision
    db.commit()
    allowed: dict[str, str] = {}
    if body.decision == "approve" and body.allow:
        names = [c["name"] for c in p.calls or [] if body.allow in (p.allow_options or {}).get(c["name"], [])]
        allowed = runner.record_allow(db, user.id, conv.id, sorted(set(names)), body.allow)
    runner.spawn(
        run.uuid,
        resume={
            "pending_uuid": p.uuid,
            "decision": body.decision,
            "edited_args": body.edited_args,
            "message": body.message,
        },
    )
    return {
        "conversation_uuid": conv.uuid,
        "pending_uuid": p.uuid,
        "decision": body.decision,
        "status": "resuming",
        "channel": ai_channel(user.id),
        "allowed": allowed,
    }


@router.post("/conversations/{conversation_uuid}/pending/{pending_uuid}/release", status_code=204)
def release(conversation_uuid: str, pending_uuid: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    conv = _conv(db, user, conversation_uuid)
    p = db.scalar(select(PendingAction).where(PendingAction.uuid == pending_uuid, PendingAction.conversation_id == conv.id))
    if not p:
        raise HTTPException(404, "Pending action not found")
    run = db.scalar(select(Run).where(Run.uuid == p.run_uuid))
    if p.status != "resolving" or (run and runner.TASKS.get(run.uuid)):
        raise HTTPException(409, "This action is not stranded")
    p.status = "pending"
    if run:
        run.status = "awaiting_approval"
        run.finished_at = None
    db.commit()
    return Response(status_code=204)


# ---------------------------------------------------------------- attachments


def _safe_name(name: str) -> str:
    name = Path(name or "attachment").name
    return re.sub(r"[^\w.\- ]", "_", name)[:120] or "attachment"


@router.post("/attachments")
async def upload_attachments(
    files: list[UploadFile] = File(...), db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    folder = settings.data_path / "attachments" / str(user.id)
    folder.mkdir(parents=True, exist_ok=True)
    out = []
    for f in files:
        data = await f.read()
        if len(data) > MAX_UPLOAD_BYTES:
            raise HTTPException(413, f"{f.filename} is larger than 20 MB")
        uid = str(uuid_lib.uuid4())
        filename = f.filename or "attachment"
        ct = f.content_type or mimetypes.guess_type(filename)[0] or "application/octet-stream"
        path = folder / f"{uid}_{_safe_name(filename)}"
        path.write_bytes(data)
        att = Attachment(uuid=uid, user_id=user.id, filename=filename, content_type=ct, file_size=len(data), path=str(path))
        db.add(att)
        out.append({"uuid": uid, "original_filename": filename, "content_type": ct, "file_size": len(data)})
    db.commit()
    return {"files": out}


@router.get("/files/{file_uuid}")
def get_file(file_uuid: str, sig: str = "", db: Session = Depends(get_db)):
    """Signed link (no Bearer): what `download_url` points at, so an <img> can load it."""
    if not sig or sig != service.file_signature(file_uuid):
        raise HTTPException(403, "Bad signature")
    att = db.scalar(select(Attachment).where(Attachment.uuid == file_uuid))
    if not att or not Path(att.path).exists():
        raise HTTPException(404, "File not found")
    return FileResponse(att.path, media_type=att.content_type, filename=att.filename)


# ---------------------------------------------------------------- misc


@router.get("/attention")
def attention(user: User = Depends(get_current_user)):
    return {"items": [], "meta": {"total": 0}}


integrations_router = APIRouter(prefix="/api/v1/integrations", tags=["integrations"])


@integrations_router.get("/connections")
async def connections(status: str | None = None, user: User = Depends(get_current_user)):
    state = await tools.connector_status(user.id)
    items = [
        {
            "uuid": cid,
            "provider_key": cid,
            "provider_display_name": label,
            "status": "active" if state.get(cid) else "disconnected",
        }
        for cid, label in tools.CONNECTORS.items()
    ]
    if status:
        items = [i for i in items if i["status"] == status]
    return {"items": items}
