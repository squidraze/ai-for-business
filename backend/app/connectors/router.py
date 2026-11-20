import html
import json
import logging
from urllib.parse import urlencode

from fastapi import APIRouter, Depends, Query
from fastapi.responses import HTMLResponse, Response
from pydantic import BaseModel

from app.auth import User, get_current_user
from app.connectors import bitrix, gmail, telegram
from app.connectors.errors import ConnectorError

log = logging.getLogger("connectors")

router = APIRouter(prefix="/api/v1/connectors", tags=["connectors"])


@router.get("")
async def connectors_summary(user: User = Depends(get_current_user)):
    return [
        {"id": "telegram", "connected": await telegram.is_connected(user.id),
         "account": telegram.account_summary(user.id)},
        {"id": "gmail", "connected": await gmail.is_connected(user.id),
         "account": gmail.account_summary(user.id)},
        {"id": "bitrix24", "connected": await bitrix.is_connected(user.id),
         "account": bitrix.account_summary(user.id)},
    ]


# --------------------------------------------------------------------------- Telegram


class SendCodeIn(BaseModel):
    phone: str


class SignInIn(BaseModel):
    phone: str = ""
    code: str
    phone_code_hash: str | None = None


class PasswordIn(BaseModel):
    password: str


class SendMessageIn(BaseModel):
    text: str
    reply_to_id: int | None = None


@router.post("/telegram/send-code")
async def telegram_send_code(body: SendCodeIn, user: User = Depends(get_current_user)):
    return await telegram.send_code(user.id, body.phone)


@router.post("/telegram/sign-in")
async def telegram_sign_in(body: SignInIn, user: User = Depends(get_current_user)):
    return await telegram.sign_in(user.id, body.phone, body.code, body.phone_code_hash)


@router.post("/telegram/password")
async def telegram_password(body: PasswordIn, user: User = Depends(get_current_user)):
    return await telegram.check_password(user.id, body.password)


@router.get("/telegram/me")
async def telegram_me(user: User = Depends(get_current_user)):
    return await telegram.get_me(user.id)


@router.post("/telegram/logout")
async def telegram_logout(user: User = Depends(get_current_user)):
    await telegram.logout(user.id)
    return {"status": "ok"}


@router.get("/telegram/dialogs")
async def telegram_dialogs(limit: int = 50, q: str | None = None, user: User = Depends(get_current_user)):
    return await telegram.list_dialogs(user.id, limit=limit, query=q)


@router.get("/telegram/dialogs/{chat_id}/messages")
async def telegram_messages(chat_id: str, limit: int = 50, offset_id: int | None = None,
                            user: User = Depends(get_current_user)):
    return await telegram.get_messages(user.id, chat_id, limit=limit, offset_id=offset_id)


@router.post("/telegram/dialogs/{chat_id}/messages")
async def telegram_send(chat_id: str, body: SendMessageIn, user: User = Depends(get_current_user)):
    return await telegram.send_message(user.id, chat_id, body.text, body.reply_to_id)


@router.post("/telegram/dialogs/{chat_id}/read")
async def telegram_read(chat_id: str, user: User = Depends(get_current_user)):
    await telegram.mark_read(user.id, chat_id)
    return {"status": "ok"}


@router.get("/telegram/dialogs/{chat_id}/photo")
async def telegram_photo(chat_id: str, user: User = Depends(get_current_user)):
    data = await telegram.get_photo(user.id, chat_id)
    if not data:
        raise ConnectorError(404, "No photo")
    return Response(content=data, media_type="image/jpeg",
                    headers={"Cache-Control": "private, max-age=3600"})


@router.get("/telegram/search")
async def telegram_search(q: str = "", chat_id: str | None = None, limit: int = 30,
                          user: User = Depends(get_current_user)):
    return await telegram.search_messages(user.id, q, chat_id=chat_id or None, limit=limit)


# --------------------------------------------------------------------------- Gmail


class SendEmailIn(BaseModel):
    to: str | list[str]
    subject: str = ""
    body: str = ""
    cc: str | list[str] | None = None


class ReplyIn(BaseModel):
    body: str


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
    except ConnectorError as e:
        return _callback_page(False, str(e.detail))
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


# --------------------------------------------------------------------------- Bitrix24


class BitrixConnectIn(BaseModel):
    webhook_url: str


class CommentIn(BaseModel):
    text: str


_ENTITY = {"deals": "deal", "leads": "lead"}


@router.post("/bitrix24/connect")
async def bitrix_connect(body: BitrixConnectIn, user: User = Depends(get_current_user)):
    return await bitrix.connect(user.id, body.webhook_url)


@router.post("/bitrix24/disconnect")
async def bitrix_disconnect(user: User = Depends(get_current_user)):
    await bitrix.disconnect(user.id)
    return {"status": "ok"}


@router.get("/bitrix24/deals")
async def bitrix_deals(q: str | None = None, start: int = Query(0, ge=0), user: User = Depends(get_current_user)):
    return await bitrix.list_deals(user.id, q=q or None, start=start)


@router.get("/bitrix24/deals/{deal_id}")
async def bitrix_deal(deal_id: str, user: User = Depends(get_current_user)):
    return await bitrix.get_deal(user.id, deal_id)


@router.get("/bitrix24/leads")
async def bitrix_leads(q: str | None = None, start: int = Query(0, ge=0), user: User = Depends(get_current_user)):
    return await bitrix.list_leads(user.id, q=q or None, start=start)


@router.get("/bitrix24/leads/{lead_id}")
async def bitrix_lead(lead_id: str, user: User = Depends(get_current_user)):
    return await bitrix.get_lead(user.id, lead_id)


@router.post("/bitrix24/{entity}/{entity_id}/comments")
async def bitrix_comment(entity: str, entity_id: str, body: CommentIn, user: User = Depends(get_current_user)):
    if entity not in _ENTITY:
        raise ConnectorError(404, "Unknown entity")
    return await bitrix.add_comment(user.id, _ENTITY[entity], entity_id, body.text)
