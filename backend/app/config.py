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
    # hard ceiling for one HTTP request (504 request_timeout after it); 0 = off
    REQUEST_TIMEOUT_SECONDS: int = 30
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

    # auth: email codes (sent only via Gmail SMTP; empty user/password = dev mode, code goes to the log)
    SMTP_HOST: str = "smtp.gmail.com"
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM_NAME: str = "forBusiness"
    EMAIL_CODE_TTL_MINUTES: int = 15
    EMAIL_CODE_RESEND_SECONDS: int = 60
    EMAIL_CODE_MAX_ATTEMPTS: int = 5

    # auth: Google / Apple sign-in
    GOOGLE_SIGNIN_CLIENT_IDS: str = ""  # comma-separated ID-token audiences; empty = GOOGLE_CLIENT_ID
    APPLE_BUNDLE_ID: str = "ai.forbusiness.demo"

    # schedules (recurring AI tasks)
    SCHEDULER_TICK_SECONDS: int = 30
    SCHEDULE_MAX_PER_USER: int = 20

    # push notifications: Firebase Cloud Messaging HTTP v1 (empty = dev mode, pushes go to the log)
    FCM_PROJECT_ID: str = ""
    FCM_SERVICE_ACCOUNT_FILE: str = ""  # path to the service-account JSON; relative = from backend/

    @field_validator("TELEGRAM_API_ID", mode="before")
    @classmethod
    def _empty_int(cls, v):
        # an empty `TELEGRAM_API_ID=` line in .env means "not set"
        return 0 if v in ("", None) else v

    @field_validator(
        "SMTP_PORT",
        "EMAIL_CODE_TTL_MINUTES",
        "EMAIL_CODE_RESEND_SECONDS",
        "EMAIL_CODE_MAX_ATTEMPTS",
        "SCHEDULER_TICK_SECONDS",
        "SCHEDULE_MAX_PER_USER",
        mode="before",
    )
    @classmethod
    def _empty_default(cls, v, info):
        # an empty line in .env means "use the default"
        return cls.model_fields[info.field_name].default if v in ("", None) else v

    @property
    def smtp_enabled(self) -> bool:
        return bool(self.SMTP_USER and self.SMTP_PASSWORD)

    @property
    def google_signin_audiences(self) -> list[str]:
        ids = [x.strip() for x in self.GOOGLE_SIGNIN_CLIENT_IDS.split(",") if x.strip()]
        if not ids and self.GOOGLE_CLIENT_ID:
            ids = [self.GOOGLE_CLIENT_ID.strip()]
        return ids

    @property
    def fcm_service_account_path(self) -> Path:
        p = Path(self.FCM_SERVICE_ACCOUNT_FILE)
        return p if p.is_absolute() else BACKEND_DIR / p

    @property
    def data_path(self) -> Path:
        p = Path(self.DATA_DIR)
        if not p.is_absolute():
            p = BACKEND_DIR / p
        p.mkdir(parents=True, exist_ok=True)
        return p


settings = Settings()
