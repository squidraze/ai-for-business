import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import auth
from app.db import create_all

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("app")

app = FastAPI(title="forBusiness backend")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"], expose_headers=["*"])

app.include_router(auth.router)

try:
    from app.connectors.router import router as connectors_router

    app.include_router(connectors_router)
except ImportError as e:  # connectors not written yet
    log.warning("connectors router not loaded: %s", e)


@app.on_event("startup")
def _startup():
    create_all()


@app.get("/health")
def health():
    return {"ok": True}
