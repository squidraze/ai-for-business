"""Firebase Cloud Messaging, HTTP v1 API, called directly (no Expo push service).

Docs: https://firebase.google.com/docs/cloud-messaging/send/v1-api
      https://firebase.google.com/docs/reference/fcm/rest/v1/ErrorCode
      https://firebase.google.com/docs/cloud-messaging/manage-tokens

POST https://fcm.googleapis.com/v1/projects/{project}/messages:send
body {"message": {token, notification{title, body}, data{str: str}, android{priority, notification{channel_id}}}}
OAuth scope https://www.googleapis.com/auth/firebase.messaging (service account).
A token is dropped on UNREGISTERED (404) or INVALID_ARGUMENT (400): our payload
shape is fixed and small, so INVALID_ARGUMENT here means a malformed/foreign token.
"""

import asyncio
import logging
import threading

import httpx

from app.config import settings

log = logging.getLogger("notifications.fcm")

SCOPE = "https://www.googleapis.com/auth/firebase.messaging"
DEAD_TOKEN_CODES = {"UNREGISTERED", "INVALID_ARGUMENT"}

_creds = None
_lock = threading.Lock()


def configured() -> bool:
    return bool(settings.FCM_PROJECT_ID and settings.FCM_SERVICE_ACCOUNT_FILE)


def _access_token() -> str:
    """Blocking (may refresh over the network): call it in a worker thread."""
    global _creds
    from google.auth.transport.requests import Request
    from google.oauth2 import service_account

    with _lock:
        if _creds is None:
            _creds = service_account.Credentials.from_service_account_file(
                str(settings.fcm_service_account_path), scopes=[SCOPE]
            )
        if not _creds.valid:
            _creds.refresh(Request())
        return _creds.token


def build_message(token: str, title: str, body: str, data: dict, channel_id: str) -> dict:
    return {
        "message": {
            "token": token,
            "notification": {"title": title, "body": body},
            # FCM data is map<string, string>
            "data": {str(k): "" if v is None else str(v) for k, v in data.items()},
            "android": {"priority": "HIGH", "notification": {"channel_id": channel_id}},
        }
    }


def _error_code(resp: httpx.Response) -> str:
    """FcmError.errorCode from error.details if present, else error.status."""
    try:
        err = resp.json().get("error") or {}
    except ValueError:
        return f"HTTP_{resp.status_code}"
    for d in err.get("details") or []:
        if isinstance(d, dict) and d.get("errorCode"):
            return str(d["errorCode"])
    return str(err.get("status") or f"HTTP_{resp.status_code}")


async def send(token: str, title: str, body: str, data: dict, channel_id: str) -> str:
    """Send one message. Returns "ok", "dead_token" (the caller deletes it) or "error". Never raises."""
    try:
        access = await asyncio.to_thread(_access_token)
        url = f"https://fcm.googleapis.com/v1/projects/{settings.FCM_PROJECT_ID}/messages:send"
        async with httpx.AsyncClient(timeout=httpx.Timeout(15.0, connect=10.0)) as client:
            resp = await client.post(
                url,
                json=build_message(token, title, body, data, channel_id),
                headers={"Authorization": f"Bearer {access}"},
            )
        if resp.status_code == 200:
            return "ok"
        code = _error_code(resp)
        if code in DEAD_TOKEN_CODES or resp.status_code == 404:
            log.info("fcm: dropping token ...%s (%s)", token[-8:], code)
            return "dead_token"
        log.warning("fcm send failed: %s %s %s", resp.status_code, code, resp.text[:300])
        return "error"
    except Exception:
        log.exception("fcm send failed")
        return "error"
