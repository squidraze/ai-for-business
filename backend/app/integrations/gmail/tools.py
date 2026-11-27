"""AI tools over Gmail. Sending and replying are gated: the user approves them first."""

from app.ai.tools import Tool, fn_schema
from app.integrations.gmail import client as gm
from app.integrations.gmail.client import ID


async def _list_threads(uid: int, a: dict):
    return await gm.list_threads(
        uid,
        q=a.get("query") or None,
        max_results=int(a.get("max_results") or 15),
        page_token=a.get("page_token") or None,
        label=a.get("label") or ("INBOX" if not a.get("query") else None),
    )


async def _read_thread(uid: int, a: dict):
    return await gm.get_thread(uid, str(a["thread_id"]))


async def _send_email(uid: int, a: dict):
    return await gm.send_email(uid, a["to"], str(a.get("subject") or ""), str(a["body"]), cc=a.get("cc") or None)


async def _reply(uid: int, a: dict):
    return await gm.reply(uid, str(a["thread_id"]), str(a["body"]))


def _sum_send(a: dict) -> tuple[str, str]:
    lines = [f"To: {a.get('to', '')}"]
    if a.get("cc"):
        lines.append(f"Cc: {a['cc']}")
    lines.append(f"Subject: {a.get('subject', '')}")
    lines.append("")
    lines.append(str(a.get("body", "")))
    return ("Send an email", "\n".join(lines))


def _sum_reply(a: dict) -> tuple[str, str]:
    return ("Reply to an email thread", f"Thread: {a.get('thread_id', '')}\n\n{a.get('body', '')}")


TOOLS: list[Tool] = [
    Tool(
        ID,
        fn_schema(
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
        _list_threads,
    ),
    Tool(
        ID,
        fn_schema(
            "gmail_read_thread",
            "Read every message of one Gmail thread (headers and plain-text bodies).",
            {"thread_id": {"type": "string", "description": "Thread id from gmail_list_threads."}},
            ["thread_id"],
        ),
        _read_thread,
    ),
    Tool(
        ID,
        fn_schema(
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
        _send_email,
        gated=True,
        summarize=_sum_send,
    ),
    Tool(
        ID,
        fn_schema(
            "gmail_reply",
            "Reply in an existing Gmail thread (to the last sender). The user is asked to approve it before it is sent.",
            {
                "thread_id": {"type": "string", "description": "Thread id."},
                "body": {"type": "string", "description": "Plain-text reply body."},
            },
            ["thread_id", "body"],
        ),
        _reply,
        gated=True,
        summarize=_sum_reply,
    ),
]
