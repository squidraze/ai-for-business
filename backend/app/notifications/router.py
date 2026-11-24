"""POST/DELETE /api/v1/notifications/devices: register or drop a push token."""

from typing import Annotated, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel, BeforeValidator, Field
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.ai.models import utcnow
from app.auth import User, get_current_user
from app.auth.validation import nonempty
from app.db import get_db
from app.notifications.models import PushDevice

router = APIRouter(prefix="/api/v1/notifications", tags=["notifications"])

Token = Annotated[str, BeforeValidator(nonempty), Field(max_length=4096)]


class DeviceIn(BaseModel):
    token: Token
    platform: Literal["android", "ios"]
    locale: str | None = Field("en", max_length=35)
    timezone: str | None = Field(None, max_length=64)  # optional IANA zone of the device


class DeviceDeleteIn(BaseModel):
    token: Token


def _valid_tz(tz: str | None) -> str | None:
    if not tz:
        return None
    try:
        ZoneInfo(tz)
        return tz
    except (ZoneInfoNotFoundError, ValueError):
        return None


@router.post("/devices", status_code=204)
def register_device(body: DeviceIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    now = utcnow()
    dev = db.scalar(select(PushDevice).where(PushDevice.token == body.token))
    if dev is None:
        dev = PushDevice(token=body.token, user_id=user.id, platform=body.platform, created_at=now)
        db.add(dev)
    dev.user_id = user.id  # the device now belongs to whoever signed in on it
    dev.platform = body.platform
    dev.locale = (body.locale or "en").strip() or "en"
    tz = _valid_tz(body.timezone)
    if tz:
        dev.timezone = tz
    dev.last_seen_at = now
    db.commit()
    return Response(status_code=204)


@router.delete("/devices", status_code=204)
def delete_device(body: DeviceDeleteIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    db.execute(delete(PushDevice).where(PushDevice.token == body.token, PushDevice.user_id == user.id))
    db.commit()
    return Response(status_code=204)
