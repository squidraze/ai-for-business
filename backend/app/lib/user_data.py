"""Account deletion hooks.

A module that keeps per-user state outside plain `user_id` rows (files, live
clients, rows keyed by a parent id) registers a cleanup with `@on_user_delete`.
The auth service runs every hook, then sweeps all tables with a `user_id`
column, then deletes the user. Hooks are best-effort: errors are logged.
"""

import inspect
import logging
from typing import Any, Callable

from sqlalchemy import delete
from sqlalchemy.orm import Session

log = logging.getLogger("app.user_data")

_hooks: list[Callable[[int], Any]] = []


def on_user_delete(fn: Callable[[int], Any]) -> Callable[[int], Any]:
    """Register `fn(user_id)` (sync or async) to run before a user is deleted."""
    if fn not in _hooks:
        _hooks.append(fn)
    return fn


async def run_user_delete_hooks(user_id: int) -> None:
    for fn in list(_hooks):
        try:
            result = fn(user_id)
            if inspect.isawaitable(result):
                await result
        except Exception:  # noqa: BLE001
            log.exception("user delete hook %s failed for user %s", getattr(fn, "__qualname__", fn), user_id)


def purge_user_rows(db: Session, user_id: int) -> None:
    """Delete rows of every table that has a `user_id` column (children first). No commit."""
    from app.db import Base

    for table in reversed(Base.metadata.sorted_tables):
        if table.name != "users" and "user_id" in table.c:
            db.execute(delete(table).where(table.c.user_id == user_id))
