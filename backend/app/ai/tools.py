"""Agent tools over the Telegram and Gmail connectors.

Every tool belongs to one connector (`telegram` / `gmail`, the same ids the
Connectors switches and `disabled_connectors` use). Gated tools change the
outside world and pause the run for approval before they execute.
"""

import json
import logging
from typing import Any, Awaitable, Callable

log = logging.getLogger("ai.tools")

MAX_RESULT_CHARS = 14000

CONNECTORS = {"telegram": "Telegram", "gmail": "Gmail"}


def _tg():
    from app.connectors import telegram

    return telegram


def _gm():
    from app.connectors import gmail

    return gmail


def _fn(name: str, description: str, properties: dict, required: list[str]) -> dict:
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": {"type": "object", "properties": properties, "required": required},
        },
    }


# ---------------------------------------------------------------- implementations


async def _telegram_get_me(uid: int, a: dict):
    return await _tg().get_me(uid)


async def _telegram_list_chats(uid: int, a: dict):
    return await _tg().list_dialogs(uid, limit=int(a.get("limit") or 30), query=a.get("query") or None)


async def _telegram_read_messages(uid: int, a: dict):
    msgs = await _tg().get_messages(
        uid, str(a["chat"]), limit=int(a.get("limit") or 30), offset_id=a.get("offset_id") or None
    )
    return msgs


async def _telegram_search_messages(uid: int, a: dict):
    return await _tg().search_messages(
        uid, str(a["query"]), chat_id=(str(a["chat"]) if a.get("chat") else None), limit=int(a.get("limit") or 30)
    )


async def _telegram_send_message(uid: int, a: dict):
    reply_to = a.get("reply_to_id")
    return await _tg().send_message(uid, str(a["chat"]), str(a["text"]), reply_to_id=int(reply_to) if reply_to else None)


async def _gmail_list_threads(uid: int, a: dict):
    return await _gm().list_threads(
        uid,
        q=a.get("query") or None,
        max_results=int(a.get("max_results") or 15),
        page_token=a.get("page_token") or None,
        label=a.get("label") or ("INBOX" if not a.get("query") else None),
    )


async def _gmail_read_thread(uid: int, a: dict):
    return await _gm().get_thread(uid, str(a["thread_id"]))


async def _gmail_send_email(uid: int, a: dict):
    return await _gm().send_email(uid, a["to"], str(a.get("subject") or ""), str(a["body"]), cc=a.get("cc") or None)


async def _gmail_reply(uid: int, a: dict):
    return await _gm().reply(uid, str(a["thread_id"]), str(a["body"]))


# ---------------------------------------------------------------- registry


class Tool:
    def __init__(
        self,
        connector: str,
        schema: dict,
        impl: Callable[[int, dict], Awaitable[Any]],
        gated: bool = False,
        summarize: Callable[[dict], tuple[str, str]] | None = None,
    ):
        self.connector = connector
        self.schema = schema
        self.name = schema["function"]["name"]
        self.impl = impl
        self.gated = gated
        self.summarize = summarize


def _sum_tg_send(a: dict) -> tuple[str, str]:
    return (f"Send a Telegram message to {a.get('chat', '?')}", str(a.get("text", "")))


def _sum_gm_send(a: dict) -> tuple[str, str]:
    lines = [f"To: {a.get('to', '')}"]
    if a.get("cc"):
        lines.append(f"Cc: {a['cc']}")
    lines.append(f"Subject: {a.get('subject', '')}")
    lines.append("")
    lines.append(str(a.get("body", "")))
    return ("Send an email", "\n".join(lines))


def _sum_gm_reply(a: dict) -> tuple[str, str]:
    return ("Reply to an email thread", f"Thread: {a.get('thread_id', '')}\n\n{a.get('body', '')}")


CHAT_PARAM = {
    "type": "string",
    "description": "Chat id (numeric, from telegram_list_chats), @username, or a fragment of the chat title.",
}

TOOLS: list[Tool] = [
    Tool("telegram", _fn("telegram_get_me", "Get the user's own Telegram account (name, username, phone).", {}, []), _telegram_get_me),
    Tool(
        "telegram",
        _fn(
            "telegram_list_chats",
            "List the user's Telegram chats (dialogs), most recent first, with unread counts and the last message. "
            "Use `query` to filter by chat title.",
            {
                "query": {"type": "string", "description": "Optional title filter."},
                "limit": {"type": "integer", "description": "How many chats (default 30, max 100)."},
            },
            [],
        ),
        _telegram_list_chats,
    ),
    Tool(
        "telegram",
        _fn(
            "telegram_read_messages",
            "Read recent messages of one Telegram chat, newest first.",
            {
                "chat": CHAT_PARAM,
                "limit": {"type": "integer", "description": "How many messages (default 30)."},
                "offset_id": {"type": "integer", "description": "Return messages older than this message id (paging)."},
            },
            ["chat"],
        ),
        _telegram_read_messages,
    ),
    Tool(
        "telegram",
        _fn(
            "telegram_search_messages",
            "Search Telegram messages by text, across all chats or within one chat.",
            {
                "query": {"type": "string", "description": "Text to search for."},
                "chat": {**CHAT_PARAM, "description": "Optional: limit the search to this chat."},
                "limit": {"type": "integer", "description": "Max results (default 30)."},
            },
            ["query"],
        ),
        _telegram_search_messages,
    ),
    Tool(
        "telegram",
        _fn(
            "telegram_send_message",
            "Send a Telegram message on the user's behalf. The user is asked to approve it before it is sent.",
            {
                "chat": CHAT_PARAM,
                "text": {"type": "string", "description": "Message text."},
                "reply_to_id": {"type": "integer", "description": "Optional id of a message to reply to."},
            },
            ["chat", "text"],
        ),
        _telegram_send_message,
        gated=True,
        summarize=_sum_tg_send,
    ),
    Tool(
        "gmail",
        _fn(
            "gmail_list_threads",
            "List or search the user's Gmail threads, newest first. `query` accepts full Gmail search syntax "
            "(e.g. 'from:bob is:unread newer_than:7d', 'subject:invoice'). Without a query lists the inbox.",
            {
                "query": {"type": "string", "description": "Gmail search query."},
                "max_results": {"type": "integer", "description": "Default 15, max 50."},
                "label": {"type": "string", "description": "Label id, e.g. INBOX, SENT, STARRED. Defaults to INBOX when no query."},
                "page_token": {"type": "string", "description": "Paging token from a previous call."},
            },
            [],
        ),
        _gmail_list_threads,
    ),
    Tool(
        "gmail",
        _fn(
            "gmail_read_thread",
            "Read every message of one Gmail thread (headers and plain-text bodies).",
            {"thread_id": {"type": "string", "description": "Thread id from gmail_list_threads."}},
            ["thread_id"],
        ),
        _gmail_read_thread,
    ),
    Tool(
        "gmail",
        _fn(
            "gmail_send_email",
            "Send a new email from the user's Gmail. The user is asked to approve it before it is sent.",
            {
                "to": {"type": "string", "description": "Recipient address(es), comma-separated."},
                "subject": {"type": "string"},
                "body": {"type": "string", "description": "Plain-text body."},
                "cc": {"type": "string", "description": "Optional Cc address(es), comma-separated."},
            },
            ["to", "subject", "body"],
        ),
        _gmail_send_email,
        gated=True,
        summarize=_sum_gm_send,
    ),
    Tool(
        "gmail",
        _fn(
            "gmail_reply",
            "Reply in an existing Gmail thread (to the last sender). The user is asked to approve it before it is sent.",
            {
                "thread_id": {"type": "string", "description": "Thread id."},
                "body": {"type": "string", "description": "Plain-text reply body."},
            },
            ["thread_id", "body"],
        ),
        _gmail_reply,
        gated=True,
        summarize=_sum_gm_reply,
    ),
]

BY_NAME = {t.name: t for t in TOOLS}


async def connector_status(user_id: int) -> dict[str, bool]:
    """{connector_id: connected} — a connector that fails to answer counts as not connected."""
    out: dict[str, bool] = {}
    for cid, mod in (("telegram", _tg), ("gmail", _gm)):
        try:
            out[cid] = bool(await mod().is_connected(user_id))
        except Exception as e:  # ImportError until the connectors exist, or a broken session
            log.warning("is_connected(%s) failed: %s", cid, e)
            out[cid] = False
    return out


async def available_tools(user_id: int, disabled: list[str] | None) -> tuple[list[Tool], dict[str, bool]]:
    status = await connector_status(user_id)
    off = set(disabled or [])
    tools = [t for t in TOOLS if status.get(t.connector) and t.connector not in off]
    return tools, status


def _to_text(result: Any) -> str:
    if isinstance(result, str):
        text = result
    else:
        text = json.dumps(result, ensure_ascii=False, default=str)
    if len(text) > MAX_RESULT_CHARS:
        text = text[:MAX_RESULT_CHARS] + "\n…[truncated]"
    return text


async def execute(user_id: int, name: str, args: dict) -> str:
    """Run one tool and return its result as text for the model. Never raises."""
    tool = BY_NAME.get(name)
    if not tool:
        return f"Error: unknown tool '{name}'."
    try:
        result = await tool.impl(user_id, args or {})
        return _to_text(result if result is not None else "ok")
    except Exception as e:
        cls = type(e).__name__
        if cls == "NotConnected":
            return f"Error: {CONNECTORS[tool.connector]} is not connected. Ask the user to connect it on the Connectors screen of the app. ({e})"
        if isinstance(e, KeyError):
            return f"Error: missing required argument {e}."
        log.exception("tool %s failed", name)
        detail = getattr(e, "detail", None) or str(e) or cls
        return f"Error: {name} failed: {detail}"
