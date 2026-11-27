"""HTTP endpoints /api/v1/connectors/gmail/... (incl. the OAuth callback page)."""

import html
import json
import logging
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, Query
from fastapi.responses import HTMLResponse

from app.auth import User, get_current_user
from app.integrations.errors import IntegrationError
from app.integrations.gmail import client as gmail
from app.integrations.gmail.schemas import ReplyIn, SendEmailIn

log = logging.getLogger("integrations.gmail")

router = APIRouter(prefix="/api/v1/connectors", tags=["connectors"])


@router.get("/gmail/auth-url")
async def gmail_auth_url(user: User = Depends(get_current_user)):
    return {"url": gmail.auth_url(user.id)}


def _callback_page(ok: bool, message: str) -> HTMLResponse:
    target = f"{gmail.APP_REDIRECT}?{urlencode({'gmail': 'connected' if ok else 'error'})}"
    if not ok:
        target += "&" + urlencode({"message": message})
    title = "Gmail connected" if ok else "Gmail connection failed"
    t = html.escape(target, quote=True)
    js_target = json.dumps(target).replace("<", "\u003c")
    page = f"""<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{html.escape(title)}</title>
<style>
  body{{font-family:-apple-system,system-ui,sans-serif;margin:0;min-height:100vh;display:flex;align-items:center;
       justify-content:center;background:#f4f4f5;color:#18181b;text-align:center;padding:24px;box-sizing:border-box}}
  @media (prefers-color-scheme:dark){{body{{background:#18181b;color:#fafafa}}}}
  a{{display:inline-block;margin-top:20px;padding:12px 22px;border-radius:12px;background:#1f7bd1;color:#fff;
     text-decoration:none;font-weight:600}}
</style></head>
<body><div>
  <h2>{html.escape(title)}</h2>
  <p>{html.escape(message)}</p>
  <a href="{t}">Return to the app</a>
</div>
<script>setTimeout(function(){{window.location.href={js_target};}},300);</script>
</body></html>"""
    return HTMLResponse(page, status_code=200 if ok else 400)


@router.get("/gmail/callback", include_in_schema=False)
async def gmail_callback(code: str | None = None, state: str | None = None, error: str | None = None):
    if error:
        return _callback_page(False, f"Google returned: {error}")
    if not code or not state:
        return _callback_page(False, "Missing code or state")
    try:
        await gmail.handle_callback(code, state)
    except IntegrationError as e:
        return _callback_page(False, str(e))
    except Exception as e:  # noqa: BLE001
        log.exception("gmail callback failed")
        return _callback_page(False, f"Unexpected error: {e}")
    return _callback_page(True, "Gmail connected — return to the app.")


@router.get("/gmail/me")
async def gmail_me(user: User = Depends(get_current_user)):
    return await gmail.get_profile(user.id)


@router.post("/gmail/disconnect")
async def gmail_disconnect(user: User = Depends(get_current_user)):
    await gmail.disconnect(user.id)
    return {"status": "ok"}


@router.get("/gmail/threads")
async def gmail_threads(q: str | None = None, page_token: str | None = None, label: str | None = "INBOX",
                        max_results: int = Query(20, ge=1, le=50), user: User = Depends(get_current_user)):
    return await gmail.list_threads(user.id, q=q, max_results=max_results, page_token=page_token,
                                    label=label or None)


@router.get("/gmail/threads/{thread_id}")
async def gmail_thread(thread_id: str, user: User = Depends(get_current_user)):
    return await gmail.get_thread(user.id, thread_id)


@router.post("/gmail/send")
async def gmail_send(body: SendEmailIn, user: User = Depends(get_current_user)):
    return await gmail.send_email(user.id, body.to, body.subject, body.body, body.cc)


@router.post("/gmail/threads/{thread_id}/reply")
async def gmail_reply(thread_id: str, body: ReplyIn, user: User = Depends(get_current_user)):
    return await gmail.reply(user.id, thread_id, body.body)


@router.post("/gmail/threads/{thread_id}/read")
async def gmail_read(thread_id: str, user: User = Depends(get_current_user)):
    await gmail.mark_read(user.id, thread_id)
    return {"status": "ok"}
