"""Scheduled (recurring) AI tasks. Not an integration.

Importing the package registers its AI tools (app.ai.tools provider), its run
hook (app.ai.runner.on_run_finished) and its account-deletion cleanup.
Public API: `router`, `start_scheduler`, `stop_scheduler`.
"""

from app.schedules import tools as _tools  # noqa: F401  (registers the AI tools)
from app.schedules.router import router
from app.schedules.scheduler import start as start_scheduler
from app.schedules.scheduler import stop as stop_scheduler

__all__ = ["router", "start_scheduler", "stop_scheduler"]
