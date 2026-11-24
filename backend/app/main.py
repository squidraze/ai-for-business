import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import auth, realtime
from app.ai import router as ai_router
from app.ai import runner
from app.db import create_all
from app.lib.errors import install_error_handlers

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logging.getLogger("httpx").setLevel(logging.WARNING)
log = logging.getLogger("app")

app = FastAPI(title="forBusiness backend")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"], expose_headers=["*"])
install_error_handlers(app)

app.include_router(auth.router)
app.include_router(realtime.router)
app.include_router(ai_router.router)
app.include_router(ai_router.integrations_router)

try:
    from app.connectors.router import router as connectors_router

    app.include_router(connectors_router)
except ImportError as e:  # connectors not written yet
    log.warning("connectors router not loaded: %s", e)


@app.on_event("startup")
async def _startup():
    import asyncio

    runner.set_loop(asyncio.get_running_loop())
    create_all()
    runner.mark_stale_runs()
    from app.ai import llm

    log.info("AI model: %s%s", llm.model_name(), " (fake mode)" if llm.fake_mode() else "")


@app.get("/health")
def health():
    return {"ok": True}


@app.on_event("shutdown")
async def _shutdown():
    try:
        from app.connectors import telegram

        await telegram.shutdown()
    except Exception as e:
        log.warning("telegram shutdown: %s", e)
