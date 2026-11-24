"""Accounts and sign-in. Not an integration, so it lives outside app/integrations/.

Public API (other modules import only these): `router`, `User`,
`get_current_user`, `user_out`, `create_access_token`.
"""

from app.auth.models import EmailCode, User
from app.auth.router import get_current_user, router
from app.auth.security import create_access_token
from app.auth.service import user_out

__all__ = ["EmailCode", "User", "create_access_token", "get_current_user", "router", "user_out"]
