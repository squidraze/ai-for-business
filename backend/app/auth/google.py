"""Google Sign-In: verify an ID token from the app (blocking; call from a sync route)."""

import logging
from dataclasses import dataclass

import google.auth.exceptions
import google.auth.transport.requests
import google.oauth2.id_token
import requests

from app.config import settings
from app.lib.errors import ApiError

log = logging.getLogger("app.auth.google")

_ISSUERS = ("accounts.google.com", "https://accounts.google.com")
_session = requests.Session()


@dataclass
class GoogleIdentity:
    sub: str
    email: str
    email_verified: bool
    name: str


def verify_id_token(token: str) -> GoogleIdentity:
    audiences = settings.google_signin_audiences
    if not audiences:
        raise ApiError(503, "google_not_configured")
    try:
        claims = google.oauth2.id_token.verify_oauth2_token(
            token, google.auth.transport.requests.Request(session=_session), audience=None, clock_skew_in_seconds=10
        )
    except google.auth.exceptions.TransportError as e:
        log.warning("google certs fetch failed: %s", e)
        raise ApiError(502, "google_unavailable") from e
    except (ValueError, google.auth.exceptions.GoogleAuthError) as e:
        log.info("invalid google token: %s", e)
        raise ApiError(401, "invalid_google_token") from e

    if claims.get("aud") not in audiences or claims.get("iss") not in _ISSUERS or not claims.get("sub"):
        log.info("google token rejected: aud=%s iss=%s", claims.get("aud"), claims.get("iss"))
        raise ApiError(401, "invalid_google_token")

    email = (claims.get("email") or "").strip().lower()
    verified = claims.get("email_verified") in (True, "true")
    return GoogleIdentity(sub=str(claims["sub"]), email=email, email_verified=verified and bool(email),
                          name=(claims.get("name") or "").strip())
