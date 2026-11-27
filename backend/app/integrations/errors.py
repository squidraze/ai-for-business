"""Errors shared by all integrations.

They are `ApiError`s, so the API answers in the common shape
`{"detail": {"code", "message", "field"}}` (app/lib/errors.py). Codes are
prefixed with the integration id: `telegram_not_connected`,
`gmail_unavailable`, `bitrix24_rate_limited`... `str(err)` is the English
message, which is also what the AI tools show the model.
"""

from app.lib.errors import MESSAGES, ApiError


class IntegrationError(ApiError):
    def __init__(self, status_code: int, code: str, message: str | None = None, **extra):
        super().__init__(status_code, code, message, **extra)

    def __str__(self) -> str:
        return self.message


class NotConnected(IntegrationError):
    """The user hasn't connected this integration (or the connection was revoked). Always 409."""

    not_connected = True  # checked by app.ai.tools without importing this module

    def __init__(self, integration_id: str, message: str | None = None):
        super().__init__(409, f"{integration_id}_not_connected", message)
        self.integration_id = integration_id


def register_messages(messages: dict[str, str]) -> None:
    """Default English messages for an integration's error codes (added to app.lib.errors.MESSAGES)."""
    MESSAGES.update(messages)


def common_messages(integration_id: str, title: str) -> dict[str, str]:
    """Default messages for the codes every integration uses."""
    return {
        f"{integration_id}_not_connected": f"{title} is not connected",
        f"{integration_id}_unavailable": f"Can't reach {title}, try again",
        f"{integration_id}_not_configured": f"{title} is not configured on the server",
        f"{integration_id}_rate_limited": f"Too many requests to {title}, try again in a moment",
        f"{integration_id}_not_found": f"Not found in {title}",
        f"{integration_id}_forbidden": f"{title} refused access",
        f"{integration_id}_invalid_request": f"{title} rejected the request",
    }
