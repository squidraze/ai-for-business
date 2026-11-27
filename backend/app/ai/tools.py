"""Agent tools over the Telegram and Gmail connectors.

Every tool belongs to one connector (`telegram` / `gmail`, the same ids the
Connectors switches and `disabled_connectors` use). Gated tools change the
outside world and pause the run for approval before they execute.
"""

import inspect
import json
import logging
from typing import Any, Awaitable, Callable

log = logging.getLogger("ai.tools")

MAX_RESULT_CHARS = 14000

CONNECTORS = {"telegram": "Telegram", "gmail": "Gmail", "bitrix24": "Bitrix24"}


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

    def describe(self, args: dict) -> tuple[str, str]:
        """Title and detail for the approval card. Never raises: the args were
        written by the model, and a summary that trips over them must not take
        the whole run down — the card falls back to the raw arguments."""
        if self.summarize is not None:
            try:
                title, detail = self.summarize(args)
                return str(title), str(detail)
            except Exception:
                log.exception("summary for tool %s failed", self.name)
        return self.name, _to_text(args)[:2000]


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

# ---------------------------------------------------------------- Bitrix24


def _bx():
    from app.connectors import bitrix

    return bitrix


async def _bx_list_deals(uid: int, a: dict):
    return await _bx().list_deals(uid, q=a.get("query") or None, start=int(a.get("start") or 0), stage=a.get("stage_id") or None)


async def _bx_get_deal(uid: int, a: dict):
    return await _bx().get_deal(uid, str(a["deal_id"]))


async def _bx_list_leads(uid: int, a: dict):
    return await _bx().list_leads(uid, q=a.get("query") or None, start=int(a.get("start") or 0))


async def _bx_get_lead(uid: int, a: dict):
    return await _bx().get_lead(uid, str(a["lead_id"]))


async def _bx_search_contacts(uid: int, a: dict):
    return await _bx().search_contacts(uid, str(a["query"]))


async def _bx_search_companies(uid: int, a: dict):
    return await _bx().search_companies(uid, str(a["query"]))


async def _bx_deal_stages(uid: int, a: dict):
    return await _bx().deal_stages(uid, str(a.get("category_id") or "0"))


async def _bx_list_tasks(uid: int, a: dict):
    return await _bx().list_tasks(uid, q=a.get("query") or None, only_mine=a.get("only_mine", True) is not False)


async def _bx_create_lead(uid: int, a: dict):
    return await _bx().create_lead(uid, str(a["title"]), name=a.get("name"), phone=a.get("phone"), email=a.get("email"),
                                   comments=a.get("comments"), opportunity=a.get("opportunity"))


async def _bx_create_deal(uid: int, a: dict):
    return await _bx().create_deal(uid, str(a["title"]), opportunity=a.get("opportunity"), currency=a.get("currency"),
                                   stage_id=a.get("stage_id"), contact_id=a.get("contact_id"),
                                   company_id=a.get("company_id"), comments=a.get("comments"))


async def _bx_update_deal(uid: int, a: dict):
    fields = {k: a.get(k) for k in ("title", "stage_id", "opportunity", "currency", "comments")}
    return await _bx().update_deal(uid, str(a["deal_id"]), fields)


async def _bx_add_comment(uid: int, a: dict):
    return await _bx().add_comment(uid, str(a["entity"]), str(a["entity_id"]), str(a["text"]))


async def _bx_create_task(uid: int, a: dict):
    return await _bx().create_task(uid, str(a["title"]), description=a.get("description"), deadline=a.get("deadline"))


def _sum_bx(title: str, keys: tuple[str, ...]) -> Callable[[dict], tuple[str, str]]:
    def f(a: dict) -> tuple[str, str]:
        return (title, "\n".join(f"{k}: {a[k]}" for k in keys if a.get(k) not in (None, "")))

    return f


TOOLS += [
    Tool("bitrix24", _fn(
        "bitrix_list_deals",
        "List or search Bitrix24 CRM deals, most recently changed first (50 per page), with stage, amount and assignee.",
        {"query": {"type": "string", "description": "Optional text contained in the deal title."},
         "stage_id": {"type": "string", "description": "Optional stage id (see bitrix_deal_stages)."},
         "start": {"type": "integer", "description": "Paging offset: the `next` value of the previous page."}}, []),
        _bx_list_deals),
    Tool("bitrix24", _fn("bitrix_get_deal", "Get one Bitrix24 deal with its contact, company and timeline comments.",
                         {"deal_id": {"type": "string"}}, ["deal_id"]), _bx_get_deal),
    Tool("bitrix24", _fn("bitrix_list_leads", "List or search Bitrix24 CRM leads, most recently changed first.",
                         {"query": {"type": "string", "description": "Optional text contained in the lead title."},
                          "start": {"type": "integer"}}, []), _bx_list_leads),
    Tool("bitrix24", _fn("bitrix_get_lead", "Get one Bitrix24 lead with its timeline comments.",
                         {"lead_id": {"type": "string"}}, ["lead_id"]), _bx_get_lead),
    Tool("bitrix24", _fn("bitrix_search_contacts", "Find Bitrix24 CRM contacts by first name, last name, phone or email.",
                         {"query": {"type": "string"}}, ["query"]), _bx_search_contacts),
    Tool("bitrix24", _fn("bitrix_search_companies", "Find Bitrix24 CRM companies by name.",
                         {"query": {"type": "string"}}, ["query"]), _bx_search_companies),
    Tool("bitrix24", _fn("bitrix_deal_stages", "List the deal pipeline stages (id and name); needed to move a deal.",
                         {"category_id": {"type": "string", "description": "Pipeline id, default 0 (the main one)."}}, []),
         _bx_deal_stages),
    Tool("bitrix24", _fn("bitrix_list_tasks", "List open Bitrix24 tasks, by default the user's own, nearest deadline first.",
                         {"query": {"type": "string"}, "only_mine": {"type": "boolean", "description": "Default true."}}, []),
         _bx_list_tasks),
    Tool("bitrix24", _fn(
        "bitrix_create_lead", "Create a lead in Bitrix24 CRM. The user is asked to approve it first.",
        {"title": {"type": "string"}, "name": {"type": "string", "description": "Person's full name."},
         "phone": {"type": "string"}, "email": {"type": "string"}, "comments": {"type": "string"},
         "opportunity": {"type": "number", "description": "Expected amount."}}, ["title"]),
        _bx_create_lead, gated=True,
        summarize=_sum_bx("Create a Bitrix24 lead", ("title", "name", "phone", "email", "opportunity", "comments"))),
    Tool("bitrix24", _fn(
        "bitrix_create_deal", "Create a deal in Bitrix24 CRM. The user is asked to approve it first.",
        {"title": {"type": "string"}, "opportunity": {"type": "number"},
         "currency": {"type": "string", "description": "e.g. USD, RUB, UZS"}, "stage_id": {"type": "string"},
         "contact_id": {"type": "string"}, "company_id": {"type": "string"}, "comments": {"type": "string"}}, ["title"]),
        _bx_create_deal, gated=True,
        summarize=_sum_bx("Create a Bitrix24 deal", ("title", "opportunity", "currency", "stage_id", "contact_id", "company_id", "comments"))),
    Tool("bitrix24", _fn(
        "bitrix_update_deal",
        "Change a Bitrix24 deal: move it to another stage, change the amount, title or comments. Approval required.",
        {"deal_id": {"type": "string"},
         "stage_id": {"type": "string", "description": "Target stage id from bitrix_deal_stages."},
         "title": {"type": "string"}, "opportunity": {"type": "number"}, "currency": {"type": "string"},
         "comments": {"type": "string"}}, ["deal_id"]),
        _bx_update_deal, gated=True,
        summarize=_sum_bx("Update a Bitrix24 deal", ("deal_id", "stage_id", "title", "opportunity", "currency", "comments"))),
    Tool("bitrix24", _fn(
        "bitrix_add_comment",
        "Add a comment to the timeline of a Bitrix24 deal, lead, contact or company. Approval required.",
        {"entity": {"type": "string", "enum": ["deal", "lead", "contact", "company"]},
         "entity_id": {"type": "string"}, "text": {"type": "string"}}, ["entity", "entity_id", "text"]),
        _bx_add_comment, gated=True,
        summarize=_sum_bx("Add a comment in Bitrix24", ("entity", "entity_id", "text"))),
    Tool("bitrix24", _fn(
        "bitrix_create_task", "Create a Bitrix24 task for the user. Approval required.",
        {"title": {"type": "string"}, "description": {"type": "string"},
         "deadline": {"type": "string", "description": "ISO 8601 date-time, e.g. 2026-11-25T18:00:00+05:00"}}, ["title"]),
        _bx_create_task, gated=True,
        summarize=_sum_bx("Create a Bitrix24 task", ("title", "deadline", "description"))),
]

BY_NAME = {t.name: t for t in TOOLS}


# ---------------------------------------------------------------- tool providers
# Modules outside the connectors (e.g. app.schedules) contribute tools here, so
# this file never needs to know about them. A provider is `fn(user_id) -> list[Tool]`
# (sync or async); its tools are offered regardless of connector status, unless
# their `connector` id is switched off for the conversation.

ToolProvider = Callable[[int], Any]
_PROVIDERS: list[ToolProvider] = []


def register_tool_provider(fn: ToolProvider) -> ToolProvider:
    if fn not in _PROVIDERS:
        _PROVIDERS.append(fn)
    return fn


async def provided_tools(user_id: int) -> list["Tool"]:
    out: list[Tool] = []
    for fn in list(_PROVIDERS):
        try:
            result = fn(user_id)
            if inspect.isawaitable(result):
                result = await result
            out.extend(result or [])
        except Exception:
            log.exception("tool provider %s failed", getattr(fn, "__qualname__", fn))
    return out


async def get_tool(user_id: int, name: str) -> "Tool | None":
    """A connector tool by name, or one a provider offers this user."""
    tool = BY_NAME.get(name)
    if tool is not None:
        return tool
    for t in await provided_tools(user_id):
        if t.name == name:
            return t
    return None


async def connector_status(user_id: int) -> dict[str, bool]:
    """{connector_id: connected} — a connector that fails to answer counts as not connected."""
    out: dict[str, bool] = {}
    for cid, mod in (("telegram", _tg), ("gmail", _gm), ("bitrix24", _bx)):
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
    tools += [t for t in await provided_tools(user_id) if t.connector not in off]
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
    tool = await get_tool(user_id, name)
    if not tool:
        return f"Error: unknown tool '{name}'."
    try:
        result = await tool.impl(user_id, args or {})
        return _to_text(result if result is not None else "ok")
    except Exception as e:
        cls = type(e).__name__
        if cls == "NotConnected":
            return f"Error: {CONNECTORS.get(tool.connector, tool.connector)} is not connected. Ask the user to connect it on the Connectors screen of the app. ({e})"
        if isinstance(e, KeyError):
            return f"Error: missing required argument {e}."
        log.exception("tool %s failed", name)
        detail = getattr(e, "detail", None) or str(e) or cls
        return f"Error: {name} failed: {detail}"
