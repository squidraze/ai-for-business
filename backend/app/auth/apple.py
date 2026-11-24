"""Sign in with Apple: verify the identity token (RS256 JWT) from the app (blocking)."""

import logging
from dataclasses import dataclass

import jwt

from app.config import settings
from app.lib.errors import ApiError

log = logging.getLogger("app.auth.apple")

APPLE_ISSUER = "https://appleid.apple.com"
APPLE_KEYS_URL = "https://appleid.apple.com/auth/keys"

# caches Apple's signing keys between requests
_jwks = jwt.PyJWKClient(APPLE_KEYS_URL, cache_keys=True, lifespan=3600, timeout=10)


@dataclass
class AppleIdentity:
    sub: str
    email: str  # "" when Apple did not include it (it does only on the first sign-in for some flows)


def verify_identity_token(token: str) -> AppleIdentity:
    if not settings.APPLE_BUNDLE_ID:
        raise ApiError(503, "apple_not_configured")
    try:
        key = _jwks.get_signing_key_from_jwt(token)
    except jwt.PyJWKClientConnectionError as e:
        log.warning("apple keys fetch failed: %s", e)
        raise ApiError(502, "apple_unavailable") from e
    except jwt.PyJWTError as e:
        log.info("invalid apple token: %s", e)
        raise ApiError(401, "invalid_apple_token") from e
    try:
        claims = jwt.decode(
            token, key.key, algorithms=["RS256"], audience=settings.APPLE_BUNDLE_ID, issuer=APPLE_ISSUER, leeway=10,
            options={"require": ["sub", "iss", "aud", "exp"]},
        )
    except jwt.PyJWTError as e:
        log.info("invalid apple token: %s", e)
        raise ApiError(401, "invalid_apple_token") from e
    return AppleIdentity(sub=str(claims["sub"]), email=(claims.get("email") or "").strip().lower())
