from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.config import settings

engine = create_engine(
    f"sqlite:///{settings.data_path / 'app.db'}",
    connect_args={"check_same_thread": False},
)


@event.listens_for(engine, "connect")
def _sqlite_pragmas(dbapi_conn, _):
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA journal_mode=WAL")
    cur.execute("PRAGMA foreign_keys=ON")
    cur.close()


SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def create_all():
    # import every module that declares tables
    import app.auth  # noqa: F401
    import app.ai.models  # noqa: F401

    try:
        import app.connectors.models  # noqa: F401
    except ImportError:
        pass
    Base.metadata.create_all(engine)
    _migrate()


# ---------------------------------------------------------------- migrations
# No Alembic yet: small idempotent steps for dev databases created by older code.


def _columns(conn, table: str) -> set[str]:
    return {row[1] for row in conn.execute(text(f"PRAGMA table_info({table})"))}


def _migrate() -> None:
    with engine.begin() as conn:
        cols = _columns(conn, "users")
        if "email_verified" not in cols:
            conn.execute(text("ALTER TABLE users ADD COLUMN email_verified BOOLEAN NOT NULL DEFAULT 0"))
            # accounts created before email verification existed count as verified
            conn.execute(text("UPDATE users SET email_verified = 1"))
        if "google_sub" not in cols:
            conn.execute(text("ALTER TABLE users ADD COLUMN google_sub VARCHAR(255)"))
        if "apple_sub" not in cols:
            conn.execute(text("ALTER TABLE users ADD COLUMN apple_sub VARCHAR(255)"))
        if "updated_at" not in cols:
            conn.execute(text("ALTER TABLE users ADD COLUMN updated_at DATETIME"))
            conn.execute(text("UPDATE users SET updated_at = created_at"))
        # SQLite can't add a UNIQUE column; a unique index (same name create_all uses) does the job
        conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_users_google_sub ON users (google_sub)"))
        conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_users_apple_sub ON users (apple_sub)"))
