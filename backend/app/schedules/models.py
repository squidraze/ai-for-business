"""Recurring AI tasks and their run history.

Each schedule owns one conversation (`ai_conversations.source = "schedule"`);
every run appends a user turn there, so the AI sees what earlier runs did.
Datetimes are UTC (SQLite stores them naive; read them back as UTC).
"""

import uuid as uuid_lib
from datetime import datetime

from sqlalchemy import JSON, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.ai.models import utcnow
from app.db import Base


def _uuid() -> str:
    return str(uuid_lib.uuid4())


class Schedule(Base):
    __tablename__ = "schedules"
    id: Mapped[int] = mapped_column(primary_key=True)
    uuid: Mapped[str] = mapped_column(String(36), unique=True, index=True, default=_uuid)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(100))
    prompt: Mapped[str] = mapped_column(Text)
    kind: Mapped[str] = mapped_column(String(10))  # daily | weekly | interval
    time_of_day: Mapped[str | None] = mapped_column(String(5), nullable=True)  # "HH:MM" (daily, weekly)
    weekdays: Mapped[list | None] = mapped_column(JSON, nullable=True)  # [0..6], 0 = Monday (weekly)
    interval_minutes: Mapped[int | None] = mapped_column(nullable=True)  # interval
    timezone: Mapped[str] = mapped_column(String(64), default="Asia/Tashkent")
    enabled: Mapped[bool] = mapped_column(default=True)
    notify: Mapped[str] = mapped_column(String(10), default="approval")  # approval | always | never
    conversation_id: Mapped[int] = mapped_column(ForeignKey("ai_conversations.id", ondelete="CASCADE"), index=True)
    next_run_at: Mapped[datetime | None] = mapped_column(nullable=True, index=True)  # null when disabled
    last_run_at: Mapped[datetime | None] = mapped_column(nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(default=utcnow)


class ScheduleRun(Base):
    __tablename__ = "schedule_runs"
    id: Mapped[int] = mapped_column(primary_key=True)
    uuid: Mapped[str] = mapped_column(String(36), unique=True, index=True, default=_uuid)
    schedule_id: Mapped[int] = mapped_column(ForeignKey("schedules.id", ondelete="CASCADE"), index=True)
    run_uuid: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)  # ai_runs.uuid
    trigger: Mapped[str] = mapped_column(String(10))  # schedule | manual
    # running | awaiting_approval | completed | failed | skipped | cancelled
    status: Mapped[str] = mapped_column(String(20), default="running")
    skip_reason: Mapped[str | None] = mapped_column(String(30), nullable=True)  # previous_run_active
    started_at: Mapped[datetime] = mapped_column(default=utcnow, index=True)
    finished_at: Mapped[datetime | None] = mapped_column(nullable=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
