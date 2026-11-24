"""Device push tokens. One row per FCM registration token; a token moves to
whoever signed in on the device last."""

from datetime import datetime

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.ai.models import utcnow
from app.db import Base


class PushDevice(Base):
    __tablename__ = "push_devices"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token: Mapped[str] = mapped_column(String(4096), unique=True, index=True)
    platform: Mapped[str] = mapped_column(String(10))  # android | ios
    locale: Mapped[str] = mapped_column(String(35), default="en")
    # optional IANA zone reported by the device (default zone for schedules the AI creates)
    timezone: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    last_seen_at: Mapped[datetime] = mapped_column(default=utcnow)
