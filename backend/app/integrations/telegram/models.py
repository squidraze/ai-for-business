from datetime import datetime

from sqlalchemy import JSON, Boolean, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.integrations.base import utcnow


class TelegramSession(Base):
    __tablename__ = "telegram_sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True, index=True)
    session: Mapped[str] = mapped_column(Text, default="")  # Telethon StringSession
    phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    phone_code_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)  # pending login
    authorized: Mapped[bool] = mapped_column(Boolean, default=False)
    account: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)
