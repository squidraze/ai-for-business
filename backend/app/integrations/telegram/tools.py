"""AI tools over the Telegram account. Sending is gated: the user approves it first."""

from app.ai.tools import Tool, fn_schema
from app.integrations.telegram import client as tg
from app.integrations.telegram.client import ID


async def _get_me(uid: int, a: dict):
    return await tg.get_me(uid)


async def _list_chats(uid: int, a: dict):
    return await tg.list_dialogs(uid, limit=int(a.get("limit") or 30), query=a.get("query") or None)


async def _read_messages(uid: int, a: dict):
    return await tg.get_messages(
        uid, str(a["chat"]), limit=int(a.get("limit") or 30), offset_id=a.get("offset_id") or None
    )


async def _search_messages(uid: int, a: dict):
    return await tg.search_messages(
        uid, str(a["query"]), chat_id=(str(a["chat"]) if a.get("chat") else None), limit=int(a.get("limit") or 30)
    )


async def _send_message(uid: int, a: dict):
    reply_to = a.get("reply_to_id")
    return await tg.send_message(uid, str(a["chat"]), str(a["text"]), reply_to_id=int(reply_to) if reply_to else None)


def _sum_send(a: dict) -> tuple[str, str]:
    return (f"Send a Telegram message to {a.get('chat', '?')}", str(a.get("text", "")))


CHAT_PARAM = {
    "type": "string",
    "description": "Chat id (numeric, from telegram_list_chats), @username, or a fragment of the chat title.",
}

TOOLS: list[Tool] = [
    Tool(ID, fn_schema("telegram_get_me", "Get the user's own Telegram account (name, username, phone).", {}, []), _get_me),
    Tool(
        ID,
        fn_schema(
            "telegram_list_chats",
            "List the user's Telegram chats (dialogs), most recent first, with unread counts and the last message. "
            "Use `query` to filter by chat title.",
            {
                "query": {"type": "string", "description": "Optional title filter."},
                "limit": {"type": "integer", "description": "How many chats (default 30, max 100)."},
            },
            [],
        ),
        _list_chats,
    ),
    Tool(
        ID,
        fn_schema(
            "telegram_read_messages",
            "Read recent messages of one Telegram chat, newest first.",
            {
                "chat": CHAT_PARAM,
                "limit": {"type": "integer", "description": "How many messages (default 30)."},
                "offset_id": {"type": "integer", "description": "Return messages older than this message id (paging)."},
            },
            ["chat"],
        ),
        _read_messages,
    ),
    Tool(
        ID,
        fn_schema(
            "telegram_search_messages",
            "Search Telegram messages by text, across all chats or within one chat.",
            {
                "query": {"type": "string", "description": "Text to search for."},
                "chat": {**CHAT_PARAM, "description": "Optional: limit the search to this chat."},
                "limit": {"type": "integer", "description": "Max results (default 30)."},
            },
            ["query"],
        ),
        _search_messages,
    ),
    Tool(
        ID,
        fn_schema(
            "telegram_send_message",
            "Send a Telegram message on the user's behalf. The user is asked to approve it before it is sent.",
            {
                "chat": CHAT_PARAM,
                "text": {"type": "string", "description": "Message text."},
                "reply_to_id": {"type": "integer", "description": "Optional id of a message to reply to."},
            },
            ["chat", "text"],
        ),
        _send_message,
        gated=True,
        summarize=_sum_send,
    ),
]
