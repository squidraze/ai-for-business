"""/api/v1/auth — email + password with email codes, Google and Apple sign-in, account.

Code-sending routes are sync on purpose: FastAPI runs them in its thread pool,
so blocking SMTP and token-verification calls don't stall the event loop.
"""

import jwt
from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.orm import Session

from app.auth import service
from app.auth.emails import pick_lang
from app.auth.models import User
from app.auth.schemas import (
    AppleIn,
    ForgotPasswordIn,
    GoogleIn,
    LoginIn,
    RegisterIn,
    ResendCodeIn,
    ResetPasswordIn,
    VerifyEmailIn,
)
from app.auth.security import decode_access_token
from app.db import get_db
from app.lib.errors import ApiError

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


def _lang(request: Request) -> str:
    return pick_lang(request.headers.get("accept-language"))


def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    header = request.headers.get("authorization") or ""
    token = header[7:].strip() if header.lower().startswith("bearer ") else None
    if not token:
        token = request.query_params.get("access_token")
    if not token:
        raise ApiError(401, "not_authenticated")
    try:
        user_id = decode_access_token(token)
    except (jwt.PyJWTError, KeyError, ValueError):
        raise ApiError(401, "invalid_token")
    user = db.get(User, user_id)
    if not user:
        raise ApiError(401, "invalid_token")
    if not user.email_verified:
        raise ApiError(403, "email_not_verified", email=user.email)
    return user


# ---------------------------------------------------------------- email + password


@router.post("/register", status_code=201)
def register(body: RegisterIn, request: Request, db: Session = Depends(get_db)):
    return service.register(db, body.email, body.password, body.name, _lang(request))


@router.post("/verify-email")
def verify_email(body: VerifyEmailIn, db: Session = Depends(get_db)):
    return service.verify_email(db, body.email, body.code)


@router.post("/resend-code")
def resend_code(body: ResendCodeIn, request: Request, db: Session = Depends(get_db)):
    return service.resend_code(db, body.email, body.purpose, _lang(request))


@router.post("/login")
def login(body: LoginIn, request: Request, db: Session = Depends(get_db)):
    return service.login(db, body.email, body.password, _lang(request))


@router.post("/password/forgot")
def forgot_password(body: ForgotPasswordIn, request: Request, db: Session = Depends(get_db)):
    return service.forgot_password(db, body.email, _lang(request))


@router.post("/password/reset")
def reset_password(body: ResetPasswordIn, db: Session = Depends(get_db)):
    return service.reset_password(db, body.email, body.code, body.password)


# ---------------------------------------------------------------- social


@router.post("/google")
def google_sign_in(body: GoogleIn, db: Session = Depends(get_db)):
    return service.google_sign_in(db, body.id_token)


@router.post("/apple")
def apple_sign_in(body: AppleIn, db: Session = Depends(get_db)):
    return service.apple_sign_in(db, body.identity_token, body.given_name, body.family_name)


# ---------------------------------------------------------------- account


@router.get("/me")
def me(user: User = Depends(get_current_user)):
    return service.user_out(user)


@router.get("/me/context")
def me_context(user: User = Depends(get_current_user)):
    """The shape the WebView's `chat/access.ts` reads: one fake company, id "1"."""
    return {
        "user": service.user_out(user),
        "memberships": [
            {
                "company_id": "1",
                "company_name": "forBusiness",
                "role": "owner",
                "permissions": ["ai:chat"],
            }
        ],
        "user_features": {},
    }


@router.delete("/me", status_code=204)
async def delete_me(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    # async: the Telegram cleanup hook needs the main event loop (its clients live there)
    await service.delete_account(db, user)
    return Response(status_code=204)
