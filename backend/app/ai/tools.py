"""Generic AI tool machinery: the Tool type, gating, providers and execution.

This module knows no concrete integration. Integration tools are declared in
`app/integrations/<name>/tools.py` and reach the model through the registry
(`app.integrations.INTEGRATIONS`); other modules (e.g. app.schedules) add tools
through `register_tool_provider`. Every tool belongs to one connector id (the
same ids the Connectors switches and `disabled_connectors` use). Gated tools
change the outside world and pause the run for approval before they execute.
"""

import inspect
import json
import logging
from typing import Any, Awaitable, Callable

from app.lib.errors import ApiError

log = logging.getLogger("ai.tools")

MAX_RESULT_CHARS = 14000


def fn_schema(name: str, description: str, properties: dict, required: list[str]) -> dict:
    """An OpenAI function-tool schema."""
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "parameters": {"type": "object", "properties": properties, "required": required},
        },
    }


# ---------------------------------------------------------------- tool type


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


# ---------------------------------------------------------------- integrations
# Imported lazily: integration packages import this module for `Tool`.


def integrations() -> list:
    from app.integrations import INTEGRATIONS

    return INTEGRATIONS


def connector_titles() -> dict[str, str]:
    """{connector_id: title} of every integration, in registry order."""
    return {i.id: i.title for i in integrations()}


def all_tools() -> list[Tool]:
    """Every integration tool, in registry order (whatever the user's connection state)."""
    return [t for i in integrations() for t in i.tools]


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
    """An integration tool by name, or one a provider offers this user."""
    for t in all_tools():
        if t.name == name:
            return t
    for t in await provided_tools(user_id):
        if t.name == name:
            return t
    return None


async def connector_status(user_id: int) -> dict[str, bool]:
    """{connector_id: connected} — an integration that fails to answer counts as not connected."""
    out: dict[str, bool] = {}
    for integration in integrations():
        try:
            out[integration.id] = await integration.status(user_id)
        except Exception as e:  # a broken session, an unreachable provider
            log.warning("is_connected(%s) failed: %s", integration.id, e)
            out[integration.id] = False
    return out


async def available_tools(user_id: int, disabled: list[str] | None) -> tuple[list[Tool], dict[str, bool]]:
    status = await connector_status(user_id)
    off = set(disabled or [])
    tools = [t for t in all_tools() if status.get(t.connector) and t.connector not in off]
    tools += [t for t in await provided_tools(user_id) if t.connector not in off]
    return tools, status


EMPTY_RESULT = "No results found (the list is empty)."


def _is_empty(result: Any) -> bool:
    """An empty list, or a page `{"items": [], ...}`: tell the model "nothing found" in words."""
    return result == [] or (isinstance(result, dict) and "items" in result and result["items"] == [])


def _to_text(result: Any) -> str:
    if _is_empty(result):
        return EMPTY_RESULT
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
        if getattr(e, "not_connected", False):  # app.integrations.errors.NotConnected
            title = connector_titles().get(tool.connector, tool.connector)
            return f"Error: {title} is not connected. Ask the user to connect it on the Connectors screen of the app. ({e})"
        if isinstance(e, KeyError):
            return f"Error: missing required argument {e}."
        log.exception("tool %s failed", name)
        detail = (e.message if isinstance(e, ApiError) else getattr(e, "detail", None)) or str(e) or cls
        return f"Error: {name} failed: {detail}"
