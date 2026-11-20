"""One model step: stream text deltas, collect tool calls.

`AI_FAKE=1` (or no OPENAI_API_KEY) swaps the model for a canned script so the
whole pipeline (events, tools, approvals) can be exercised without a key:
  - "/hitl ..."  → a gated telegram_send_message call, then a closing line
  - "/tool ..."  → telegram_get_me, then a closing line
  - anything else → a streamed canned reply
"""

import asyncio
import json
import logging
import uuid
from typing import Awaitable, Callable

from app.config import settings

log = logging.getLogger("ai.llm")

OnDelta = Callable[[str], Awaitable[None]]

_client = None


def fake_mode() -> bool:
    return bool(settings.AI_FAKE) or not settings.OPENAI_API_KEY


def model_name() -> str:
    return "fake" if fake_mode() else settings.AI_MODEL


def _openai():
    global _client
    if _client is None:
        from openai import AsyncOpenAI

        import httpx

        # The SDK default is 600 s per attempt with 2 retries: an overloaded provider then
        # leaves a run silent for many minutes. Fail in 2 minutes instead → ai.run.error.
        kwargs = {
            "api_key": settings.OPENAI_API_KEY,
            "timeout": httpx.Timeout(120.0, connect=15.0),
            "max_retries": 1,
        }
        if settings.OPENAI_BASE_URL:
            kwargs["base_url"] = settings.OPENAI_BASE_URL
        _client = AsyncOpenAI(**kwargs)
    return _client


async def step(messages: list[dict], tools: list[dict], on_delta: OnDelta) -> tuple[str, list[dict]]:
    """Returns (text, tool_calls) where tool_calls = [{id, name, arguments: str}]."""
    if fake_mode():
        return await _fake_step(messages, on_delta)

    kwargs = {"model": settings.AI_MODEL, "messages": messages, "stream": True}
    if tools:
        kwargs["tools"] = tools
        kwargs["tool_choice"] = "auto"
    stream = await _openai().chat.completions.create(**kwargs)

    text = ""
    calls: dict[int, dict] = {}
    async for chunk in stream:
        if not chunk.choices:
            continue
        delta = chunk.choices[0].delta
        if delta is None:
            continue
        if delta.content:
            text += delta.content
            await on_delta(delta.content)
        for tc in delta.tool_calls or []:
            slot = calls.setdefault(tc.index, {"id": None, "name": "", "arguments": ""})
            if tc.id:
                slot["id"] = tc.id
            if tc.function:
                if tc.function.name:
                    slot["name"] += tc.function.name
                if tc.function.arguments:
                    slot["arguments"] += tc.function.arguments
            # Gemini 3 attaches `extra_content.google.thought_signature` to each call and
            # rejects the next turn (400) unless it is sent back with that call.
            extra = (getattr(tc, "model_extra", None) or {}).get("extra_content")
            if extra:
                slot["extra_content"] = extra
    out = []
    for i in sorted(calls):
        c = calls[i]
        if not c["name"]:
            continue
        call = {"id": c["id"] or f"call_{i}", "name": c["name"], "arguments": c["arguments"] or "{}"}
        if c.get("extra_content"):
            call["extra_content"] = c["extra_content"]
        out.append(call)
    return text, out


async def complete_text(messages: list[dict], max_tokens: int = 30) -> str:
    """Non-streaming one-shot (used for titles)."""
    if fake_mode():
        return ""
    r = await _openai().chat.completions.create(model=settings.AI_MODEL, messages=messages, max_tokens=max_tokens)
    return (r.choices[0].message.content or "").strip()


# ---------------------------------------------------------------- fake model

_CANNED = (
    "This is **fake mode** (no `OPENAI_API_KEY`, or `AI_FAKE=1`). The pipeline works: "
    "this text was streamed as `ai.token` events over Centrifugo.\n\n"
    "- Send `/tool` to see a tool call (`telegram_get_me`).\n"
    "- Send `/hitl` to see an approval card (`telegram_send_message`).\n\n"
    "You wrote: "
)


def _last_user_text(messages: list[dict]) -> str:
    for m in reversed(messages):
        if m.get("role") == "user":
            c = m.get("content")
            if isinstance(c, list):
                return " ".join(p.get("text", "") for p in c if isinstance(p, dict) and p.get("type") == "text")
            return c or ""
    return ""


async def _stream_text(text: str, on_delta: OnDelta) -> None:
    for i in range(0, len(text), 6):
        await on_delta(text[i : i + 6])
        await asyncio.sleep(0.03)


async def _fake_step(messages: list[dict], on_delta: OnDelta) -> tuple[str, list[dict]]:
    prompt = _last_user_text(messages).strip()
    after_tool = bool(messages) and messages[-1].get("role") == "tool"
    if after_tool:
        result = str(messages[-1].get("content") or "")[:300]
        text = f"Tool finished. Result:\n\n```\n{result}\n```"
        await _stream_text(text, on_delta)
        return text, []
    if prompt.startswith("/hitl"):
        intro = "I will send a Telegram message to your Saved Messages — please approve it.\n\n"
        await _stream_text(intro, on_delta)
        args = {"chat": "me", "text": prompt[5:].strip() or "Hello from forBusiness (fake mode)"}
        return intro, [{"id": f"call_fake_{uuid.uuid4().hex[:8]}", "name": "telegram_send_message", "arguments": json.dumps(args)}]
    if prompt.startswith("/tool"):
        intro = "Let me check your Telegram account.\n\n"
        await _stream_text(intro, on_delta)
        return intro, [{"id": f"call_fake_{uuid.uuid4().hex[:8]}", "name": "telegram_get_me", "arguments": "{}"}]
    text = _CANNED + prompt
    await _stream_text(text, on_delta)
    return text, []
