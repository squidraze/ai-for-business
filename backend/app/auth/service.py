"""Auth business logic: accounts, email codes, social sign-in, account deletion.

Sync functions (DB + blocking SMTP / token checks) — the routes calling them are
sync, so FastAPI runs them in its thread pool and the event loop stays free.
"""

import logging
import math
from datetime import datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.auth import apple, google, mailer
from app.auth.models import EmailCode, User, as_utc, utcnow
from app.auth.security import code_matches, create_access_token, generate_code, hash_code, hash_password, verify_password
from app.config import settings
from app.lib.errors import ApiError
from app.lib.user_data import purge_user_rows, run_user_delete_hooks

log = logging.getLogger("app.auth")

VERIFY = "verify"
RESET = "reset"


# ---------------------------------------------------------------- output


def _iso(dt: datetime | None) -> str | None:
    return as_utc(dt).isoformat().replace("+00:00", "Z") if dt else None


def user_out(u: User) -> dict:
    return {
        "id": u.id,
        "uuid": u.uuid,
        "email": u.email,
        "name": u.name,
        "email_verified": bool(u.email_verified),
        "has_password": u.has_password,
        "providers": u.providers,
        "created_at": _iso(u.created_at),
    }


def auth_response(u: User) -> dict:
    return {"access_token": create_access_token(u), "token_type": "bearer", "user": user_out(u)}


def _ttl_seconds() -> int:
    return settings.EMAIL_CODE_TTL_MINUTES * 60


def default_code_sent(email: str) -> dict:
    """What we answer when nothing was sent but we must not reveal why (no enumeration)."""
    return {"email": email, "resend_in": settings.EMAIL_CODE_RESEND_SECONDS, "expires_in": _ttl_seconds()}


# ---------------------------------------------------------------- lookups


def get_by_email(db: Session, email: str) -> User | None:
    return db.scalar(select(User).where(User.email == email))


# ---------------------------------------------------------------- email codes


def _latest_code(db: Session, user: User, purpose: str, unused_only: bool = False) -> EmailCode | None:
    q = select(EmailCode).where(EmailCode.user_id == user.id, EmailCode.purpose == purpose)
    if unused_only:
        q = q.where(EmailCode.used_at.is_(None))
    return db.scalar(q.order_by(EmailCode.created_at.desc(), EmailCode.id.desc()).limit(1))


def _seconds_left(until: datetime) -> int:
    return max(0, math.ceil((as_utc(until) - utcnow()).total_seconds()))


def cooldown_left(db: Session, user: User, purpose: str) -> int:
    last = _latest_code(db, user, purpose)
    if last is None:
        return 0
    return _seconds_left(as_utc(last.created_at) + timedelta(seconds=settings.EMAIL_CODE_RESEND_SECONDS))


def _pending_code_sent(db: Session, user: User, purpose: str, resend_in: int) -> dict:
    code = _latest_code(db, user, purpose, unused_only=True)
    expires_in = _seconds_left(code.expires_at) if code else 0
    return {"email": user.email, "resend_in": resend_in, "expires_in": expires_in}


def issue_code(db: Session, user: User, purpose: str, lang: str) -> dict:
    """Invalidate older unused codes, store a new one, email it. Returns CodeSent."""
    now = utcnow()
    db.execute(
        update(EmailCode)
        .where(EmailCode.user_id == user.id, EmailCode.purpose == purpose, EmailCode.used_at.is_(None))
        .values(used_at=now)
    )
    code = generate_code()
    row = EmailCode(
        user_id=user.id, purpose=purpose, code_hash=hash_code(user.id, purpose, code),
        expires_at=now + timedelta(seconds=_ttl_seconds()), attempts=0, created_at=now,
    )
    db.add(row)
    db.commit()
    try:
        mailer.send_code_email(user.email, purpose, code, lang)
    except ApiError:
        # don't let a code that never arrived hold the resend cooldown
        db.delete(row)
        db.commit()
        raise
    return {"email": user.email, "resend_in": settings.EMAIL_CODE_RESEND_SECONDS, "expires_in": _ttl_seconds()}


def send_code_if_allowed(db: Session, user: User, purpose: str, lang: str) -> dict:
    """Issue a code unless the cooldown is active; either way return CodeSent."""
    left = cooldown_left(db, user, purpose)
    if left > 0:
        return _pending_code_sent(db, user, purpose, left)
    return issue_code(db, user, purpose, lang)


def consume_code(db: Session, user: User | None, purpose: str, code: str) -> None:
    """Check `code` against the user's active code; raise the contract errors on failure."""
    max_attempts = settings.EMAIL_CODE_MAX_ATTEMPTS
    if user is None:
        raise ApiError(400, "invalid_code", field="code", attempts_left=max_attempts - 1)
    row = _latest_code(db, user, purpose, unused_only=True)
    if row is None:
        raise ApiError(400, "code_expired", field="code")
    if row.attempts >= max_attempts:
        raise ApiError(429, "too_many_attempts", field="code")
    if _seconds_left(row.expires_at) <= 0:
        raise ApiError(400, "code_expired", field="code")
    if not code_matches(user.id, purpose, code, row.code_hash):
        row.attempts += 1
        db.commit()
        left = max_attempts - row.attempts
        if left <= 0:
            raise ApiError(429, "too_many_attempts", field="code")
        raise ApiError(400, "invalid_code", field="code", attempts_left=left)
    row.used_at = utcnow()


# ---------------------------------------------------------------- password accounts


def register(db: Session, email: str, password: str, name: str, lang: str) -> dict:
    user = get_by_email(db, email)
    if user is not None:
        if user.email_verified or user.google_sub or user.apple_sub:
            raise ApiError(409, "email_taken", field="email")
        # an unfinished sign-up: take the new details and (re)send the code
        user.name = name
        user.password_hash = hash_password(password)
        db.commit()
        return send_code_if_allowed(db, user, VERIFY, lang)

    user = User(email=email, name=name, password_hash=hash_password(password), email_verified=False)
    db.add(user)
    db.commit()
    db.refresh(user)
    return issue_code(db, user, VERIFY, lang)


def verify_email(db: Session, email: str, code: str) -> dict:
    user = get_by_email(db, email)
    if user is not None and user.email_verified:
        raise ApiError(409, "already_verified", field="email")
    consume_code(db, user, VERIFY, code)
    user.email_verified = True
    db.commit()
    return auth_response(user)


def resend_code(db: Session, email: str, purpose: str, lang: str) -> dict:
    user = get_by_email(db, email)
    if user is None or (purpose == VERIFY and user.email_verified):
        return default_code_sent(email)
    left = cooldown_left(db, user, purpose)
    if left > 0:
        raise ApiError(429, "resend_cooldown", retry_after=left)
    return issue_code(db, user, purpose, lang)


def login(db: Session, email: str, password: str, lang: str) -> dict:
    user = get_by_email(db, email)
    if user is None or not user.password_hash or not verify_password(password, user.password_hash):
        raise ApiError(401, "invalid_credentials")
    if not user.email_verified:
        try:
            sent = send_code_if_allowed(db, user, VERIFY, lang)
            resend_in = sent["resend_in"]
        except ApiError as e:
            log.warning("could not send verify code on login for user %s: %s", user.id, e.code)
            resend_in = 0
        raise ApiError(403, "email_not_verified", email=user.email, resend_in=resend_in)
    return auth_response(user)


def forgot_password(db: Session, email: str, lang: str) -> dict:
    user = get_by_email(db, email)
    if user is not None and cooldown_left(db, user, RESET) == 0:
        return issue_code(db, user, RESET, lang)
    return default_code_sent(email)


def reset_password(db: Session, email: str, code: str, password: str) -> dict:
    user = get_by_email(db, email)
    consume_code(db, user, RESET, code)
    user.password_hash = hash_password(password)
    user.email_verified = True  # they proved they own the inbox
    db.commit()
    return auth_response(user)


# ---------------------------------------------------------------- social sign-in


def _link_existing(user: User) -> None:
    """Linking a social identity to an account found by email.

    If that account was never verified, whoever set its password did not prove
    they own the inbox — drop the password so only the social owner gets in."""
    if not user.email_verified:
        user.password_hash = ""
    user.email_verified = True


def _unique_email_owner(db: Session, email: str) -> User | None:
    return get_by_email(db, email) if email else None


def google_sign_in(db: Session, id_token: str) -> dict:
    ident = google.verify_id_token(id_token)
    if not ident.email_verified:
        raise ApiError(400, "google_email_unverified")

    user = db.scalar(select(User).where(User.google_sub == ident.sub))
    if user is None:
        user = _unique_email_owner(db, ident.email)
        if user is not None:
            _link_existing(user)
            user.google_sub = ident.sub
        else:
            user = User(email=ident.email, name=(ident.name or ident.email.split("@")[0])[:100],
                        password_hash="", email_verified=True, google_sub=ident.sub)
            db.add(user)
    elif not user.email_verified:
        user.email_verified = True
    db.commit()
    db.refresh(user)
    return auth_response(user)


def apple_sign_in(db: Session, identity_token: str, given_name: str | None, family_name: str | None) -> dict:
    ident = apple.verify_identity_token(identity_token)

    user = db.scalar(select(User).where(User.apple_sub == ident.sub))
    if user is None:
        if not ident.email:
            raise ApiError(400, "apple_email_missing")
        full_name = " ".join(p for p in (given_name, family_name) if p).strip()
        user = _unique_email_owner(db, ident.email)
        if user is not None:
            _link_existing(user)
            user.apple_sub = ident.sub
            if not user.name and full_name:
                user.name = full_name[:100]
        else:
            user = User(email=ident.email, name=(full_name or ident.email.split("@")[0])[:100],
                        password_hash="", email_verified=True, apple_sub=ident.sub)
            db.add(user)
    elif not user.email_verified:
        user.email_verified = True
    db.commit()
    db.refresh(user)
    return auth_response(user)


# ---------------------------------------------------------------- account deletion


async def delete_account(db: Session, user: User) -> None:
    """Remove the user and everything they own. Hooks first (they may need their rows)."""
    user_id = user.id
    await run_user_delete_hooks(user_id)
    purge_user_rows(db, user_id)
    db.execute(EmailCode.__table__.delete().where(EmailCode.user_id == user_id))
    db.execute(User.__table__.delete().where(User.id == user_id))
    db.commit()
    log.info("deleted account %s", user_id)
