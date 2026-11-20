"""Bitrix24 CRM connector over an *incoming webhook*.

The user creates "Inbound webhook" in their portal (Developer resources → Other) and pastes the
URL `https://<portal>/rest/<user_id>/<token>/`. Every REST method is then
`POST {webhook_url}{method}.json` with a JSON body; the answer is
`{result, next?, total?}` or `{error, error_description}`. No OAuth, nothing in .env.
"""

from __future__ import annotations

import asyncio
import logging
import re
from typing import Any
from urllib.parse import urlparse

import httpx
from sqlalchemy import select

from app.connectors.errors import ConnectorError, NotConnected
from app.connectors.models import BitrixConnection
from app.db import SessionLocal

log = logging.getLogger("connectors.bitrix")

NOT_CONNECTED = "Bitrix24 is not connected"
PAGE = 50
_WEBHOOK_RE = re.compile(r"^https?://[^/\s]+(/[^\s]*)?/rest/\d+/[A-Za-z0-9_-]+/?$")

# Bitrix allows ~2 requests/s per portal; keep this process polite.
_sem = asyncio.Semaphore(2)
# stage/status names change rarely — cache per portal
_dict_cache: dict[tuple[str, str], dict[str, str]] = {}
_user_cache: dict[tuple[str, str], str] = {}


# ----------------------------------------------------------------------------- storage


def _row(user_id: int) -> BitrixConnection | None:
    with SessionLocal() as db:
        return db.scalar(select(BitrixConnection).where(BitrixConnection.user_id == user_id))


def _base(user_id: int) -> str:
    row = _row(user_id)
    if row is None or not row.webhook_url:
        raise NotConnected(NOT_CONNECTED)
    return row.webhook_url


def _portal(url: str) -> str:
    p = urlparse(url)
    return f"{p.scheme}://{p.netloc}"


async def is_connected(user_id: int) -> bool:
    return _row(user_id) is not None


def account_summary(user_id: int) -> dict | None:
    row = _row(user_id)
    return row.account if row else None


# ----------------------------------------------------------------------------- transport


async def _call_url(base: str, method: str, params: dict | None = None) -> dict:
    url = f"{base}{method}.json"
    async with _sem:
        for attempt in range(3):
            try:
                async with httpx.AsyncClient(timeout=20) as http:
                    r = await http.post(url, json=params or {})
            except httpx.HTTPError as e:
                raise ConnectorError(502, f"Bitrix24 is unreachable: {type(e).__name__}") from e
            try:
                data = r.json()
            except ValueError:
                # not the REST API at all (wrong host, portal gone, a proxy page)
                raise ConnectorError(
                    400, f"The portal answered HTTP {r.status_code}, not Bitrix24 REST — check the webhook address"
                )
            err = data.get("error") if isinstance(data, dict) else None
            if err == "QUERY_LIMIT_EXCEEDED" and attempt < 2:
                await asyncio.sleep(1.0 + attempt)
                continue
            if err or r.status_code >= 400:
                desc = (data.get("error_description") if isinstance(data, dict) else None) or err or r.text[:200]
                if r.status_code == 401 or err in ("INVALID_CREDENTIALS", "NO_AUTH_FOUND", "expired_token"):
                    raise ConnectorError(400, f"Bitrix24 rejected the webhook: {desc}")
                if err == "insufficient_scope" or r.status_code == 403:
                    raise ConnectorError(403, f"The webhook lacks a permission (scope) for {method}: {desc}")
                if r.status_code == 404 and not err:
                    raise ConnectorError(400, "That URL is not a Bitrix24 webhook (404)")
                raise ConnectorError(400, f"Bitrix24 {method}: {desc}")
            return data
    raise ConnectorError(429, "Bitrix24 rate limit, try again in a few seconds")


async def _call(user_id: int, method: str, params: dict | None = None) -> dict:
    return await _call_url(_base(user_id), method, params)


# ----------------------------------------------------------------------------- connect


def _normalize(url: str) -> str:
    url = (url or "").strip()
    # people paste the full sample call too: .../rest/1/abc/profile.json → .../rest/1/abc/
    url = re.sub(r"/[a-z0-9_.]+\.json.*$", "/", url, flags=re.I)
    if not url.endswith("/"):
        url += "/"
    if not _WEBHOOK_RE.match(url):
        raise ConnectorError(
            400, "This doesn't look like a Bitrix24 webhook URL. Expected https://<portal>/rest/<id>/<token>/"
        )
    return url


async def connect(user_id: int, webhook_url: str) -> dict:
    url = _normalize(webhook_url)
    data = await _call_url(url, "profile")
    p = data.get("result") or {}
    name = " ".join(x for x in (p.get("NAME"), p.get("LAST_NAME")) if x) or p.get("EMAIL") or "Bitrix24 user"
    account = {"portal": urlparse(url).netloc, "user_name": name, "user_id": str(p.get("ID") or "")}
    # the webhook must be able to read the CRM, or nothing else will work
    try:
        await _call_url(url, "crm.deal.list", {"select": ["ID"], "start": 0})
    except ConnectorError as e:
        raise ConnectorError(400, f"Connected, but the CRM is not available — tick the CRM permission on the webhook. ({e})")
    with SessionLocal() as db:
        row = db.scalar(select(BitrixConnection).where(BitrixConnection.user_id == user_id))
        if row is None:
            row = BitrixConnection(user_id=user_id, webhook_url=url)
            db.add(row)
        row.webhook_url = url
        row.account = account
        db.commit()
    return {"status": "ok", "account": account}


async def disconnect(user_id: int) -> None:
    with SessionLocal() as db:
        row = db.scalar(select(BitrixConnection).where(BitrixConnection.user_id == user_id))
        if row is not None:
            db.delete(row)
            db.commit()


# ----------------------------------------------------------------------------- lookups


async def _statuses(user_id: int, entity_id: str) -> dict[str, str]:
    base = _base(user_id)
    key = (base, entity_id)
    if key not in _dict_cache:
        try:
            data = await _call_url(base, "crm.status.list", {"filter": {"ENTITY_ID": entity_id}})
            _dict_cache[key] = {s["STATUS_ID"]: s["NAME"] for s in data.get("result") or []}
        except ConnectorError:
            _dict_cache[key] = {}
    return _dict_cache[key]


async def _stage_name(user_id: int, stage_id: str | None, category_id: Any) -> str:
    if not stage_id:
        return ""
    cat = str(category_id or "0")
    names = await _statuses(user_id, "DEAL_STAGE" if cat == "0" else f"DEAL_STAGE_{cat}")
    return names.get(stage_id) or stage_id


async def _user_name(user_id: int, uid: Any) -> str | None:
    if not uid:
        return None
    base = _base(user_id)
    key = (base, str(uid))
    if key not in _user_cache:
        try:
            data = await _call_url(base, "user.get", {"ID": str(uid)})
            u = (data.get("result") or [{}])[0]
            _user_cache[key] = " ".join(x for x in (u.get("NAME"), u.get("LAST_NAME")) if x) or f"User {uid}"
        except ConnectorError:
            _user_cache[key] = f"User {uid}"
    return _user_cache[key]


async def _contact_name(user_id: int, cid: Any) -> str | None:
    if not cid or str(cid) == "0":
        return None
    try:
        c = (await _call(user_id, "crm.contact.get", {"id": cid})).get("result") or {}
        return " ".join(x for x in (c.get("NAME"), c.get("LAST_NAME")) if x) or None
    except ConnectorError:
        return None


async def _company_title(user_id: int, cid: Any) -> str | None:
    if not cid or str(cid) == "0":
        return None
    try:
        return ((await _call(user_id, "crm.company.get", {"id": cid})).get("result") or {}).get("TITLE")
    except ConnectorError:
        return None


def _num(v) -> float | None:
    try:
        return float(v) if v not in (None, "") else None
    except (TypeError, ValueError):
        return None


def _first_multi(v) -> str | None:
    # PHONE / EMAIL come as [{VALUE, VALUE_TYPE}]
    if isinstance(v, list) and v:
        return v[0].get("VALUE")
    return None


# ----------------------------------------------------------------------------- deals & leads

DEAL_SELECT = ["ID", "TITLE", "STAGE_ID", "CATEGORY_ID", "OPPORTUNITY", "CURRENCY_ID", "CONTACT_ID",
               "COMPANY_ID", "ASSIGNED_BY_ID", "DATE_CREATE", "DATE_MODIFY", "COMMENTS"]
LEAD_SELECT = ["ID", "TITLE", "STATUS_ID", "NAME", "LAST_NAME", "PHONE", "EMAIL", "OPPORTUNITY", "CURRENCY_ID",
               "ASSIGNED_BY_ID", "SOURCE_ID", "DATE_CREATE", "DATE_MODIFY", "COMMENTS"]


async def _deal_view(user_id: int, d: dict, full: bool = False) -> dict:
    base = _base(user_id)
    out = {
        "id": str(d.get("ID")),
        "title": d.get("TITLE") or "",
        "stage_id": d.get("STAGE_ID") or "",
        "stage_name": await _stage_name(user_id, d.get("STAGE_ID"), d.get("CATEGORY_ID")),
        "opportunity": _num(d.get("OPPORTUNITY")),
        "currency": d.get("CURRENCY_ID"),
        "contact_name": None,
        "company_title": None,
        "assigned_name": await _user_name(user_id, d.get("ASSIGNED_BY_ID")),
        "date_create": d.get("DATE_CREATE"),
        "date_modify": d.get("DATE_MODIFY"),
        "comments_text": d.get("COMMENTS") or None,
        "url": f"{_portal(base)}/crm/deal/details/{d.get('ID')}/",
    }
    if full:
        out["contact_name"] = await _contact_name(user_id, d.get("CONTACT_ID"))
        out["company_title"] = await _company_title(user_id, d.get("COMPANY_ID"))
    return out


async def _lead_view(user_id: int, d: dict) -> dict:
    base = _base(user_id)
    statuses = await _statuses(user_id, "STATUS")
    sources = await _statuses(user_id, "SOURCE")
    return {
        "id": str(d.get("ID")),
        "title": d.get("TITLE") or "",
        "status_id": d.get("STATUS_ID") or "",
        "status_name": statuses.get(d.get("STATUS_ID") or "") or d.get("STATUS_ID") or "",
        "name": " ".join(x for x in (d.get("NAME"), d.get("LAST_NAME")) if x) or None,
        "phone": _first_multi(d.get("PHONE")),
        "email": _first_multi(d.get("EMAIL")),
        "opportunity": _num(d.get("OPPORTUNITY")),
        "currency": d.get("CURRENCY_ID"),
        "assigned_name": await _user_name(user_id, d.get("ASSIGNED_BY_ID")),
        "source": sources.get(d.get("SOURCE_ID") or "") or d.get("SOURCE_ID"),
        "date_create": d.get("DATE_CREATE"),
        "date_modify": d.get("DATE_MODIFY"),
        "comments_text": d.get("COMMENTS") or None,
        "url": f"{_portal(base)}/crm/lead/details/{d.get('ID')}/",
    }


async def list_deals(user_id: int, q: str | None = None, start: int = 0, stage: str | None = None) -> dict:
    flt: dict = {}
    if q:
        flt["%TITLE"] = q
    if stage:
        flt["STAGE_ID"] = stage
    data = await _call(user_id, "crm.deal.list",
                       {"order": {"DATE_MODIFY": "DESC"}, "filter": flt, "select": DEAL_SELECT, "start": start})
    items = [await _deal_view(user_id, d) for d in data.get("result") or []]
    return {"items": items, "next": data.get("next"), "total": data.get("total")}


async def list_leads(user_id: int, q: str | None = None, start: int = 0) -> dict:
    flt = {"%TITLE": q} if q else {}
    data = await _call(user_id, "crm.lead.list",
                       {"order": {"DATE_MODIFY": "DESC"}, "filter": flt, "select": LEAD_SELECT, "start": start})
    items = [await _lead_view(user_id, d) for d in data.get("result") or []]
    return {"items": items, "next": data.get("next"), "total": data.get("total")}


async def comments(user_id: int, entity: str, entity_id: str) -> list[dict]:
    data = await _call(user_id, "crm.timeline.comment.list", {
        "filter": {"ENTITY_ID": entity_id, "ENTITY_TYPE": entity},
        "select": ["ID", "COMMENT", "AUTHOR_ID", "CREATED"],
        "order": {"CREATED": "DESC"},
    })
    out = []
    for c in data.get("result") or []:
        text = re.sub(r"\[/?[a-zA-Z]+[^\]]*\]", "", c.get("COMMENT") or "")  # strip BB-code
        out.append({"id": str(c.get("ID")), "text": text, "author_name": await _user_name(user_id, c.get("AUTHOR_ID")),
                    "created": c.get("CREATED")})
    return out


async def get_deal(user_id: int, deal_id: str) -> dict:
    d = (await _call(user_id, "crm.deal.get", {"id": deal_id})).get("result")
    if not d:
        raise ConnectorError(404, f"Deal {deal_id} not found")
    view = await _deal_view(user_id, d, full=True)
    view["comments"] = await comments(user_id, "deal", view["id"])
    return view


async def get_lead(user_id: int, lead_id: str) -> dict:
    d = (await _call(user_id, "crm.lead.get", {"id": lead_id})).get("result")
    if not d:
        raise ConnectorError(404, f"Lead {lead_id} not found")
    view = await _lead_view(user_id, d)
    view["comments"] = await comments(user_id, "lead", view["id"])
    return view


async def add_comment(user_id: int, entity: str, entity_id: str, text: str) -> dict:
    if entity not in ("deal", "lead", "contact", "company"):
        raise ConnectorError(400, "entity must be deal, lead, contact or company")
    data = await _call(user_id, "crm.timeline.comment.add",
                       {"fields": {"ENTITY_ID": int(entity_id), "ENTITY_TYPE": entity, "COMMENT": text}})
    return {"id": str(data.get("result"))}


# ----------------------------------------------------------------------------- AI-facing helpers


async def deal_stages(user_id: int, category_id: str = "0") -> list[dict]:
    names = await _statuses(user_id, "DEAL_STAGE" if str(category_id) == "0" else f"DEAL_STAGE_{category_id}")
    return [{"id": k, "name": v} for k, v in names.items()]


async def search_contacts(user_id: int, q: str) -> list[dict]:
    seen: dict[str, dict] = {}
    select_ = ["ID", "NAME", "LAST_NAME", "PHONE", "EMAIL", "COMPANY_ID", "POST"]
    filters = [{"%LAST_NAME": q}, {"%NAME": q}]
    if "@" in q:
        filters = [{"EMAIL": q}]
    elif re.fullmatch(r"[+\d\s()-]{5,}", q):
        filters = [{"PHONE": q}]
    for flt in filters:
        data = await _call(user_id, "crm.contact.list", {"filter": flt, "select": select_})
        for c in data.get("result") or []:
            seen[str(c["ID"])] = {
                "id": str(c["ID"]),
                "name": " ".join(x for x in (c.get("NAME"), c.get("LAST_NAME")) if x),
                "phone": _first_multi(c.get("PHONE")),
                "email": _first_multi(c.get("EMAIL")),
                "position": c.get("POST"),
                "company": await _company_title(user_id, c.get("COMPANY_ID")),
                "url": f"{_portal(_base(user_id))}/crm/contact/details/{c['ID']}/",
            }
    return list(seen.values())[:PAGE]


async def search_companies(user_id: int, q: str) -> list[dict]:
    data = await _call(user_id, "crm.company.list",
                       {"filter": {"%TITLE": q}, "select": ["ID", "TITLE", "PHONE", "EMAIL", "INDUSTRY"]})
    return [{"id": str(c["ID"]), "title": c.get("TITLE"), "phone": _first_multi(c.get("PHONE")),
             "email": _first_multi(c.get("EMAIL")), "industry": c.get("INDUSTRY"),
             "url": f"{_portal(_base(user_id))}/crm/company/details/{c['ID']}/"} for c in data.get("result") or []]


async def create_lead(user_id: int, title: str, name: str | None = None, phone: str | None = None,
                      email: str | None = None, comments: str | None = None, opportunity: float | None = None) -> dict:
    fields: dict = {"TITLE": title}
    if name:
        parts = name.split(" ", 1)
        fields["NAME"] = parts[0]
        if len(parts) > 1:
            fields["LAST_NAME"] = parts[1]
    if phone:
        fields["PHONE"] = [{"VALUE": phone, "VALUE_TYPE": "WORK"}]
    if email:
        fields["EMAIL"] = [{"VALUE": email, "VALUE_TYPE": "WORK"}]
    if comments:
        fields["COMMENTS"] = comments
    if opportunity is not None:
        fields["OPPORTUNITY"] = opportunity
    lead_id = (await _call(user_id, "crm.lead.add", {"fields": fields})).get("result")
    return {"id": str(lead_id), "url": f"{_portal(_base(user_id))}/crm/lead/details/{lead_id}/"}


async def create_deal(user_id: int, title: str, opportunity: float | None = None, currency: str | None = None,
                      stage_id: str | None = None, contact_id: str | None = None, company_id: str | None = None,
                      comments: str | None = None) -> dict:
    fields: dict = {"TITLE": title}
    for k, v in (("OPPORTUNITY", opportunity), ("CURRENCY_ID", currency), ("STAGE_ID", stage_id),
                 ("CONTACT_ID", contact_id), ("COMPANY_ID", company_id), ("COMMENTS", comments)):
        if v not in (None, ""):
            fields[k] = v
    deal_id = (await _call(user_id, "crm.deal.add", {"fields": fields})).get("result")
    return {"id": str(deal_id), "url": f"{_portal(_base(user_id))}/crm/deal/details/{deal_id}/"}


async def update_deal(user_id: int, deal_id: str, fields: dict) -> dict:
    allowed = {"title": "TITLE", "stage_id": "STAGE_ID", "opportunity": "OPPORTUNITY", "currency": "CURRENCY_ID",
               "comments": "COMMENTS", "assigned_by_id": "ASSIGNED_BY_ID"}
    payload = {allowed[k]: v for k, v in (fields or {}).items() if k in allowed and v not in (None, "")}
    if not payload:
        raise ConnectorError(400, f"Nothing to update; allowed fields: {', '.join(allowed)}")
    await _call(user_id, "crm.deal.update", {"id": deal_id, "fields": payload})
    return {"id": str(deal_id), "updated": list(payload)}


async def list_tasks(user_id: int, q: str | None = None, only_mine: bool = True) -> list[dict]:
    flt: dict = {"!STATUS": 5}  # 5 = completed
    if q:
        flt["%TITLE"] = q
    if only_mine:
        acc = account_summary(user_id) or {}
        if acc.get("user_id"):
            flt["RESPONSIBLE_ID"] = acc["user_id"]
    data = await _call(user_id, "tasks.task.list", {
        "filter": flt, "order": {"DEADLINE": "ASC"},
        "select": ["ID", "TITLE", "STATUS", "DEADLINE", "RESPONSIBLE_ID", "CREATED_DATE"],
    })
    tasks = (data.get("result") or {}).get("tasks") or []
    return [{"id": str(t.get("id")), "title": t.get("title"), "status": t.get("status"),
             "deadline": t.get("deadline"), "responsible_id": t.get("responsibleId")} for t in tasks]


async def create_task(user_id: int, title: str, description: str | None = None, deadline: str | None = None,
                      responsible_id: str | None = None) -> dict:
    acc = account_summary(user_id) or {}
    fields: dict = {"TITLE": title, "RESPONSIBLE_ID": responsible_id or acc.get("user_id") or 1}
    if description:
        fields["DESCRIPTION"] = description
    if deadline:
        fields["DEADLINE"] = deadline
    data = await _call(user_id, "tasks.task.add", {"fields": fields})
    task = (data.get("result") or {}).get("task") or {}
    return {"id": str(task.get("id")), "title": task.get("title")}
