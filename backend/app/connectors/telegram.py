"""Telegram connector: a real user account over MTProto (Telethon).

One connected TelegramClient per user is cached in memory. The same instance is used between
send_code and sign_in (Telegram ties the phone_code_hash to the auth key), and the
StringSession is also persisted right after send_code, so a backend restart in between still
works. All public functions take `user_id` and return plain JSON-able dicts/lists.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from sqlalchemy import select
from telethon import TelegramClient, errors as tg_errors, utils as tg_utils
from telethon.sessions import StringSession
from telethon.tl import types as tl

from app.config import settings
from app.connectors.errors import ConnectorError, NotConnected
from app.connectors.models import TelegramSession
from app.db import SessionLocal
from app.lib.user_data import on_user_delete

log = logging.getLogger("connectors.telegram")

NOT_CONNECTED = "Telegram is not connected"

_clients: dict[int, TelegramClient] = {}
_locks: dict[int, asyncio.Lock] = {}
# user_id -> {dialog_id: (title, entity)} — filled by list_dialogs, used to resolve chat ids/names
_dialogs: dict[int, dict[int, tuple[str, Any]]] = {}


# --------------------------------------------------------------------------- db helpers


def _row(user_id: int) -> TelegramSession | None:
    with SessionLocal() as db:
        return db.scalar(select(TelegramSession).where(TelegramSession.user_id == user_id))


def _upsert(user_id: int, **fields) -> None:
    with SessionLocal() as db:
        row = db.scalar(select(TelegramSession).where(TelegramSession.user_id == user_id))
        if row is None:
            row = TelegramSession(user_id=user_id)
            db.add(row)
        for k, v in fields.items():
            setattr(row, k, v)
        db.commit()


def _delete_row(user_id: int) -> None:
    with SessionLocal() as db:
        row = db.scalar(select(TelegramSession).where(TelegramSession.user_id == user_id))
        if row is not None:
            db.delete(row)
            db.commit()


def _lock(user_id: int) -> asyncio.Lock:
    lock = _locks.get(user_id)
    if lock is None:
        lock = _locks[user_id] = asyncio.Lock()
    return lock


# --------------------------------------------------------------------------- error mapping


def _map_error(e: Exception) -> Exception:
    if isinstance(e, ConnectorError):
        return e
    if isinstance(e, tg_errors.FloodWaitError):
        return ConnectorError(429, f"Too many requests to Telegram, wait {e.seconds} seconds")
    if isinstance(e, (tg_errors.PhoneCodeInvalidError, tg_errors.PhoneCodeEmptyError)):
        return ConnectorError(400, "Invalid code")
    if isinstance(e, tg_errors.PhoneCodeExpiredError):
        return ConnectorError(400, "The code has expired, request a new one")
    if isinstance(e, (tg_errors.PhoneNumberInvalidError, tg_errors.PhoneNumberUnoccupiedError)):
        return ConnectorError(400, "Invalid phone number")
    if isinstance(e, tg_errors.PhoneNumberBannedError):
        return ConnectorError(400, "This phone number is banned by Telegram")
    if isinstance(e, tg_errors.PasswordHashInvalidError):
        return ConnectorError(400, "Wrong password")
    if isinstance(e, (tg_errors.AuthKeyUnregisteredError, tg_errors.SessionRevokedError,
                      tg_errors.UserDeactivatedError, tg_errors.AuthKeyDuplicatedError)):
        return NotConnected(NOT_CONNECTED)
    if isinstance(e, (tg_errors.ChatWriteForbiddenError, tg_errors.ChatAdminRequiredError,
                      tg_errors.UserBannedInChannelError)):
        return ConnectorError(403, "You can't write to this chat")
    if isinstance(e, tg_errors.MessageIdInvalidError):
        return ConnectorError(400, "Invalid message id")
    if isinstance(e, tg_errors.SearchQueryEmptyError):
        return ConnectorError(400, "Search query is empty")
    if isinstance(e, (tg_errors.PeerIdInvalidError, tg_errors.ChannelPrivateError)):
        return ConnectorError(404, "Chat not found or not accessible")
    if isinstance(e, tg_errors.ApiIdInvalidError):
        return ConnectorError(503, "TELEGRAM_API_ID / TELEGRAM_API_HASH are invalid (check my.telegram.org)")
    if isinstance(e, tg_errors.RPCError):
        name = type(e).__name__
        if name.endswith("Error") and name not in ("RPCError", "BadRequestError"):
            name = name[:-5]
        else:
            name = e.message or name
        return ConnectorError(400, f"Telegram error: {name}")
    if isinstance(e, (ConnectionError, OSError, asyncio.TimeoutError)):
        return ConnectorError(503, "Can't reach Telegram, try again")
    return e


async def _guard(user_id: int, coro):
    """Await a Telethon coroutine, turning its errors into clean ConnectorErrors.
    A revoked session drops the cached client and the db row."""
    try:
        return await coro
    except Exception as e:  # noqa: BLE001
        mapped = _map_error(e)
        if isinstance(mapped, NotConnected):
            await _drop(user_id, delete=True)
        if mapped is e:
            raise
        raise mapped from e


# --------------------------------------------------------------------------- clients


def _new_client(session: str = "") -> TelegramClient:
    if not settings.TELEGRAM_API_ID or not settings.TELEGRAM_API_HASH:
        raise ConnectorError(503, "Telegram API credentials are not configured on the server "
                                  "(TELEGRAM_API_ID / TELEGRAM_API_HASH)")
    return TelegramClient(
        StringSession(session or None),
        int(settings.TELEGRAM_API_ID),
        settings.TELEGRAM_API_HASH,
        device_model="forBusiness",
        system_version="server",
        app_version="0.1",
        lang_code="en",
        system_lang_code="en",
    )


async def _drop(user_id: int, delete: bool = False) -> None:
    client = _clients.pop(user_id, None)
    _dialogs.pop(user_id, None)
    if client is not None:
        try:
            await client.disconnect()
        except Exception:  # noqa: BLE001
            pass
    if delete:
        _delete_row(user_id)


def _persist_session(user_id: int, client: TelegramClient) -> None:
    try:
        s = client.session.save()
    except Exception:  # noqa: BLE001
        return
    row = _row(user_id)
    if row is not None and s and row.session != s:
        _upsert(user_id, session=s)


async def _get_client(user_id: int, authorized: bool = True) -> TelegramClient:
    """Return the cached connected client, creating it from the stored StringSession."""
    async with _lock(user_id):
        client = _clients.get(user_id)
        if client is not None and not client.is_connected():
            try:
                await client.connect()
            except Exception as e:  # noqa: BLE001
                raise _map_error(e) from e
        if client is None:
            row = _row(user_id)
            if row is None or not row.session or (authorized and not row.authorized):
                raise NotConnected(NOT_CONNECTED)
            client = _new_client(row.session)
            try:
                await client.connect()
            except Exception as e:  # noqa: BLE001
                raise _map_error(e) from e
            _clients[user_id] = client
        if authorized:
            try:
                ok = await client.is_user_authorized()
            except Exception as e:  # noqa: BLE001
                raise _map_error(e) from e
            if not ok:
                await _drop(user_id, delete=True)
                raise NotConnected(NOT_CONNECTED)
            _persist_session(user_id, client)
        return client


def _account(me: Any) -> dict:
    return {
        "id": me.id,
        "first_name": getattr(me, "first_name", None),
        "last_name": getattr(me, "last_name", None),
        "username": getattr(me, "username", None),
        "phone": getattr(me, "phone", None),
    }


async def _finish_login(user_id: int, client: TelegramClient) -> dict:
    me = await client.get_me()
    account = _account(me)
    _upsert(user_id, session=client.session.save(), authorized=True, phone_code_hash=None,
            account=account, phone=account.get("phone"))
    return account


# --------------------------------------------------------------------------- login flow


async def send_code(user_id: int, phone: str) -> dict:
    phone = (phone or "").strip().replace(" ", "")
    if not phone:
        raise ConnectorError(400, "Phone is required")
    async with _lock(user_id):
        # a new login always starts from a clean session (drop any previous client; we don't
        # log the old one out — sign_in will replace it)
        old = _clients.pop(user_id, None)
        _dialogs.pop(user_id, None)
        if old is not None:
            try:
                await old.disconnect()
            except Exception:  # noqa: BLE001
                pass
        client = _new_client()
        try:
            await client.connect()
            sent = await client.send_code_request(phone)
        except Exception as e:  # noqa: BLE001
            try:
                await client.disconnect()
            except Exception:  # noqa: BLE001
                pass
            mapped = _map_error(e)
            if mapped is e:
                raise
            raise mapped from e
        _clients[user_id] = client
        _upsert(user_id, session=client.session.save(), phone=phone,
                phone_code_hash=sent.phone_code_hash, authorized=False, account=None)
        return {"phone_code_hash": sent.phone_code_hash}


async def sign_in(user_id: int, phone: str, code: str, phone_code_hash: str | None = None) -> dict:
    row = _row(user_id)
    if row is None or not row.session:
        raise ConnectorError(400, "Request a code first")
    phone = (phone or row.phone or "").strip().replace(" ", "")
    phone_code_hash = phone_code_hash or row.phone_code_hash
    code = (code or "").strip()
    if not code:
        raise ConnectorError(400, "Code is required")
    client = await _get_client(user_id, authorized=False)
    try:
        await client.sign_in(phone=phone, code=code, phone_code_hash=phone_code_hash)
    except tg_errors.SessionPasswordNeededError:
        _upsert(user_id, session=client.session.save())
        return {"status": "password_required"}
    except Exception as e:  # noqa: BLE001
        mapped = _map_error(e)
        if mapped is e:
            raise
        raise mapped from e
    account = await _guard(user_id, _finish_login(user_id, client))
    return {"status": "ok", "account": account}


async def check_password(user_id: int, password: str) -> dict:
    if not password:
        raise ConnectorError(400, "Password is required")
    row = _row(user_id)
    if row is None or not row.session:
        raise ConnectorError(400, "Request a code first")
    client = await _get_client(user_id, authorized=False)
    try:
        await client.sign_in(password=password)
    except Exception as e:  # noqa: BLE001
        mapped = _map_error(e)
        if mapped is e:
            raise
        raise mapped from e
    account = await _guard(user_id, _finish_login(user_id, client))
    return {"status": "ok", "account": account}


async def logout(user_id: int) -> None:
    row = _row(user_id)
    if row is None:
        return
    client = _clients.get(user_id)
    try:
        if client is None and row.session:
            client = _new_client(row.session)
            await client.connect()
        if client is not None and await client.is_user_authorized():
            await client.log_out()
    except Exception as e:  # noqa: BLE001
        log.warning("telegram logout for user %s failed: %s", user_id, e)
    await _drop(user_id, delete=True)


@on_user_delete
async def _delete_user_data(user_id: int) -> None:
    """Account deletion: log the session out of Telegram and drop it (best effort)."""
    await logout(user_id)


# --------------------------------------------------------------------------- read API


async def is_connected(user_id: int) -> bool:
    row = _row(user_id)
    return bool(row and row.authorized and row.session)


def account_summary(user_id: int) -> dict | None:
    row = _row(user_id)
    if row and row.authorized:
        return row.account
    return None


async def get_me(user_id: int) -> dict:
    client = await _get_client(user_id)
    me = await _guard(user_id, client.get_me())
    account = _account(me)
    _upsert(user_id, account=account)
    return account


def _dialog_type(entity: Any) -> str:
    if isinstance(entity, tl.User):
        return "bot" if entity.bot else "user"
    if isinstance(entity, tl.Channel):
        return "group" if entity.megagroup or entity.gigagroup else "channel"
    return "group"


def _media_kind(msg: Any) -> str | None:
    if msg is None or not getattr(msg, "media", None):
        return None
    if msg.photo:
        return "photo"
    if msg.sticker:
        return "sticker"
    if msg.voice:
        return "voice"
    if msg.video or msg.video_note or msg.gif:
        return "video"
    if msg.document or msg.audio:
        return "document"
    return None


def _message_text(msg: Any) -> str:
    text = getattr(msg, "message", None) or ""
    if not text and isinstance(msg, tl.MessageService):
        text = f"[{type(msg.action).__name__.replace('MessageAction', '')}]"
    return text


def _message(msg: Any, chat_title: str | None = None) -> dict:
    sender = getattr(msg, "sender", None)
    sender_name = tg_utils.get_display_name(sender) if sender is not None else None
    if not sender_name:
        chat = getattr(msg, "chat", None)
        sender_name = (tg_utils.get_display_name(chat) if chat is not None else None) or chat_title
    reply_to = getattr(msg, "reply_to", None)
    return {
        "id": msg.id,
        "text": _message_text(msg),
        "date": msg.date.isoformat() if msg.date else None,
        "out": bool(msg.out),
        "sender_id": msg.sender_id,
        "sender_name": sender_name,
        "reply_to_id": getattr(reply_to, "reply_to_msg_id", None) if reply_to else None,
        "media": _media_kind(msg),
    }


def _last_message(msg: Any) -> dict | None:
    if msg is None:
        return None
    text = _message_text(msg)
    if not text:
        kind = _media_kind(msg)
        text = f"[{kind}]" if kind else ""
    return {"id": msg.id, "text": text, "date": msg.date.isoformat() if msg.date else None,
            "out": bool(msg.out)}


async def _load_dialogs(user_id: int, client: TelegramClient, limit: int) -> list[Any]:
    dialogs = await _guard(user_id, client.get_dialogs(limit=limit))
    cache = _dialogs.setdefault(user_id, {})
    for d in dialogs:
        cache[d.id] = (d.name or "", d.entity)
    return dialogs


async def list_dialogs(user_id: int, limit: int = 50, query: str | None = None) -> list[dict]:
    client = await _get_client(user_id)
    limit = max(1, min(int(limit or 50), 200))
    q = (query or "").strip().lower()
    dialogs = await _load_dialogs(user_id, client, 200 if q else limit)
    out = []
    for d in dialogs:
        if q:
            uname = (getattr(d.entity, "username", None) or "").lower()
            if q not in (d.name or "").lower() and q.lstrip("@") not in uname:
                continue
        out.append({
            "id": str(d.id),
            "title": d.name or "",
            "type": _dialog_type(d.entity),
            "unread_count": d.unread_count or 0,
            "pinned": bool(d.pinned),
            "last_message": _last_message(d.message),
        })
        if len(out) >= limit:
            break
    return out


def _match_title(cache: dict[int, tuple[str, Any]], name: str) -> Any | None:
    n = name.strip().lower()
    for title, entity in cache.values():
        if title.lower() == n:
            return entity
    for title, entity in cache.values():
        if (getattr(entity, "username", None) or "").lower() == n.lstrip("@"):
            return entity
    for title, entity in cache.values():
        if n in title.lower():
            return entity
    return None


async def _resolve(user_id: int, client: TelegramClient, chat_id: str) -> tuple[Any, str]:
    """chat_id: numeric (marked) id string, '@username', 'me', or a dialog title (fragment)."""
    raw = str(chat_id or "").strip()
    if not raw:
        raise ConnectorError(400, "chat_id is required")
    if raw.lower() in ("me", "self", "saved", "saved messages"):
        me = await _guard(user_id, client.get_me())
        return me, "Saved Messages"
    cache = _dialogs.get(user_id)

    if raw.lstrip("-").isdigit():
        pid = int(raw)
        if not cache or pid not in cache:
            await _load_dialogs(user_id, client, 200)
            cache = _dialogs.get(user_id) or {}
        if pid in cache:
            return cache[pid][1], cache[pid][0]
        try:
            entity = await client.get_entity(pid)
        except Exception as e:  # noqa: BLE001
            raise ConnectorError(404, f"Chat {raw} not found") from e
        return entity, tg_utils.get_display_name(entity)

    if raw.startswith("@"):
        try:
            entity = await client.get_entity(raw)
        except tg_errors.FloodWaitError as e:
            raise _map_error(e) from e
        except Exception as e:  # noqa: BLE001
            raise ConnectorError(404, f"Chat {raw} not found") from e
        return entity, tg_utils.get_display_name(entity)

    entity = _match_title(cache, raw) if cache else None
    if entity is None:
        await _load_dialogs(user_id, client, 200)
        entity = _match_title(_dialogs.get(user_id) or {}, raw)
    if entity is None:
        raise ConnectorError(404, f"Chat '{raw}' not found")
    return entity, tg_utils.get_display_name(entity)


async def get_messages(user_id: int, chat_id: str, limit: int = 50, offset_id: int | None = None) -> list[dict]:
    client = await _get_client(user_id)
    entity, title = await _resolve(user_id, client, chat_id)
    limit = max(1, min(int(limit or 50), 200))
    msgs = await _guard(user_id, client.get_messages(entity, limit=limit, offset_id=int(offset_id or 0)))
    return [_message(m, title) for m in msgs]


async def send_message(user_id: int, chat_id: str, text: str, reply_to_id: int | None = None) -> dict:
    if not (text or "").strip():
        raise ConnectorError(400, "Message text is empty")
    client = await _get_client(user_id)
    entity, title = await _resolve(user_id, client, chat_id)
    msg = await _guard(user_id, client.send_message(entity, text, reply_to=int(reply_to_id) if reply_to_id else None))
    out = _message(msg, title)
    out["chat_id"] = str(tg_utils.get_peer_id(entity))
    out["chat_title"] = title
    return out


async def mark_read(user_id: int, chat_id: str) -> None:
    client = await _get_client(user_id)
    entity, _ = await _resolve(user_id, client, chat_id)
    await _guard(user_id, client.send_read_acknowledge(entity))


async def search_messages(user_id: int, query: str, chat_id: str | None = None, limit: int = 30) -> list[dict]:
    q = (query or "").strip()
    if not q:
        raise ConnectorError(400, "Search query is empty")
    client = await _get_client(user_id)
    limit = max(1, min(int(limit or 30), 100))
    if chat_id:
        entity, title = await _resolve(user_id, client, chat_id)
        msgs = await _guard(user_id, client.get_messages(entity, search=q, limit=limit))
        cid = str(tg_utils.get_peer_id(entity))
        return [{**_message(m, title), "chat_id": cid, "chat_title": title} for m in msgs]

    msgs = await _guard(user_id, client.get_messages(None, search=q, limit=limit))
    out = []
    for m in msgs:
        chat = getattr(m, "chat", None)
        title = tg_utils.get_display_name(chat) if chat is not None else ""
        out.append({**_message(m, title), "chat_id": str(m.chat_id), "chat_title": title})
    return out


async def get_photo(user_id: int, chat_id: str) -> bytes | None:
    client = await _get_client(user_id)
    entity, _ = await _resolve(user_id, client, chat_id)
    try:
        data = await client.download_profile_photo(entity, file=bytes, download_big=False)
    except tg_errors.FloodWaitError as e:
        raise _map_error(e) from e
    except Exception as e:  # noqa: BLE001
        log.info("telegram photo for %s failed: %s", chat_id, e)
        return None
    return data or None


async def shutdown() -> None:
    """Disconnect every cached client (call from app shutdown if wanted)."""
    for uid in list(_clients):
        await _drop(uid)
