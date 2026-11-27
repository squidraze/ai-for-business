"""Gmail: Google OAuth 2 web flow + the Gmail REST API (inbox, search, read, reply, new email)."""

from app.integrations.base import Integration
from app.integrations.gmail import client
from app.integrations.gmail.router import router
from app.integrations.gmail.tools import TOOLS

integration = Integration(
    id=client.ID,
    title="Gmail",
    is_connected=client.is_connected,
    account_summary=client.account_summary,
    router=router,
    tools=TOOLS,
    prompt_scope="their Gmail",
    prompt_actions="send and answer emails",
    prompt_hint="For email, use gmail_list_threads with Gmail search syntax "
    "(from:, to:, subject:, is:unread, newer_than:7d, ...), then gmail_read_thread for details.",
    prompt_approval="sending an email or replying to one",
)
