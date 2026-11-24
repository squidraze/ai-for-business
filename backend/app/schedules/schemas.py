"""Request bodies and the one validator shared by the API and the AI tools.

Bodies accept any JSON types; `validate()` checks the merged result and raises
`ScheduleInvalid` with `{field: code}`. The router turns it into the standard
422 body `{"detail": {"code": "validation_error", "message", "field", "fields"}}`.
"""

import re
from typing import Any

from pydantic import BaseModel, ConfigDict

from app.lib.errors import ApiError
from app.schedules.recurrence import DEFAULT_TIMEZONE, zone

TITLE_MAX = 100
PROMPT_MAX = 4000
INTERVAL_MIN = 60
INTERVAL_MAX = 10080  # one week
KINDS = ("daily", "weekly", "interval")
NOTIFY = ("approval", "always", "never")
FIELDS = ("title", "prompt", "kind", "time_of_day", "weekdays", "interval_minutes", "timezone", "enabled", "notify")
_TIME_RE = re.compile(r"^(\d{1,2}):(\d{2})$")

FIELD_MESSAGES = {
    "required": "This field is required",
    "invalid": "Invalid value",
    "title_too_long": f"Title must be at most {TITLE_MAX} characters",
    "prompt_too_long": f"Task text must be at most {PROMPT_MAX} characters",
    "invalid_kind": "Kind must be daily, weekly or interval",
    "invalid_time": "Time must be HH:MM between 00:00 and 23:59",
    "weekdays_required": "Pick at least one weekday",
    "invalid_weekdays": "Weekdays must be numbers 0 (Monday) to 6 (Sunday)",
    "interval_too_short": f"Interval must be at least {INTERVAL_MIN} minutes",
    "interval_too_long": f"Interval must be at most {INTERVAL_MAX} minutes",
    "invalid_timezone": "Unknown timezone",
    "invalid_notify": "Notify must be approval, always or never",
}


class ScheduleInvalid(Exception):
    def __init__(self, fields: dict[str, str]):
        super().__init__(fields)
        self.fields = fields

    def api_error(self) -> ApiError:
        first = next(iter(self.fields))
        return ApiError(
            422,
            "validation_error",
            FIELD_MESSAGES.get(self.fields[first], "Some fields are invalid"),
            field=first,
            fields=self.fields,
        )

    def text(self) -> str:
        return "; ".join(f"{k}: {FIELD_MESSAGES.get(v, v)} ({v})" for k, v in self.fields.items())


class ScheduleIn(BaseModel):
    """POST and PATCH body. PATCH applies only the keys present (`model_fields_set`)."""

    model_config = ConfigDict(extra="ignore")
    title: Any = None
    prompt: Any = None
    kind: Any = None
    time_of_day: Any = None
    weekdays: Any = None
    interval_minutes: Any = None
    timezone: Any = None
    enabled: Any = None
    notify: Any = None


def _text(v: Any, max_len: int, too_long: str, errors: dict, field: str) -> str | None:
    if v is None:
        errors[field] = "required"
        return None
    if not isinstance(v, str):
        errors[field] = "invalid"
        return None
    v = v.strip()
    if not v:
        errors[field] = "required"
    elif len(v) > max_len:
        errors[field] = too_long
    return v


def _int(v: Any) -> int | None:
    if isinstance(v, bool):
        return None
    if isinstance(v, int):
        return v
    if isinstance(v, float) and v.is_integer():
        return int(v)
    if isinstance(v, str) and v.strip().lstrip("-").isdigit():
        return int(v.strip())
    return None


def validate(data: dict) -> dict:
    """`data` holds all FIELDS (missing = None). Returns the normalized values."""
    errors: dict[str, str] = {}
    out: dict[str, Any] = {}
    out["title"] = _text(data.get("title"), TITLE_MAX, "title_too_long", errors, "title")
    out["prompt"] = _text(data.get("prompt"), PROMPT_MAX, "prompt_too_long", errors, "prompt")

    kind = data.get("kind")
    if kind is None or kind == "":
        errors["kind"] = "required"
    elif kind not in KINDS:
        errors["kind"] = "invalid_kind"
    out["kind"] = kind
    out["time_of_day"] = out["weekdays"] = out["interval_minutes"] = None

    if kind in ("daily", "weekly"):
        t = data.get("time_of_day")
        if t is None or t == "":
            errors["time_of_day"] = "required"
        else:
            m = _TIME_RE.match(t.strip()) if isinstance(t, str) else None
            if not m or int(m.group(1)) > 23 or int(m.group(2)) > 59:
                errors["time_of_day"] = "invalid_time"
            else:
                out["time_of_day"] = f"{int(m.group(1)):02d}:{m.group(2)}"
    if kind == "weekly":
        w = data.get("weekdays")
        if w is None or w == []:
            errors["weekdays"] = "weekdays_required"
        elif not isinstance(w, list):
            errors["weekdays"] = "invalid_weekdays"
        else:
            days = [_int(d) if not isinstance(d, str) else None for d in w]
            if any(d is None or d < 0 or d > 6 for d in days):
                errors["weekdays"] = "invalid_weekdays"
            else:
                out["weekdays"] = sorted(set(days))
    if kind == "interval":
        iv = data.get("interval_minutes")
        n = _int(iv)
        if iv is None or iv == "":
            errors["interval_minutes"] = "required"
        elif n is None:
            errors["interval_minutes"] = "invalid"
        elif n < INTERVAL_MIN:
            errors["interval_minutes"] = "interval_too_short"
        elif n > INTERVAL_MAX:
            errors["interval_minutes"] = "interval_too_long"
        else:
            out["interval_minutes"] = n

    tz = data.get("timezone")
    if tz is None or tz == "":
        tz = DEFAULT_TIMEZONE
    if not isinstance(tz, str):
        errors["timezone"] = "invalid_timezone"
    else:
        try:
            zone(tz.strip())
            tz = tz.strip()
        except ValueError:
            errors["timezone"] = "invalid_timezone"
    out["timezone"] = tz

    enabled = data.get("enabled")
    if enabled is None:
        enabled = True
    if not isinstance(enabled, bool):
        errors["enabled"] = "invalid"
    out["enabled"] = enabled

    notify = data.get("notify")
    if notify is None or notify == "":
        notify = "approval"
    if notify not in NOTIFY:
        errors["notify"] = "invalid_notify"
    out["notify"] = notify

    if errors:
        raise ScheduleInvalid(errors)
    return out
