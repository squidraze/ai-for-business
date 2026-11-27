"""The contract every integration fulfils, plus helpers shared by all of them.

An integration package (`app/integrations/<name>/`) exposes one `Integration`
object as `integration` in its `__init__.py`, and the registry
(`app/integrations/__init__.py`) lists it. Everything else in the app (main.py,
db.py, the AI runner and tools) reads integrations only through the registry.
"""

import asyncio
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Awaitable, Callable

import httpx
from fastapi import APIRouter, Depends

if TYPE_CHECKING:  # app.ai.tools imports the registry lazily; avoid a cycle at import time
    from app.ai.tools import Tool


@dataclass(frozen=True)
class DemoCall:
    """A canned tool call for the fake model (`AI_FAKE=1`), so the pipeline can be tried without a key.

    `args` gets the text the user typed after the command (may be empty)."""

    intro: str
    tool: str
    args: Callable[[str], dict] = lambda _text: {}


@dataclass(frozen=True)
class Integration:
    # Stable id: the `connector` of its tools, the key in `disabled_connectors`,
    # `provider_key` in /integrations/connections and `id` in GET /connectors.
    id: str
    title: str
    # Is this user connected? Must not raise for a plain "no"; an exception counts as not connected.
    is_connected: Callable[[int], Awaitable[bool]]
    # Small JSON-able account info for the Connectors screen, or None when not connected.
    account_summary: Callable[[int], dict | None]
    router: APIRouter | None = None
    tools: list["Tool"] = field(default_factory=list)

    # System prompt snippets, assembled by app.ai.runner. All optional.
    prompt_scope: str = ""  # what the assistant can read, e.g. "their Telegram chats"
    prompt_actions: str = ""  # what it can do for the user, e.g. "send Telegram messages"
    prompt_hint: str = ""  # one or two sentences on how to use the tools well
    prompt_approval: str = ""  # what needs approval, e.g. "sending a Telegram message"

    # Fake-model demo calls (see DemoCall); the first integration that defines one is used.
    demo_tool: DemoCall | None = None  # a plain tool call ("/tool")
    demo_approval: DemoCall | None = None  # a gated call that shows an approval card ("/hitl")

    on_startup: Callable[[], Awaitable[None]] | None = None
    on_shutdown: Callable[[], Awaitable[None]] | None = None

    async def status(self, user_id: int) -> bool:
        return bool(await self.is_connected(user_id))


# --------------------------------------------------------------------------- shared helpers


def utcnow() -> datetime:
    """Default for `updated_at` columns of integration tables."""
    return datetime.now(timezone.utc)


class UserLocks:
    """One asyncio.Lock per user id (token refresh, client creation, login steps)."""

    def __init__(self) -> None:
        self._locks: dict[int, asyncio.Lock] = {}

    def __call__(self, user_id: int) -> asyncio.Lock:
        lock = self._locks.get(user_id)
        if lock is None:
            lock = self._locks[user_id] = asyncio.Lock()
        return lock


def http_client(timeout: float) -> httpx.AsyncClient:
    """An httpx client for a provider API. `timeout` is required: no external call may hang."""
    return httpx.AsyncClient(timeout=timeout)


def summary_router(integrations: list[Integration]) -> APIRouter:
    """GET /api/v1/connectors — connection state and account of every integration, in registry order."""
    from app.auth import User, get_current_user

    router = APIRouter(prefix="/api/v1/connectors", tags=["connectors"])

    @router.get("")
    async def connectors_summary(user: User = Depends(get_current_user)):
        return [
            {"id": i.id, "connected": await i.is_connected(user.id), "account": i.account_summary(user.id)}
            for i in integrations
        ]

    return router
