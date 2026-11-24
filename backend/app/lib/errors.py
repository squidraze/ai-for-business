"""Structured API errors and the global exception handlers.

Error body shape: `{"detail": {"code": "<snake_code>", "message": "<English text>",
"field": "<field or null>", ...extra}}`. Clients switch on `code`; `message` is a
fallback for logs and untranslated cases.
"""

import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

log = logging.getLogger("app.errors")

# Default English messages; a raise site may pass its own.
MESSAGES: dict[str, str] = {
    "validation_error": "Some fields are invalid",
    "internal_error": "Internal server error",
    "not_authenticated": "Not authenticated",
    "invalid_token": "Invalid or expired token",
    "email_taken": "An account with this email already exists",
    "email_not_verified": "Email is not verified",
    "invalid_credentials": "Invalid email or password",
    "invalid_code": "The code is incorrect",
    "code_expired": "The code has expired, request a new one",
    "too_many_attempts": "Too many attempts, request a new code",
    "already_verified": "Email is already verified",
    "resend_cooldown": "Please wait before requesting a new code",
    "email_send_failed": "Could not send the email, try again later",
    "invalid_google_token": "Google sign-in failed",
    "google_email_unverified": "This Google account's email is not verified",
    "google_not_configured": "Google sign-in is not configured on the server",
    "google_unavailable": "Could not reach Google, try again later",
    "invalid_apple_token": "Apple sign-in failed",
    "apple_email_missing": "Apple did not share an email address",
    "apple_not_configured": "Apple sign-in is not configured on the server",
    "apple_unavailable": "Could not reach Apple, try again later",
}

# Field-level messages for the 422 handler (codes come from app.auth.validation).
FIELD_MESSAGES: dict[str, str] = {
    "required": "This field is required",
    "invalid": "Invalid value",
    "invalid_email": "Enter a valid email address",
    "password_too_short": "Password must be at least 8 characters",
    "password_too_long": "Password must be at most 128 characters",
    "password_needs_letter": "Password must contain a letter",
    "password_needs_digit": "Password must contain a digit",
    "password_whitespace": "Password must not start or end with a space",
    "password_equals_email": "Password must not be the same as the email",
    "name_too_long": "Name must be at most 100 characters",
    "invalid_code_format": "The code must be 6 digits",
}

# pydantic built-in error types that mean "missing / empty"
_REQUIRED_TYPES = {"missing", "string_too_short"}


class ApiError(Exception):
    def __init__(self, status_code: int, code: str, message: str | None = None, field: str | None = None, **extra: Any):
        super().__init__(code)
        self.status_code = status_code
        self.code = code
        self.message = message or MESSAGES.get(code, code.replace("_", " ").capitalize())
        self.field = field
        self.extra = extra

    def detail(self) -> dict:
        return {"code": self.code, "message": self.message, "field": self.field, **self.extra}


async def _api_error_handler(_: Request, exc: ApiError) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail()})


def _field_name(err: dict) -> str | None:
    ctx_field = (err.get("ctx") or {}).get("field")
    if ctx_field:
        return str(ctx_field)
    loc = [p for p in err.get("loc", ()) if isinstance(p, str) and p not in ("body", "query", "path", "header")]
    return loc[-1] if loc else None


def _field_code(err: dict) -> str:
    t = err.get("type", "")
    if t in FIELD_MESSAGES:
        return t
    if t in _REQUIRED_TYPES:
        return "required"
    return "invalid"


async def _validation_error_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    fields: dict[str, str] = {}
    first_message = None
    for err in exc.errors():
        name = _field_name(err)
        code = _field_code(err)
        if name and name not in fields:
            fields[name] = code
            if first_message is None:
                first_message = FIELD_MESSAGES.get(code) if code != "invalid" else err.get("msg")
    detail = {
        "code": "validation_error",
        "message": first_message or MESSAGES["validation_error"],
        "field": next(iter(fields), None),
        "fields": fields,
    }
    return JSONResponse(status_code=422, content={"detail": detail})


async def _unhandled_error_handler(request: Request, exc: Exception) -> JSONResponse:
    log.exception("unhandled error on %s %s", request.method, request.url.path, exc_info=exc)
    return JSONResponse(status_code=500, content={"detail": {"code": "internal_error", "message": MESSAGES["internal_error"]}})


def install_error_handlers(app: FastAPI) -> None:
    """HTTPException keeps FastAPI's default handler (string `detail`)."""
    app.add_exception_handler(ApiError, _api_error_handler)
    app.add_exception_handler(RequestValidationError, _validation_error_handler)
    app.add_exception_handler(Exception, _unhandled_error_handler)
