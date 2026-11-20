"""Centrifugo v5: publish over the HTTP API, mint connection tokens.

The AI channel `ai:user-<id>` is a server-side subscription carried in the
connection token's `channels` claim, so the client never subscribes itself.
"""

import logging
import time

import httpx
import jwt
from fastapi import APIRouter, Depends

from app.auth import User, get_current_user
from app.config import settings

log = logging.getLogger("realtime")

_http: httpx.AsyncClient | None = None


def ai_channel(user_id: int) -> str:
    return f"ai:user-{user_id}"


def _client() -> httpx.AsyncClient:
    global _http
    if _http is None:
        _http = httpx.AsyncClient(
            timeout=httpx.Timeout(5.0),
            headers={"X-API-Key": settings.CENTRIFUGO_API_KEY},
        )
    return _http


async def publish(channel: str, data: dict) -> bool:
    url = settings.CENTRIFUGO_API_URL.rstrip("/") + "/publish"
    try:
        r = await _client().post(url, json={"channel": channel, "data": data})
        if r.status_code != 200:
            log.warning("centrifugo publish HTTP %s: %s", r.status_code, r.text[:300])
            return False
        body = r.json()
        if body.get("error"):
            log.warning("centrifugo publish error: %s", body["error"])
            return False
        return True
    except httpx.HTTPError as e:
        log.warning("centrifugo publish failed (%s): %s", type(e).__name__, e)
        return False


def connection_token(user_id: int, channels: list[str], ttl: int = 24 * 3600) -> str:
    now = int(time.time())
    claims = {"sub": str(user_id), "iat": now, "exp": now + ttl, "channels": channels}
    return jwt.encode(claims, settings.CENTRIFUGO_TOKEN_HMAC_SECRET_KEY, algorithm="HS256")


router = APIRouter(prefix="/api/v1/realtime", tags=["realtime"])


@router.get("/connection-token")
def get_connection_token(user: User = Depends(get_current_user)):
    channels = [ai_channel(user.id)]
    return {"token": connection_token(user.id, channels), "url": settings.CENTRIFUGO_PUBLIC_URL, "channels": channels}
