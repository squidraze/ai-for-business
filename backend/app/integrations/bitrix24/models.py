from datetime import datetime

from sqlalchemy import JSON, ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.integrations.base import utcnow


class BitrixConnection(Base):
    __tablename__ = "bitrix_connections"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True, index=True)
    webhook_url: Mapped[str] = mapped_column(Text)  # https://portal/rest/<uid>/<token>/ — it is the secret
    account: Mapped[dict | None] = mapped_column(JSON, nullable=True)  # {portal, user_name, user_id}
    updated_at: Mapped[datetime] = mapped_column(default=utcnow, onupdate=utcnow)
