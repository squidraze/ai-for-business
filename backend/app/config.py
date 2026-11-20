from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    # the repo-root .env is the one file to fill in; backend/.env (optional) overrides it
    model_config = SettingsConfigDict(
        env_file=(str(BACKEND_DIR.parent / ".env"), str(BACKEND_DIR / ".env")), extra="ignore"
    )

    # core
    JWT_SECRET: str = "dev-secret-change-me"
    JWT_TTL_DAYS: int = 30
    DATA_DIR: str = str(BACKEND_DIR / "data")
    BACKEND_PUBLIC_URL: str = "http://localhost:8000"

    # AI
    OPENAI_API_KEY: str = ""
    OPENAI_BASE_URL: str = ""
    AI_MODEL: str = "gpt-4.1-mini"
    AI_FAKE: bool = False

    # Centrifugo
    CENTRIFUGO_API_URL: str = "http://localhost:8001/api"
    CENTRIFUGO_API_KEY: str = "dev-centrifugo-api-key"
    CENTRIFUGO_TOKEN_HMAC_SECRET_KEY: str = "dev-centrifugo-hmac-secret"
    CENTRIFUGO_PUBLIC_URL: str = "ws://localhost:8001/connection/websocket"

    # connectors
    TELEGRAM_API_ID: int = 0
    TELEGRAM_API_HASH: str = ""
    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""

    @field_validator("TELEGRAM_API_ID", mode="before")
    @classmethod
    def _empty_int(cls, v):
        # an empty `TELEGRAM_API_ID=` line in .env means "not set"
        return 0 if v in ("", None) else v

    @property
    def data_path(self) -> Path:
        p = Path(self.DATA_DIR)
        if not p.is_absolute():
            p = BACKEND_DIR / p
        p.mkdir(parents=True, exist_ok=True)
        return p


settings = Settings()
