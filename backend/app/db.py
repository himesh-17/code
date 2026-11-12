"""Database access — SQLite locally, Postgres (Supabase) in production.

Set DATABASE_URL (postgres://…) to use Postgres; otherwise the SQLite file
from settings.database_path is used. The same SQL works on both: the
Postgres adapter rewrites `?` placeholders and returns dict rows.
"""
import json
import sqlite3
import logging
from .settings import settings

log = logging.getLogger("brandguard.db")

# True when Postgres pgvector column + HNSW index are live (Living KB v2).
# The JSON `embedding` column is always the portable source of truth;
# `embedding_vec` is a derived index kept in sync by sync_vector().
vector_enabled = False


def is_postgres() -> bool:
    return settings.database_url.strip().lower().startswith(
        ("postgres://", "postgresql://"))


def _ph(sql: str) -> str:
    """SQLite-style ? placeholders -> psycopg %s."""
    return sql.replace("?", "%s")


def pg_schema() -> str:
    """SQLite DDL translated to Postgres."""
    return (SCHEMA
            .replace("INTEGER PRIMARY KEY AUTOINCREMENT", "SERIAL PRIMARY KEY")
            .replace("datetime('now')",
                     "to_char(now(), 'YYYY-MM-DD HH24:MI:SS')"))


class _PGCursor:
    def __init__(self, cur):
        self._cur = cur

    def fetchone(self):
        return self._cur.fetchone()

    def fetchall(self):
        return self._cur.fetchall()


_pool = None


def _pg_url() -> str:
    url = settings.database_url.strip()
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    return url


def _get_pool():
    """One warm connection pool per process — TLS handshakes are expensive."""
    global _pool
    if _pool is None:
        from psycopg_pool import ConnectionPool
        from psycopg.rows import dict_row
        _pool = ConnectionPool(
            _pg_url(), min_size=1, max_size=5,
            kwargs={"row_factory": dict_row}, open=True)
    return _pool


class _PGConnection:
    """Minimal DB-API facade so the SQLite-era call sites stay unchanged."""

    def __init__(self):
        self._ctx = _get_pool().connection()
        self._conn = self._ctx.__enter__()

    def execute(self, sql: str, args: tuple = ()):
        cur = self._conn.cursor()
        cur.execute(_ph(sql), tuple(args) if args else None)
        return _PGCursor(cur)

    def executemany(self, sql: str, seq):
        cur = self._conn.cursor()
        cur.executemany(_ph(sql), seq)
        return _PGCursor(cur)

    def executescript(self, script: str):
        for stmt in script.split(";"):
            if stmt.strip():
                self._conn.cursor().execute(stmt)

    def commit(self):
        self._conn.commit()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        self._ctx.__exit__(exc_type, exc, tb)


SCHEMA = """
CREATE TABLE IF NOT EXISTS content (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    type        TEXT NOT NULL,                -- text | image | email | social
    title       TEXT NOT NULL DEFAULT '',
    text        TEXT NOT NULL DEFAULT '',
    image_path  TEXT,
    channel     TEXT NOT NULL DEFAULT 'web',
    status      TEXT NOT NULL DEFAULT 'draft', -- draft|review|peer_review|changes|approved|published
    created_by  TEXT NOT NULL DEFAULT 'creator',
    team        TEXT NOT NULL DEFAULT 'marketing',
    sla_due_at  TEXT,                          -- review deadline (SLA timer)
    published_at TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS finding (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    content_id  INTEGER NOT NULL REFERENCES content(id),
    category    TEXT NOT NULL,                -- tone|term|claim|a11y|visual
    severity    TEXT NOT NULL,                -- critical|warning|suggestion
    rule        TEXT NOT NULL,
    excerpt     TEXT NOT NULL DEFAULT '',
    suggestion  TEXT NOT NULL DEFAULT '',
    accepted    INTEGER NOT NULL DEFAULT 0,   -- 0=pending 1=accepted 2=dismissed
    confidence  REAL NOT NULL DEFAULT 0.6,
    evidence    TEXT NOT NULL DEFAULT '',     -- source attribution
    superseded  INTEGER NOT NULL DEFAULT 0,   -- 1=replaced by a newer review
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS guideline (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    body  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS glossary (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    term TEXT NOT NULL,
    kind TEXT NOT NULL,                       -- approved|prohibited|preferred
    note TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS fact (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    claim      TEXT NOT NULL,
    source     TEXT NOT NULL DEFAULT '',
    verified_at TEXT                                   -- fact freshness
);

CREATE TABLE IF NOT EXISTS brand_color (
    id   INTEGER PRIMARY KEY AUTOINCREMENT,
    hex  TEXT NOT NULL,
    name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    content_id INTEGER REFERENCES content(id),
    actor      TEXT NOT NULL,
    action     TEXT NOT NULL,
    detail     TEXT NOT NULL DEFAULT '',
    tokens     INTEGER NOT NULL DEFAULT 0,
    prev_hash  TEXT NOT NULL DEFAULT '',
    hash       TEXT NOT NULL DEFAULT '',
    at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS comment (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    content_id INTEGER NOT NULL REFERENCES content(id),
    parent_id  INTEGER REFERENCES comment(id),
    author     TEXT NOT NULL,
    body       TEXT NOT NULL,
    resolved   INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS content_version (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    content_id INTEGER NOT NULL REFERENCES content(id),
    version    INTEGER NOT NULL,
    title      TEXT NOT NULL DEFAULT '',
    text       TEXT NOT NULL DEFAULT '',
    status     TEXT NOT NULL DEFAULT '',
    author     TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'creator', -- creator|reviewer|manager|admin
    team          TEXT NOT NULL DEFAULT 'marketing',
    active        INTEGER NOT NULL DEFAULT 1,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS refresh_token (
    jti        TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id),
    expires_at TEXT NOT NULL,
    revoked    INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS kb_chunk (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    source      TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    text        TEXT NOT NULL,
    embedding   TEXT NOT NULL,          -- JSON vector (portable truth)
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_finding_content ON finding(content_id);
CREATE INDEX IF NOT EXISTS idx_finding_content_sup ON finding(content_id, superseded);
CREATE INDEX IF NOT EXISTS idx_content_status  ON content(status);
CREATE INDEX IF NOT EXISTS idx_content_created ON content(created_at);
CREATE INDEX IF NOT EXISTS idx_finding_created ON finding(created_at, superseded);
CREATE INDEX IF NOT EXISTS idx_user_email      ON users(email);
CREATE INDEX IF NOT EXISTS idx_version_content ON content_version(content_id);
CREATE INDEX IF NOT EXISTS idx_comment_content ON comment(content_id);
CREATE INDEX IF NOT EXISTS idx_refresh_user    ON refresh_token(user_id);
CREATE INDEX IF NOT EXISTS idx_kb_chunk_source ON kb_chunk(source);
CREATE INDEX IF NOT EXISTS idx_audit_action    ON audit(action);
CREATE INDEX IF NOT EXISTS idx_audit_content   ON audit(content_id);
"""


def get():
    if is_postgres():
        return _PGConnection()
    from pathlib import Path
    Path(settings.database_path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(settings.database_path, timeout=10.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = NORMAL")
    conn.execute("PRAGMA busy_timeout = 5000")
    return conn


def _migrate(conn: sqlite3.Connection) -> None:
    """Add columns introduced after the file was first created (dev DBs)."""
    for table, col, ddl in (
        ("finding", "confidence", "ALTER TABLE finding ADD COLUMN "
                                  "confidence REAL NOT NULL DEFAULT 0.6"),
        ("finding", "evidence", "ALTER TABLE finding ADD COLUMN "
                                "evidence TEXT NOT NULL DEFAULT ''"),
        ("finding", "superseded", "ALTER TABLE finding ADD COLUMN "
                                  "superseded INTEGER NOT NULL DEFAULT 0"),
        ("audit", "tokens", "ALTER TABLE audit ADD COLUMN "
                            "tokens INTEGER NOT NULL DEFAULT 0"),
        ("audit", "prev_hash", "ALTER TABLE audit ADD COLUMN "
                               "prev_hash TEXT NOT NULL DEFAULT ''"),
        ("audit", "hash", "ALTER TABLE audit ADD COLUMN "
                          "hash TEXT NOT NULL DEFAULT ''"),
        ("content", "team", "ALTER TABLE content ADD COLUMN "
                            "team TEXT NOT NULL DEFAULT 'marketing'"),
        ("content", "sla_due_at", "ALTER TABLE content ADD COLUMN "
                                  "sla_due_at TEXT"),
        ("content", "published_at", "ALTER TABLE content ADD COLUMN "
                                    "published_at TEXT"),
        ("fact", "verified_at", "ALTER TABLE fact ADD COLUMN "
                                "verified_at TEXT"),
    ):
        cols = {r["name"] for r in conn.execute(f"PRAGMA table_info({table})")}
        if col not in cols:
            conn.execute(ddl)
    for idx_ddl in (
        "CREATE INDEX IF NOT EXISTS idx_finding_content ON finding(content_id)",
        "CREATE INDEX IF NOT EXISTS idx_finding_gate ON finding(content_id, superseded, severity, accepted)",
        "CREATE INDEX IF NOT EXISTS idx_content_status ON content(status)",
        "CREATE INDEX IF NOT EXISTS idx_content_created ON content(created_at)",
        "CREATE INDEX IF NOT EXISTS idx_finding_created ON finding(created_at, superseded)",
        "CREATE INDEX IF NOT EXISTS idx_user_email ON users(email)",
        "CREATE INDEX IF NOT EXISTS idx_version_content ON content_version(content_id)",
        "CREATE INDEX IF NOT EXISTS idx_comment_content ON comment(content_id)",
        "CREATE INDEX IF NOT EXISTS idx_refresh_user ON refresh_token(user_id)",
        "CREATE INDEX IF NOT EXISTS idx_kb_chunk_source ON kb_chunk(source)",
        "CREATE INDEX IF NOT EXISTS idx_audit_action ON audit(action)",
        "CREATE INDEX IF NOT EXISTS idx_audit_content ON audit(content_id)",
    ):
        conn.execute(idx_ddl)


def _rename_legacy_user(conn: sqlite3.Connection) -> None:
    """SQLite DBs created before the Postgres port used a `user` table;
    Postgres reserves that word, so the table is now `users`."""
    old = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='user'"
    ).fetchone()
    new = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='users'"
    ).fetchone()
    if old and not new:
        conn.execute("ALTER TABLE user RENAME TO users")


def init() -> None:
    global vector_enabled
    if is_postgres():
        try:
            with get() as conn:
                conn.executescript(pg_schema())
                try:
                    conn.execute(
                        "ALTER TABLE finding ADD COLUMN IF NOT EXISTS "
                        "superseded INTEGER NOT NULL DEFAULT 0")
                except Exception as e:
                    log.warning("finding.superseded migration skipped: %s", e)
                conn.execute("CREATE EXTENSION IF NOT EXISTS vector")
                conn.execute(
                    "ALTER TABLE kb_chunk ADD COLUMN IF NOT EXISTS "
                    f"embedding_vec vector({int(settings.embed_dim)})")
                # JSON is the truth; backfill rows ingested before the
                # derived column existed, then index it for ANN search.
                try:
                    conn.execute(
                        "UPDATE kb_chunk SET embedding_vec = embedding::vector"
                        " WHERE embedding_vec IS NULL")
                except Exception as e:
                    log.warning("pgvector backfill skipped: %s", e)
                conn.execute(
                    "CREATE INDEX IF NOT EXISTS kb_chunk_vec_idx "
                    "ON kb_chunk USING hnsw (embedding_vec vector_cosine_ops)")
                conn.commit()
                vector_enabled = True
                log.info("pgvector enabled (dim=%s)", settings.embed_dim)
        except Exception as e:  # no permission -> JSON-only mode
            vector_enabled = False
            log.warning("pgvector unavailable, cosine-in-Python: %s", e)
        return
    vector_enabled = False
    with get() as conn:
        _rename_legacy_user(conn)
        conn.executescript(SCHEMA)
        _migrate(conn)


def sync_vector(conn, chunk_id: int, vec: list[float]) -> bool:
    """Keep the derived pgvector column in sync with the JSON truth.

    No-op (returns False) on SQLite / when pgvector is unavailable —
    retrieval then falls back to cosine-in-Python over the JSON column.
    """
    if not (is_postgres() and vector_enabled):
        return False
    try:
        conn.execute(
            "UPDATE kb_chunk SET embedding_vec=%s::vector WHERE id=%s",
            (json.dumps(vec), chunk_id))
        return True
    except Exception as e:
        log.warning("embedding_vec sync failed for kb_chunk %s: %s",
                    chunk_id, e)
        return False


def rows(conn: sqlite3.Connection, sql: str, args: tuple = ()) -> list[dict]:
    return [dict(r) for r in conn.execute(sql, args).fetchall()]


def one(conn: sqlite3.Connection, sql: str, args: tuple = ()) -> dict | None:
    r = conn.execute(sql, args).fetchone()
    return dict(r) if r else None


# --- tamper-evident audit trail (hash chain) -------------------------------
def _chain_hash(prev: str, content_id, actor: str, action: str,
                detail: str, tokens: int, at: str) -> str:
    import hashlib
    payload = f"{prev}|{content_id}|{actor}|{action}|{detail}|{tokens}|{at}"
    return hashlib.sha256(payload.encode()).hexdigest()


def log_audit(conn: sqlite3.Connection, content_id, actor: str,
              action: str, detail: str = "", tokens: int = 0) -> None:
    """Append to the audit hash chain — every row commits to its
    predecessor, so any retroactive edit breaks verification."""
    prev = one(conn, "SELECT hash FROM audit ORDER BY id DESC LIMIT 1")
    prev_hash = (prev["hash"] or "genesis") if prev else "genesis"
    import datetime as _dt
    at = _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    h = _chain_hash(prev_hash, content_id, actor, action, detail, tokens, at)
    conn.execute(
        "INSERT INTO audit (content_id, actor, action, detail, tokens,"
        " prev_hash, hash, at) VALUES (?,?,?,?,?,?,?,?)",
        (content_id, actor, action, detail, tokens, prev_hash, h, at))


def verify_chain() -> dict:
    """Walk the chain; return {'ok': bool, 'checked': n, 'broken_at': id}."""
    with get() as conn:
        rows_ = rows(conn, "SELECT * FROM audit ORDER BY id")
    prev = "genesis"
    for r in rows_:
        expect = _chain_hash(prev, r["content_id"], r["actor"],
                             r["action"], r["detail"], r["tokens"], r["at"])
        if r["hash"] != expect:
            return {"ok": False, "checked": len(rows_),
                    "broken_at": r["id"]}
        prev = r["hash"]
    return {"ok": True, "checked": len(rows_), "broken_at": None}
