"""The in-process scheduler: one asyncio task on the app's event loop (single process).

Every SCHEDULER_TICK_SECONDS it fires enabled schedules whose next_run_at has
passed. The next fire time is committed together with the fire, so a crash
can lose a run but never fire one twice.

Missed runs while the server was down: a schedule whose next_run_at is in the
past fires once on the first tick after startup (at most one catch-up per
schedule, however many occurrences were missed); its next run is then planned
from "now", i.e. the next future occurrence.
"""

import asyncio
import logging
from datetime import datetime

from app.ai.models import utcnow
from app.config import settings
from app.db import SessionLocal
from app.schedules import service

log = logging.getLogger("schedules.scheduler")

_task: asyncio.Task | None = None


def tick(now: datetime | None = None) -> int:
    """Fire every due schedule once. Returns how many fired (skips included)."""
    now = now or utcnow()
    fired = 0
    with SessionLocal() as db:
        for s in service.due(db, now):
            try:
                service.fire(db, s, "schedule", now)
                fired += 1
            except Exception:
                log.exception("schedule %s failed to fire", s.uuid)
                db.rollback()
    return fired


async def _loop() -> None:
    try:
        n = service.reconcile()
        if n:
            log.info("reconciled %s unfinished schedule runs", n)
    except Exception:
        log.exception("schedule reconcile failed")
    while True:
        try:
            tick()
            service.reconcile()
        except Exception:
            log.exception("scheduler tick failed")
        await asyncio.sleep(max(1, settings.SCHEDULER_TICK_SECONDS))


def start() -> None:
    """Call from the app's startup, on the running loop."""
    global _task
    if _task is None or _task.done():
        _task = asyncio.get_running_loop().create_task(_loop())
        log.info("scheduler started (tick %ss)", settings.SCHEDULER_TICK_SECONDS)


async def stop() -> None:
    global _task
    if _task is not None:
        _task.cancel()
        try:
            await _task
        except (asyncio.CancelledError, Exception):
            pass
        _task = None
