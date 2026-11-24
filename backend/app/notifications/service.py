"""Fan a notification out to every device of a user, in the background."""

import asyncio
import logging
from typing import Callable

from sqlalchemy import delete, select

from app.db import SessionLocal
from app.lib.user_data import on_user_delete
from app.notifications import fcm
from app.notifications.models import PushDevice

log = logging.getLogger("notifications")

# texts(lang) -> (title, body); lang is "en" | "ru" | "uz"
Texts = Callable[[str], tuple[str, str]]

_BACKGROUND: set[asyncio.Task] = set()


def language(locale: str | None) -> str:
    """"ru-RU" -> "ru"; a language we don't translate -> "en"."""
    lang = (locale or "en").replace("_", "-").split("-")[0].lower()
    return lang if lang in ("en", "ru", "uz") else "en"


def notify_user(user_id: int, texts: Texts, data: dict, channel_id: str = "default") -> None:
    """Fire-and-forget: schedules the send on the running loop and returns at once.
    Failures are logged, never raised to the caller."""
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        log.warning("notify_user called outside the event loop; dropped (user=%s)", user_id)
        return
    task = loop.create_task(_send_all(user_id, texts, data, channel_id))
    _BACKGROUND.add(task)
    task.add_done_callback(_BACKGROUND.discard)


async def _send_all(user_id: int, texts: Texts, data: dict, channel_id: str) -> None:
    try:
        with SessionLocal() as db:
            devices = [
                (d.id, d.token, d.locale) for d in db.scalars(select(PushDevice).where(PushDevice.user_id == user_id))
            ]
        if not fcm.configured():
            title, body = texts(language(devices[0][2]) if devices else "en")
            log.warning(
                "[dev push] user=%s devices=%s title=%s body=%s data=%s", user_id, len(devices), title, body, data
            )
            return
        dead: list[int] = []
        for dev_id, token, locale in devices:
            title, body = texts(language(locale))
            if await fcm.send(token, title, body, data, channel_id) == "dead_token":
                dead.append(dev_id)
        if dead:
            with SessionLocal() as db:
                db.execute(delete(PushDevice).where(PushDevice.id.in_(dead)))
                db.commit()
    except Exception:
        log.exception("push to user %s failed", user_id)


def last_device_timezone(user_id: int) -> str | None:
    with SessionLocal() as db:
        return db.scalar(
            select(PushDevice.timezone)
            .where(PushDevice.user_id == user_id, PushDevice.timezone.is_not(None))
            .order_by(PushDevice.last_seen_at.desc())
            .limit(1)
        )


@on_user_delete
def delete_user_devices(user_id: int) -> None:
    with SessionLocal() as db:
        db.execute(delete(PushDevice).where(PushDevice.user_id == user_id))
        db.commit()
