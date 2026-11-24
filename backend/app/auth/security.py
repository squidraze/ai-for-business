"""Password hashing (pbkdf2, stdlib), access tokens (JWT HS256) and email-code hashing."""

import hashlib
import hmac
import os
import secrets
from datetime import datetime, timedelta, timezone

import jwt

from app.config import settings

_ITER = 200_000


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, _ITER)
    return f"pbkdf2${_ITER}${salt.hex()}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    if not stored:
        return False
    try:
        _, it, salt, dk = stored.split("$")
        calc = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), int(it))
        return hmac.compare_digest(calc.hex(), dk)
    except Exception:  # noqa: BLE001
        return False


# ---------- JWT (format unchanged so existing sessions stay valid) ----------
def create_access_token(user) -> str:
    now = datetime.now(timezone.utc)
    payload = {"sub": str(user.id), "uuid": user.uuid, "iat": now, "exp": now + timedelta(days=settings.JWT_TTL_DAYS)}
    return jwt.encode(payload, settings.JWT_SECRET, algorithm="HS256")


def decode_access_token(token: str) -> int:
    payload = jwt.decode(token, settings.JWT_SECRET, algorithms=["HS256"])
    return int(payload["sub"])


# ---------- email codes ----------
def generate_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def hash_code(user_id: int, purpose: str, code: str) -> str:
    msg = f"{user_id}:{purpose}:{code}".encode()
    return hmac.new(settings.JWT_SECRET.encode(), msg, hashlib.sha256).hexdigest()


def code_matches(user_id: int, purpose: str, code: str, stored_hash: str) -> bool:
    return hmac.compare_digest(hash_code(user_id, purpose, code), stored_hash)
