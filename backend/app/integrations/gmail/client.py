"""Gmail integration client: Google OAuth 2 web flow + Gmail REST API.

Talks to Google over httpx directly (async, no google client libraries needed): the auth URL
and the token exchange/refresh are plain OAuth 2 endpoints, and the Gmail API is JSON over
HTTPS. Tokens (incl. refresh_token) live in GmailCredential.token and are refreshed on use.
"""

from __future__ import annotations

import asyncio
import base64
import html as html_lib
import logging
import re
import time
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from email.utils import getaddresses, parseaddr, parsedate_to_datetime
from urllib.parse import urlencode

import httpx
import jwt
from sqlalchemy import select

from app.config import settings
from app.db import SessionLocal
from app.integrations.base import UserLocks, http_client
from app.integrations.errors import IntegrationError, NotConnected, common_messages, register_messages
from app.integrations.gmail.models import GmailCredential

log = logging.getLogger("integrations.gmail")

ID = "gmail"
NOT_CONNECTED = "Gmail is not connected"
AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
REVOKE_URL = "https://oauth2.googleapis.com/revoke"
API = "https://gmail.googleapis.com/gmail/v1/users/me"
SCOPES = [
    "openid",
    "email",
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/gmail.send",
]
APP_REDIRECT = "forbusiness://connectors"
STATE_TTL = timedelta(minutes=15)

register_messages({
    **common_messages(ID, "Gmail"),
    "gmail_state_expired": "The sign-in link has expired, start again from the app",
    "gmail_invalid_state": "Invalid OAuth state",
    "gmail_auth_failed": "Google refused the sign-in",
    "gmail_recipient_required": "Recipient address is required",
    "gmail_empty_message": "Reply text is empty",
})

_lock = UserLocks()


def _err(status_code: int, code: str, message: str) -> IntegrationError:
    return IntegrationError(status_code, f"{ID}_{code}", message)


def _not_connected() -> NotConnected:
    return NotConnected(ID, NOT_CONNECTED)


def redirect_uri() -> str:
    base = (getattr(settings, "BACKEND_PUBLIC_URL", "") or "http://localhost:8000").rstrip("/")
    return f"{base}/api/v1/connectors/gmail/callback"


def _require_config() -> None:
    if not settings.GOOGLE_CLIENT_ID or not settings.GOOGLE_CLIENT_SECRET:
        raise _err(503, "not_configured", "Google OAuth is not configured on the server "
                                          "(GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)")


# --------------------------------------------------------------------------- db


def _row(user_id: int) -> GmailCredential | None:
    with SessionLocal() as db:
        return db.scalar(select(GmailCredential).where(GmailCredential.user_id == user_id))


def _save(user_id: int, token: dict, email: str | None = None) -> None:
    with SessionLocal() as db:
        row = db.scalar(select(GmailCredential).where(GmailCredential.user_id == user_id))
        if row is None:
            row = GmailCredential(user_id=user_id, token={})
            db.add(row)
        merged = dict(row.token or {})
        merged.update({k: v for k, v in token.items() if v is not None})
        row.token = merged
        if email:
            row.email = email
        db.commit()


def _delete(user_id: int) -> None:
    with SessionLocal() as db:
        row = db.scalar(select(GmailCredential).where(GmailCredential.user_id == user_id))
        if row is not None:
            db.delete(row)
            db.commit()


# --------------------------------------------------------------------------- OAuth


def make_state(user_id: int) -> str:
    now = datetime.now(timezone.utc)
    return jwt.encode({"sub": str(user_id), "purpose": "gmail_oauth", "iat": now, "exp": now + STATE_TTL},
                      settings.JWT_SECRET, algorithm="HS256")


def read_state(state: str) -> int:
    try:
        payload = jwt.decode(state, settings.JWT_SECRET, algorithms=["HS256"])
    except jwt.ExpiredSignatureError as e:
        raise _err(400, "state_expired", "The sign-in link has expired, start again from the app") from e
    except jwt.PyJWTError as e:
        raise _err(400, "invalid_state", "Invalid OAuth state") from e
    if payload.get("purpose") != "gmail_oauth":
        raise _err(400, "invalid_state", "Invalid OAuth state")
    return int(payload["sub"])


def auth_url(user_id: int) -> str:
    _require_config()
    params = {
        "client_id": settings.GOOGLE_CLIENT_ID,
        "redirect_uri": redirect_uri(),
        "response_type": "code",
        "scope": " ".join(SCOPES),
        "access_type": "offline",
        "prompt": "consent",
        "include_granted_scopes": "true",
        "state": make_state(user_id),
    }
    return f"{AUTH_URL}?{urlencode(params)}"


def _token_from_response(data: dict) -> dict:
    return {
        "access_token": data.get("access_token"),
        "refresh_token": data.get("refresh_token"),
        "expires_at": int(time.time()) + int(data.get("expires_in") or 3600),
        "scope": data.get("scope"),
        "token_type": data.get("token_type"),
    }


async def handle_callback(code: str, state: str) -> int:
    """Exchange the code, store tokens and the account email. Returns the user id."""
    _require_config()
    user_id = read_state(state)
    async with http_client(20) as http:
        try:
            r = await http.post(TOKEN_URL, data={
                "code": code,
                "client_id": settings.GOOGLE_CLIENT_ID,
                "client_secret": settings.GOOGLE_CLIENT_SECRET,
                "redirect_uri": redirect_uri(),
                "grant_type": "authorization_code",
            })
        except httpx.HTTPError as e:
            raise _err(503, "unavailable", "Can't reach Google, try again") from e
        if r.status_code != 200:
            log.warning("gmail token exchange failed: %s %s", r.status_code, r.text[:500])
            raise _err(400, "auth_failed", f"Google refused the sign-in: {_google_error(r)}")
        token = _token_from_response(r.json())
        if not token.get("refresh_token"):
            log.warning("gmail: no refresh_token returned for user %s", user_id)
        try:
            p = await http.get(f"{API}/profile", headers={"Authorization": f"Bearer {token['access_token']}"})
            email = p.json().get("emailAddress") if p.status_code == 200 else None
        except (httpx.HTTPError, ValueError):
            email = None  # get_profile fetches it later
    _save(user_id, token, email)
    return user_id


def _google_error(r: httpx.Response) -> str:
    try:
        data = r.json()
    except ValueError:
        return r.text[:200] or f"HTTP {r.status_code}"
    err = data.get("error")
    if isinstance(err, dict):
        return err.get("message") or str(err.get("status") or r.status_code)
    return data.get("error_description") or str(err or r.status_code)


async def _access_token(user_id: int, force_refresh: bool = False) -> str:
    async with _lock(user_id):
        row = _row(user_id)
        if row is None or not (row.token or {}).get("access_token"):
            raise _not_connected()
        token = dict(row.token)
        if not force_refresh and int(token.get("expires_at") or 0) - 60 > time.time():
            return token["access_token"]
        if not token.get("refresh_token"):
            if force_refresh:
                _delete(user_id)
                raise _not_connected()
            return token["access_token"]
        _require_config()
        try:
            async with http_client(20) as http:
                r = await http.post(TOKEN_URL, data={
                    "client_id": settings.GOOGLE_CLIENT_ID,
                    "client_secret": settings.GOOGLE_CLIENT_SECRET,
                    "refresh_token": token["refresh_token"],
                    "grant_type": "refresh_token",
                })
        except httpx.HTTPError as e:
            raise _err(503, "unavailable", "Can't reach Google, try again") from e
        if r.status_code != 200:
            log.warning("gmail refresh failed for user %s: %s %s", user_id, r.status_code, r.text[:300])
            if r.status_code in (400, 401):  # invalid_grant: revoked / expired refresh token
                _delete(user_id)
                raise _not_connected()
            raise _err(503, "unavailable", "Can't reach Google, try again")
        new = _token_from_response(r.json())
        _save(user_id, new)
        return new["access_token"]


async def _api(user_id: int, method: str, path: str, *, params: dict | None = None,
               json: dict | None = None, http: httpx.AsyncClient | None = None) -> dict:
    own = http is None
    http = http or http_client(30)
    try:
        for attempt in (0, 1):
            token = await _access_token(user_id, force_refresh=attempt == 1)
            try:
                r = await http.request(method, f"{API}{path}", params=params, json=json,
                                       headers={"Authorization": f"Bearer {token}"})
            except httpx.HTTPError as e:
                raise _err(503, "unavailable", "Can't reach Gmail, try again") from e
            if r.status_code == 401 and attempt == 0:
                continue
            if r.status_code == 401:
                _delete(user_id)
                raise _not_connected()
            if r.status_code == 404:
                raise _err(404, "not_found", "Not found in Gmail")
            if r.status_code == 429:
                raise _err(429, "rate_limited", "Gmail rate limit, try again in a moment")
            if r.status_code >= 400:
                raise (_err(400, "invalid_request", f"Gmail error: {_google_error(r)}") if r.status_code < 500
                       else _err(502, "unavailable", f"Gmail error: {_google_error(r)}"))
            return r.json() if r.content else {}
        raise _not_connected()
    finally:
        if own:
            await http.aclose()


# --------------------------------------------------------------------------- public API


async def is_connected(user_id: int) -> bool:
    row = _row(user_id)
    return bool(row and (row.token or {}).get("access_token"))


def account_summary(user_id: int) -> dict | None:
    row = _row(user_id)
    if row and (row.token or {}).get("access_token"):
        return {"email": row.email}
    return None


async def get_profile(user_id: int) -> dict:
    row = _row(user_id)
    if row is None:
        raise _not_connected()
    if row.email:
        return {"email": row.email}
    data = await _api(user_id, "GET", "/profile")
    email = data.get("emailAddress")
    if email:
        _save(user_id, {}, email)
    return {"email": email}


async def disconnect(user_id: int) -> None:
    row = _row(user_id)
    if row is None:
        return
    tok = (row.token or {}).get("refresh_token") or (row.token or {}).get("access_token")
    if tok:
        try:
            async with http_client(10) as http:
                await http.post(REVOKE_URL, data={"token": tok})
        except httpx.HTTPError:
            pass
    _delete(user_id)


def _headers(msg: dict) -> dict[str, str]:
    return {h["name"].lower(): h["value"] for h in (msg.get("payload") or {}).get("headers") or []}


def _iso_date(msg: dict) -> str | None:
    ms = msg.get("internalDate")
    if ms:
        return datetime.fromtimestamp(int(ms) / 1000, tz=timezone.utc).isoformat()
    d = _headers(msg).get("date")
    if d:
        try:
            return parsedate_to_datetime(d).isoformat()
        except (TypeError, ValueError):
            return None
    return None


async def list_threads(user_id: int, q: str | None = None, max_results: int = 20,
                       page_token: str | None = None, label: str | None = "INBOX") -> dict:
    params: dict = {"maxResults": max(1, min(int(max_results or 20), 50))}
    if q:
        params["q"] = q
    if page_token:
        params["pageToken"] = page_token
    if label:
        params["labelIds"] = label
    async with http_client(30) as http:
        data = await _api(user_id, "GET", "/threads", params=params, http=http)
        ids = [t["id"] for t in data.get("threads") or []]
        sem = asyncio.Semaphore(10)

        async def one(tid: str) -> dict | None:
            async with sem:
                try:
                    return await _api(user_id, "GET", f"/threads/{tid}", http=http, params={
                        "format": "metadata", "metadataHeaders": ["Subject", "From", "To", "Date"]})
                except IntegrationError as e:
                    if isinstance(e, NotConnected):
                        raise
                    log.info("gmail thread %s metadata failed: %s", tid, e)
                    return None

        threads = await asyncio.gather(*(one(t) for t in ids))
    items = []
    for t in threads:
        if not t or not t.get("messages"):
            continue
        msgs = t["messages"]
        first, last = _headers(msgs[0]), _headers(msgs[-1])
        # show the latest message that isn't ours as "from", like Gmail does
        incoming = [m for m in msgs if "SENT" not in (m.get("labelIds") or [])]
        sender = _headers(incoming[-1]).get("from") if incoming else last.get("from")
        items.append({
            "id": t["id"],
            "subject": first.get("subject") or "(no subject)",
            "from": sender or "",
            "snippet": html_lib.unescape(msgs[-1].get("snippet") or t.get("snippet") or ""),
            "date": _iso_date(msgs[-1]),
            "unread": any("UNREAD" in (m.get("labelIds") or []) for m in msgs),
            "message_count": len(msgs),
        })
    return {"items": items, "next_page_token": data.get("nextPageToken")}


def _b64decode(data: str) -> bytes:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))


def _part_text(part: dict) -> str:
    body = part.get("body") or {}
    if not body.get("data"):
        return ""
    raw = _b64decode(body["data"])
    charset = "utf-8"
    for h in part.get("headers") or []:
        if h["name"].lower() == "content-type":
            m = re.search(r'charset="?([\w-]+)"?', h["value"], re.I)
            if m:
                charset = m.group(1)
    try:
        return raw.decode(charset, errors="replace")
    except LookupError:
        return raw.decode("utf-8", errors="replace")


def _strip_html(s: str) -> str:
    s = re.sub(r"(?is)<(script|style|head)[^>]*>.*?</\1>", "", s)
    s = re.sub(r"(?i)<br\s*/?>", "\n", s)
    s = re.sub(r"(?i)</(p|div|tr|li|h\d|table|blockquote)>", "\n", s)
    s = re.sub(r"<[^>]+>", "", s)
    s = html_lib.unescape(s)
    s = re.sub(r"[ \t\r\f\v]+", " ", s)
    s = re.sub(r"\n\s*\n\s*\n+", "\n\n", s)
    return s.strip()


def _body_text(payload: dict) -> str:
    plain: list[str] = []
    html: list[str] = []

    def walk(p: dict) -> None:
        mime = (p.get("mimeType") or "").lower()
        if p.get("filename"):  # attachment
            return
        if mime == "text/plain":
            plain.append(_part_text(p))
        elif mime == "text/html":
            html.append(_part_text(p))
        for sub in p.get("parts") or []:
            walk(sub)

    walk(payload or {})
    if any(t.strip() for t in plain):
        return "\n".join(plain).strip()
    if html:
        return _strip_html("\n".join(html))
    return ""


async def get_thread(user_id: int, thread_id: str) -> dict:
    t = await _api(user_id, "GET", f"/threads/{thread_id}", params={"format": "full"})
    msgs = t.get("messages") or []
    out = []
    for m in msgs:
        h = _headers(m)
        out.append({
            "id": m["id"],
            "from": h.get("from", ""),
            "to": h.get("to", ""),
            "cc": h.get("cc", ""),
            "date": _iso_date(m),
            "subject": h.get("subject", ""),
            "body_text": _body_text(m.get("payload") or {}),
            "snippet": html_lib.unescape(m.get("snippet") or ""),
            "unread": "UNREAD" in (m.get("labelIds") or []),
        })
    subject = _headers(msgs[0]).get("subject", "") if msgs else ""
    return {"id": t.get("id", thread_id), "subject": subject or "(no subject)", "messages": out}


def _raw(msg: EmailMessage) -> str:
    return base64.urlsafe_b64encode(msg.as_bytes()).decode().rstrip("=")


def _norm_addrs(value: str | list[str] | None) -> str:
    if not value:
        return ""
    if isinstance(value, (list, tuple)):
        value = ", ".join(v for v in value if v)
    return value.strip()


async def send_email(user_id: int, to: str | list[str], subject: str, body: str,
                     cc: str | list[str] | None = None) -> dict:
    to_s = _norm_addrs(to)
    if not to_s or "@" not in to_s:
        raise _err(400, "recipient_required", "Recipient address is required")
    msg = EmailMessage()
    msg["To"] = to_s
    if _norm_addrs(cc):
        msg["Cc"] = _norm_addrs(cc)
    msg["Subject"] = subject or ""
    profile = _row(user_id)
    if profile and profile.email:
        msg["From"] = profile.email
    msg.set_content(body or "")
    sent = await _api(user_id, "POST", "/messages/send", json={"raw": _raw(msg)})
    return {"id": sent.get("id"), "thread_id": sent.get("threadId")}


async def reply(user_id: int, thread_id: str, body: str) -> dict:
    if not (body or "").strip():
        raise _err(400, "empty_message", "Reply text is empty")
    t = await _api(user_id, "GET", f"/threads/{thread_id}", params={
        "format": "metadata",
        "metadataHeaders": ["Subject", "From", "To", "Cc", "Reply-To", "Message-ID", "References"],
    })
    msgs = t.get("messages") or []
    if not msgs:
        raise _err(404, "not_found", "Thread not found")
    last = msgs[-1]
    h = _headers(last)
    row = _row(user_id)
    me = (row.email or "").lower() if row else ""
    from_addr = parseaddr(h.get("from", ""))[1].lower()
    is_ours = "SENT" in (last.get("labelIds") or []) or (me and from_addr == me)
    if is_ours:
        to = h.get("to", "")
    else:
        to = h.get("reply-to") or h.get("from", "")
    if not to:
        raise _err(400, "invalid_request", "Can't tell who to reply to")
    subject = _headers(msgs[0]).get("subject") or h.get("subject") or ""
    if not re.match(r"(?i)^re:", subject.strip()):
        subject = f"Re: {subject}".strip()

    msg = EmailMessage()
    msg["To"] = to
    if me:
        msg["From"] = row.email
    msg["Subject"] = subject
    mid = h.get("message-id")
    if mid:
        msg["In-Reply-To"] = mid
        refs = (h.get("references") or "").strip()
        msg["References"] = f"{refs} {mid}".strip() if mid not in refs else refs
    msg.set_content(body)
    sent = await _api(user_id, "POST", "/messages/send",
                      json={"raw": _raw(msg), "threadId": t.get("id", thread_id)})
    return {"id": sent.get("id"), "thread_id": sent.get("threadId")}


async def mark_read(user_id: int, thread_id: str) -> None:
    await _api(user_id, "POST", f"/threads/{thread_id}/modify", json={"removeLabelIds": ["UNREAD"]})


def recipients(value: str) -> list[str]:
    """Helper: parse an address header into bare emails."""
    return [a for _, a in getaddresses([value or ""]) if a]
