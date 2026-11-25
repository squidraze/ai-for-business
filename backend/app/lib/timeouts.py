"""A hard ceiling on how long one HTTP request may take.

Whatever hangs below (a provider that never answers, a dropped socket, a lock),
the client gets a clear 504 `request_timeout` within REQUEST_TIMEOUT_SECONDS
instead of waiting forever — so the app shows an error with Retry, never an
endless skeleton. Integrations should still set their own shorter timeouts and
map them to `<name>_unavailable`; this is the safety net.
"""

import asyncio
import json
import logging

from fastapi import FastAPI

from app.config import settings
from app.lib.errors import MESSAGES

log = logging.getLogger("app.timeouts")

# Requests that legitimately run longer (big uploads on slow networks).
EXEMPT_PREFIXES = ("/api/v1/ai/attachments",)


class RequestTimeoutMiddleware:
    """Pure ASGI (BaseHTTPMiddleware cannot interrupt the endpoint): runs the
    request as a task and, if no response has started within the limit, cancels
    it and answers 504 itself. A response already streaming is left alone."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        limit = settings.REQUEST_TIMEOUT_SECONDS
        if scope["type"] != "http" or limit <= 0 or scope["path"].startswith(EXEMPT_PREFIXES):
            await self.app(scope, receive, send)
            return

        started = False

        async def guarded_send(message):
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        task = asyncio.ensure_future(self.app(scope, receive, guarded_send))
        done, _ = await asyncio.wait({task}, timeout=limit)
        if task in done:
            task.result()  # re-raise whatever the app raised
            return
        if started:  # headers are out: let the body finish
            await task
            return
        task.cancel()
        log.warning("request timed out after %ss: %s %s", limit, scope.get("method"), scope["path"])
        body = json.dumps(
            {"detail": {"code": "request_timeout", "message": MESSAGES["request_timeout"], "field": None}}
        ).encode()
        await send({
            "type": "http.response.start",
            "status": 504,
            "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())],
        })
        await send({"type": "http.response.body", "body": body})


def install_request_timeout(app: FastAPI) -> None:
    app.add_middleware(RequestTimeoutMiddleware)
