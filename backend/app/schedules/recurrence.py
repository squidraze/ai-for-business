"""When does a schedule fire next. Pure functions, no database.

All wall-clock math happens in the schedule's IANA timezone via zoneinfo, so
DST is handled: a local time that falls into a spring-forward gap resolves to
the instant just after the gap (zoneinfo fold=0 semantics), an ambiguous
fall-back time fires once (the first occurrence).
"""

from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

UTC = timezone.utc
DEFAULT_TIMEZONE = "Asia/Tashkent"
WEEKDAY_NAMES = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")


def as_utc(dt: datetime) -> datetime:
    """Aware UTC; a naive value (what SQLite returns) is taken as UTC."""
    return dt.replace(tzinfo=UTC) if dt.tzinfo is None else dt.astimezone(UTC)


def zone(name: str | None) -> ZoneInfo:
    """Raises ValueError for an unknown or malformed zone name."""
    if not name or not isinstance(name, str):
        raise ValueError("empty timezone")
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError, OSError) as e:
        raise ValueError(f"unknown timezone {name!r}") from e


def parse_hhmm(value: str) -> time:
    h, m = value.split(":")
    return time(int(h), int(m))


def _wall(d: date, t: time, tz: ZoneInfo) -> datetime:
    return datetime.combine(d, t, tzinfo=tz)


def next_run(schedule, after: datetime, anchor: datetime | None = None) -> datetime:
    """The first fire time strictly after `after`, as aware UTC.

    `schedule` is anything with kind, time_of_day, weekdays, interval_minutes, timezone.
    For `interval`, `anchor` (the previous planned fire time) keeps the cadence
    without drift: the result is anchor + k*interval; without it, after + interval.
    """
    after = as_utc(after)
    kind = schedule.kind
    if kind == "interval":
        step = timedelta(minutes=int(schedule.interval_minutes))
        if anchor is None:
            return after + step
        anchor = as_utc(anchor)
        if anchor > after:
            return anchor
        k = (after - anchor) // step + 1
        return anchor + k * step

    if kind not in ("daily", "weekly"):
        raise ValueError(f"unknown kind {kind!r}")
    tz = zone(schedule.timezone)
    at = parse_hhmm(schedule.time_of_day)
    allowed = set(schedule.weekdays or []) if kind == "weekly" else set(range(7))
    if not allowed:
        raise ValueError("weekly schedule without weekdays")
    start = after.astimezone(tz).date() - timedelta(days=1)  # a day back covers offset edge cases
    for i in range(10):
        d = start + timedelta(days=i)
        if d.weekday() not in allowed:
            continue
        candidate = _wall(d, at, tz).astimezone(UTC)
        if candidate > after:
            return candidate
    raise RuntimeError("no fire time found")  # unreachable: 10 days cover every weekday


def describe(schedule) -> str:
    """Human-readable recurrence in English (for the AI and logs)."""
    if schedule.kind == "interval":
        m = int(schedule.interval_minutes or 0)
        if m % 1440 == 0:
            span = f"{m // 1440} day(s)"
        elif m % 60 == 0:
            span = f"{m // 60} hour(s)"
        else:
            span = f"{m} minutes"
        return f"every {span}"
    if schedule.kind == "weekly":
        days = ", ".join(WEEKDAY_NAMES[d] for d in sorted(schedule.weekdays or []))
        return f"every {days} at {schedule.time_of_day} ({schedule.timezone})"
    return f"every day at {schedule.time_of_day} ({schedule.timezone})"


def local_str(dt: datetime | None, tz_name: str) -> str | None:
    if dt is None:
        return None
    try:
        tz = zone(tz_name)
    except ValueError:
        tz = UTC
    return as_utc(dt).astimezone(tz).strftime("%Y-%m-%d %H:%M (%a)")
