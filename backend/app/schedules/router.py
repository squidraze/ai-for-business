"""/api/v1/schedules: recurring AI tasks."""

from datetime import datetime

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from app.auth import User, get_current_user
from app.db import get_db
from app.lib.errors import ApiError
from app.schedules import service
from app.schedules.schemas import ScheduleIn, ScheduleInvalid

router = APIRouter(prefix="/api/v1/schedules", tags=["schedules"])


@router.get("")
def list_schedules(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return {"items": [service.schedule_read(db, s) for s in service.list_for_user(db, user.id)]}


@router.post("", status_code=201)
def create_schedule(body: ScheduleIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    data = {k: getattr(body, k) for k in body.model_fields_set}
    try:
        s = service.create(db, user.id, data)
    except ScheduleInvalid as e:
        raise e.api_error()
    return service.schedule_read(db, s)


# before /{schedule_uuid} so it is not taken for a uuid
@router.get("/pending-count")
def pending_count(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return {"count": service.pending_count(db, user.id)}


@router.get("/{schedule_uuid}")
def get_schedule(schedule_uuid: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    return service.schedule_read(db, service.get_owned(db, user.id, schedule_uuid))


@router.patch("/{schedule_uuid}")
def update_schedule(
    schedule_uuid: str, body: ScheduleIn, db: Session = Depends(get_db), user: User = Depends(get_current_user)
):
    s = service.get_owned(db, user.id, schedule_uuid)
    try:
        s = service.update(db, s, {k: getattr(body, k) for k in body.model_fields_set})
    except ScheduleInvalid as e:
        raise e.api_error()
    return service.schedule_read(db, s)


@router.delete("/{schedule_uuid}", status_code=204)
async def delete_schedule(schedule_uuid: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    await service.remove(db, service.get_owned(db, user.id, schedule_uuid))
    return Response(status_code=204)


@router.post("/{schedule_uuid}/run", status_code=202)
def run_now(schedule_uuid: str, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    s = service.get_owned(db, user.id, schedule_uuid)
    return service.run_read(service.fire_manual(db, s))


@router.get("/{schedule_uuid}/runs")
def list_runs(
    schedule_uuid: str,
    limit: int = Query(20, ge=1, le=100),
    before: str | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    s = service.get_owned(db, user.id, schedule_uuid)
    cursor = None
    if before:
        try:
            cursor = datetime.fromisoformat(before.strip().replace("Z", "+00:00"))
        except ValueError:
            raise ApiError(422, "validation_error", "Invalid value", field="before", fields={"before": "invalid"})
    rows, has_more = service.runs_page(db, s, limit, cursor)
    return {"items": [service.run_read(r) for r in rows], "has_more": has_more}
