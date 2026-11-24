import uuid as uuid_lib
from datetime import datetime, timezone

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def as_utc(dt: datetime) -> datetime:
    """SQLite hands datetimes back naive; they are stored in UTC."""
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    uuid: Mapped[str] = mapped_column(String(36), unique=True, default=lambda: str(uuid_lib.uuid4()))
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(255), default="")
    # "" = no password (an account created through Google / Apple)
    password_hash: Mapped[str] = mapped_column(String(255), default="")
    email_verified: Mapped[bool] = mapped_column(default=False)
    google_sub: Mapped[str | None] = mapped_column(String(255), unique=True, index=True, nullable=True)
    apple_sub: Mapped[str | None] = mapped_column(String(255), unique=True, index=True, nullable=True)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    updated_at: Mapped[datetime | None] = mapped_column(default=utcnow, onupdate=utcnow, nullable=True)

    @property
    def has_password(self) -> bool:
        return bool(self.password_hash)

    @property
    def providers(self) -> list[str]:
        out = []
        if self.password_hash:
            out.append("password")
        if self.google_sub:
            out.append("google")
        if self.apple_sub:
            out.append("apple")
        return out


class EmailCode(Base):
    """A one-time 6-digit code sent by email. Only an HMAC of the code is stored."""

    __tablename__ = "email_codes"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    purpose: Mapped[str] = mapped_column(String(10))  # verify | reset
    code_hash: Mapped[str] = mapped_column(String(64))
    expires_at: Mapped[datetime] = mapped_column()
    attempts: Mapped[int] = mapped_column(default=0)
    created_at: Mapped[datetime] = mapped_column(default=utcnow)
    used_at: Mapped[datetime | None] = mapped_column(nullable=True)
