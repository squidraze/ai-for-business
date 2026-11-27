"""HTTP endpoints /api/v1/connectors/bitrix24/..."""

from fastapi import APIRouter, Depends, Query

from app.auth import User, get_current_user
from app.integrations.bitrix24 import client as bitrix
from app.integrations.bitrix24.schemas import BitrixConnectIn, CommentIn
from app.integrations.errors import IntegrationError

router = APIRouter(prefix="/api/v1/connectors", tags=["connectors"])

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
        raise IntegrationError(404, f"{bitrix.ID}_not_found", "Unknown entity")
    return await bitrix.add_comment(user.id, _ENTITY[entity], entity_id, body.text)
