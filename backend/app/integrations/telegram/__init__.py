"""Telegram: the user's own account over MTProto (Telethon) — login by phone, code and 2FA."""

from app.integrations.base import DemoCall, Integration
from app.integrations.telegram import client
from app.integrations.telegram.router import router
from app.integrations.telegram.tools import TOOLS

integration = Integration(
    id=client.ID,
    title="Telegram",
    is_connected=client.is_connected,
    account_summary=client.account_summary,
    router=router,
    tools=TOOLS,
    prompt_scope="their Telegram chats",
    prompt_actions="send Telegram messages",
    prompt_hint="When the user names a chat or a person, find it with telegram_list_chats "
    "(or pass the name directly as `chat`).",
    prompt_approval="sending a Telegram message",
    demo_tool=DemoCall("Let me check your Telegram account.\n\n", "telegram_get_me"),
    demo_approval=DemoCall(
        "I will send a Telegram message to your Saved Messages — please approve it.\n\n",
        "telegram_send_message",
        lambda text: {"chat": "me", "text": text or "Hello from forBusiness (fake mode)"},
    ),
    on_shutdown=client.shutdown,
)
