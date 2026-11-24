"""Field rules for auth requests. The mobile app mirrors these exactly.

Each rule raises `PydanticCustomError(<code>, ...)`; the global 422 handler
(app.lib.errors) turns the error type into `fields[<name>] = <code>`.
"""

import re

from email_validator import EmailNotValidError, validate_email
from pydantic_core import PydanticCustomError

from app.lib.errors import FIELD_MESSAGES

EMAIL_MAX = 254
PASSWORD_MIN = 8
PASSWORD_MAX = 128
NAME_MAX = 100
_CODE_RE = re.compile(r"^[0-9]{6}$")
_DIGIT_RE = re.compile(r"[0-9]")


def fail(code: str, field: str | None = None) -> PydanticCustomError:
    ctx = {"field": field} if field else None
    return PydanticCustomError(code, FIELD_MESSAGES.get(code, code), ctx)


def _require_str(v) -> str:
    if v is None:
        raise fail("required")
    if not isinstance(v, str):
        raise fail("invalid")
    return v


def normalize_email(v) -> str:
    v = _require_str(v).strip().lower()
    if not v:
        raise fail("required")
    if len(v) > EMAIL_MAX:
        raise fail("invalid_email")
    try:
        validate_email(v, check_deliverability=False)
    except EmailNotValidError:
        raise fail("invalid_email")
    return v


def check_password(v) -> str:
    """For register / reset. Not trimmed: surrounding whitespace is an error."""
    v = _require_str(v)
    if not v:
        raise fail("required")
    if len(v) < PASSWORD_MIN:
        raise fail("password_too_short")
    if len(v) > PASSWORD_MAX:
        raise fail("password_too_long")
    if not any(c.isalpha() for c in v):
        raise fail("password_needs_letter")
    if not _DIGIT_RE.search(v):
        raise fail("password_needs_digit")
    if v != v.strip():
        raise fail("password_whitespace")
    return v


def check_password_not_email(password: str, email: str) -> None:
    if password.strip().lower() == email.strip().lower():
        raise fail("password_equals_email", field="password")


def nonempty(v) -> str:
    """Login password: anything non-empty (the rules only apply to new passwords)."""
    v = _require_str(v)
    if not v:
        raise fail("required")
    return v


def normalize_name(v) -> str:
    v = _require_str(v).strip()
    if not v:
        raise fail("required")
    if len(v) > NAME_MAX:
        raise fail("name_too_long")
    return v


def check_code(v) -> str:
    v = _require_str(v).strip()
    if not v:
        raise fail("required")
    if not _CODE_RE.match(v):
        raise fail("invalid_code_format")
    return v


def optional_name_part(v) -> str | None:
    if v is None:
        return None
    if not isinstance(v, str):
        raise fail("invalid")
    v = v.strip()
    return v[:NAME_MAX] or None
