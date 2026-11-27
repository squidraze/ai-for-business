"""HTTP endpoints /api/v1/connectors/telegram/..."""

from fastapi import APIRouter, Depends
from fastapi.responses import Response

from app.auth import User, get_current_user
from app.integrations.errors import IntegrationError
from app.integrations.telegram import client as telegram
from app.integrations.telegram.schemas import PasswordIn, SendCodeIn, SendMessageIn, SignInIn

router = APIRouter(prefix="/api/v1/connectors", tags=["connectors"])


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
        raise IntegrationError(404, f"{telegram.ID}_not_found", "No photo")
    return Response(content=data, media_type="image/jpeg",
                    headers={"Cache-Control": "private, max-age=3600"})


@router.get("/telegram/search")
async def telegram_search(q: str = "", chat_id: str | None = None, limit: int = 30,
                          user: User = Depends(get_current_user)):
    return await telegram.search_messages(user.id, q, chat_id=chat_id or None, limit=limit)
