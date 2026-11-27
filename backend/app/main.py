import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import auth, notifications, realtime, schedules
from app.ai import router as ai_router
from app.ai import runner
from app.db import create_all
from app.integrations import INTEGRATIONS
from app.integrations.base import summary_router
from app.lib.errors import install_error_handlers
from app.lib.timeouts import install_request_timeout

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logging.getLogger("httpx").setLevel(logging.WARNING)
log = logging.getLogger("app")

app = FastAPI(title="forBusiness backend")
# added first = innermost: CORS (added next) also wraps the 504 this returns
install_request_timeout(app)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"], expose_headers=["*"])
install_error_handlers(app)

app.include_router(auth.router)
app.include_router(realtime.router)
app.include_router(ai_router.router)
app.include_router(ai_router.integrations_router)
app.include_router(schedules.router)
app.include_router(notifications.router)

# integrations: GET /api/v1/connectors plus each one's /api/v1/connectors/<name>/...
app.include_router(summary_router(INTEGRATIONS))
for integration in INTEGRATIONS:
    if integration.router is not None:
        app.include_router(integration.router)


@app.on_event("startup")
async def _startup():
    import asyncio

    runner.set_loop(asyncio.get_running_loop())
    create_all()
    runner.mark_stale_runs()
    schedules.start_scheduler()
    for integration in INTEGRATIONS:
        if integration.on_startup is not None:
            try:
                await integration.on_startup()
            except Exception as e:  # one integration must not keep the app from starting
                log.warning("%s startup: %s", integration.id, e)
    from app.ai import llm

    log.info("AI model: %s%s", llm.model_name(), " (fake mode)" if llm.fake_mode() else "")


@app.get("/health")
def health():
    return {"ok": True}


@app.on_event("shutdown")
async def _shutdown():
    await schedules.stop_scheduler()
    for integration in INTEGRATIONS:
        if integration.on_shutdown is not None:
            try:
                await integration.on_shutdown()
            except Exception as e:
                log.warning("%s shutdown: %s", integration.id, e)
