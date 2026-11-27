"""AI tools over the Bitrix24 CRM. Every create / update / comment is gated: the user approves it first."""

from typing import Callable

from app.ai.tools import Tool, fn_schema
from app.integrations.bitrix24 import client as bx
from app.integrations.bitrix24.client import ID


async def _list_deals(uid: int, a: dict):
    return await bx.list_deals(uid, q=a.get("query") or None, start=int(a.get("start") or 0), stage=a.get("stage_id") or None)


async def _get_deal(uid: int, a: dict):
    return await bx.get_deal(uid, str(a["deal_id"]))


async def _list_leads(uid: int, a: dict):
    return await bx.list_leads(uid, q=a.get("query") or None, start=int(a.get("start") or 0))


async def _get_lead(uid: int, a: dict):
    return await bx.get_lead(uid, str(a["lead_id"]))


async def _search_contacts(uid: int, a: dict):
    return await bx.search_contacts(uid, str(a["query"]))


async def _search_companies(uid: int, a: dict):
    return await bx.search_companies(uid, str(a["query"]))


async def _deal_stages(uid: int, a: dict):
    return await bx.deal_stages(uid, str(a.get("category_id") or "0"))


async def _list_tasks(uid: int, a: dict):
    return await bx.list_tasks(uid, q=a.get("query") or None, only_mine=a.get("only_mine", True) is not False)


async def _create_lead(uid: int, a: dict):
    return await bx.create_lead(uid, str(a["title"]), name=a.get("name"), phone=a.get("phone"), email=a.get("email"),
                                comments=a.get("comments"), opportunity=a.get("opportunity"))


async def _create_deal(uid: int, a: dict):
    return await bx.create_deal(uid, str(a["title"]), opportunity=a.get("opportunity"), currency=a.get("currency"),
                                stage_id=a.get("stage_id"), contact_id=a.get("contact_id"),
                                company_id=a.get("company_id"), comments=a.get("comments"))


async def _update_deal(uid: int, a: dict):
    fields = {k: a.get(k) for k in ("title", "stage_id", "opportunity", "currency", "comments")}
    return await bx.update_deal(uid, str(a["deal_id"]), fields)


async def _add_comment(uid: int, a: dict):
    return await bx.add_comment(uid, str(a["entity"]), str(a["entity_id"]), str(a["text"]))


async def _create_task(uid: int, a: dict):
    return await bx.create_task(uid, str(a["title"]), description=a.get("description"), deadline=a.get("deadline"))


def _summary(title: str, keys: tuple[str, ...]) -> Callable[[dict], tuple[str, str]]:
    def f(a: dict) -> tuple[str, str]:
        return (title, "\n".join(f"{k}: {a[k]}" for k in keys if a.get(k) not in (None, "")))

    return f


TOOLS: list[Tool] = [
    Tool(ID, fn_schema(
        "bitrix_list_deals",
        "List or search Bitrix24 CRM deals, most recently changed first (50 per page), with stage, amount and assignee.",
        {"query": {"type": "string", "description": "Optional text contained in the deal title."},
         "stage_id": {"type": "string", "description": "Optional stage id (see bitrix_deal_stages)."},
         "start": {"type": "integer", "description": "Paging offset: the `next` value of the previous page."}}, []),
        _list_deals),
    Tool(ID, fn_schema("bitrix_get_deal", "Get one Bitrix24 deal with its contact, company and timeline comments.",
                       {"deal_id": {"type": "string"}}, ["deal_id"]), _get_deal),
    Tool(ID, fn_schema("bitrix_list_leads", "List or search Bitrix24 CRM leads, most recently changed first.",
                       {"query": {"type": "string", "description": "Optional text contained in the lead title."},
                        "start": {"type": "integer"}}, []), _list_leads),
    Tool(ID, fn_schema("bitrix_get_lead", "Get one Bitrix24 lead with its timeline comments.",
                       {"lead_id": {"type": "string"}}, ["lead_id"]), _get_lead),
    Tool(ID, fn_schema("bitrix_search_contacts", "Find Bitrix24 CRM contacts by first name, last name, phone or email.",
                       {"query": {"type": "string"}}, ["query"]), _search_contacts),
    Tool(ID, fn_schema("bitrix_search_companies", "Find Bitrix24 CRM companies by name.",
                       {"query": {"type": "string"}}, ["query"]), _search_companies),
    Tool(ID, fn_schema("bitrix_deal_stages", "List the deal pipeline stages (id and name); needed to move a deal.",
                       {"category_id": {"type": "string", "description": "Pipeline id, default 0 (the main one)."}}, []),
         _deal_stages),
    Tool(ID, fn_schema("bitrix_list_tasks", "List open Bitrix24 tasks, by default the user's own, nearest deadline first.",
                       {"query": {"type": "string"}, "only_mine": {"type": "boolean", "description": "Default true."}}, []),
         _list_tasks),
    Tool(ID, fn_schema(
        "bitrix_create_lead", "Create a lead in Bitrix24 CRM. The user is asked to approve it first.",
        {"title": {"type": "string"}, "name": {"type": "string", "description": "Person's full name."},
         "phone": {"type": "string"}, "email": {"type": "string"}, "comments": {"type": "string"},
         "opportunity": {"type": "number", "description": "Expected amount."}}, ["title"]),
        _create_lead, gated=True,
        summarize=_summary("Create a Bitrix24 lead", ("title", "name", "phone", "email", "opportunity", "comments"))),
    Tool(ID, fn_schema(
        "bitrix_create_deal", "Create a deal in Bitrix24 CRM. The user is asked to approve it first.",
        {"title": {"type": "string"}, "opportunity": {"type": "number"},
         "currency": {"type": "string", "description": "e.g. USD, RUB, UZS"}, "stage_id": {"type": "string"},
         "contact_id": {"type": "string"}, "company_id": {"type": "string"}, "comments": {"type": "string"}}, ["title"]),
        _create_deal, gated=True,
        summarize=_summary("Create a Bitrix24 deal", ("title", "opportunity", "currency", "stage_id", "contact_id", "company_id", "comments"))),
    Tool(ID, fn_schema(
        "bitrix_update_deal",
        "Change a Bitrix24 deal: move it to another stage, change the amount, title or comments. Approval required.",
        {"deal_id": {"type": "string"},
         "stage_id": {"type": "string", "description": "Target stage id from bitrix_deal_stages."},
         "title": {"type": "string"}, "opportunity": {"type": "number"}, "currency": {"type": "string"},
         "comments": {"type": "string"}}, ["deal_id"]),
        _update_deal, gated=True,
        summarize=_summary("Update a Bitrix24 deal", ("deal_id", "stage_id", "title", "opportunity", "currency", "comments"))),
    Tool(ID, fn_schema(
        "bitrix_add_comment",
        "Add a comment to the timeline of a Bitrix24 deal, lead, contact or company. Approval required.",
        {"entity": {"type": "string", "enum": ["deal", "lead", "contact", "company"]},
         "entity_id": {"type": "string"}, "text": {"type": "string"}}, ["entity", "entity_id", "text"]),
        _add_comment, gated=True,
        summarize=_summary("Add a comment in Bitrix24", ("entity", "entity_id", "text"))),
    Tool(ID, fn_schema(
        "bitrix_create_task", "Create a Bitrix24 task for the user. Approval required.",
        {"title": {"type": "string"}, "description": {"type": "string"},
         "deadline": {"type": "string", "description": "ISO 8601 date-time, e.g. 2026-11-25T18:00:00+05:00"}}, ["title"]),
        _create_task, gated=True,
        summarize=_summary("Create a Bitrix24 task", ("title", "deadline", "description"))),
]
