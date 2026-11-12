"""BrandGuard AI — FastAPI app. One file, auto /docs for the frontend."""
import contextvars
import io
import re
import time
import uuid
from contextlib import asynccontextmanager
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Literal

from fastapi import (FastAPI, HTTPException, UploadFile, File, Form, Request,
                     Body, Depends)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import db
from .settings import settings
from .engine.citation import guideline_gaps
from .models import (ContentCreate, ContentOut, ContentWithFindings, Finding,
                      FindingPatch, ReviewResult, AnalyticsSummary,
                      CategoryCount, TeamScore, TrendPoint, TrendResponse)
from . import seed, auth, review_service
from .auth import current_user, require_role
from .state import LOCKED, require_transition
from .kb import router as kb_router
from .workflow import router as workflow_router

request_id_ctx: contextvars.ContextVar[str] = contextvars.ContextVar("request_id", default="")


@asynccontextmanager
async def lifespan(_: FastAPI):
    db.init()
    seed.seed()
    seed.ensure_users()
    Path(settings.upload_dir).mkdir(parents=True, exist_ok=True)
    yield


app = FastAPI(title="BrandGuard AI", version="0.1.0",
              description="Brand-compliance review engine. AI-generated "
                          "findings are advisory — a human always makes the "
                          "final approval decision.",
              lifespan=lifespan)

app.include_router(kb_router)
app.include_router(workflow_router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
# Compress JSON responses (analytics/content lists shrink 70-90%).
app.add_middleware(GZipMiddleware, minimum_size=1000)


@app.middleware("http")
async def correlation_id_middleware(request: Request, call_next):
    req_id = request.headers.get("X-Request-ID") or uuid.uuid4().hex
    token = request_id_ctx.set(req_id)
    try:
        resp = await call_next(request)
        resp.headers["X-Request-ID"] = req_id
        return resp
    finally:
        request_id_ctx.reset(token)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    resp = await call_next(request)
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("X-Frame-Options", "DENY")
    resp.headers.setdefault("Referrer-Policy", "no-referrer")
    # no-store: findings carry sensitive brand copy — never cache
    resp.headers.setdefault("Cache-Control", "no-store")
    resp.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    resp.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
    return resp


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception):
    """Never leak stack traces or DB errors to the client."""
    import logging
    req_id = request_id_ctx.get() or "unknown"
    logging.getLogger("brandguard").exception(
        "unhandled error [%s] on %s %s", req_id, request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error. "
                           "The incident was logged with request context.",
                 "request_id": req_id})

# --- rate limiting: in-memory sliding window per IP on /review and auth -------------
_hits: dict[str, deque] = defaultdict(deque)
_last_clean: float = time.time()


def _check_rate_limit(key: str, limit: int, window_sec: int = 60, scope: str = "Request") -> None:
    global _last_clean
    now = time.time()
    # periodic cleanup of stale empty entries every 5 minutes to prevent memory leak
    if now - _last_clean > 300:
        stale_keys = [k for k, q in _hits.items() if not q or now - q[-1] > window_sec]
        for k in stale_keys:
            del _hits[k]
        _last_clean = now

    q = _hits[key]
    while q and now - q[0] > window_sec:
        q.popleft()
    if len(q) >= limit:
        raise HTTPException(
            429, f"{scope} rate limit exceeded "
                 f"({limit}/min per IP). "
                 "Try again shortly.")
    q.append(now)


def rate_limit(request: Request) -> None:
    ip = request.client.host if request.client else "unknown"
    _check_rate_limit(f"review:{ip}", settings.review_rate_per_min, 60, "Review")


def auth_rate_limit(request: Request) -> None:
    ip = request.client.host if request.client else "unknown"
    _check_rate_limit(f"auth:{ip}", settings.auth_rate_per_min, 60, "Authentication")


@app.get("/health")
def health() -> dict:
    from .engine import llm
    # transparency disclosure: identify the AI system and active model
    return {"status": "ok",
            "product": "BrandGuard AI",
            "ai_disclosure": "Findings are AI-generated and advisory — "
                             "final approval is always human.",
            "provider": llm.active_name(),
            "model": llm.active_model(),
            "llm_available": llm.available()}


# ---------- auth (full JWT) ----------
class LoginBody(BaseModel):
    email: str = Field(..., max_length=254)
    password: str = Field(..., max_length=128)


class UserCreate(BaseModel):
    email: str = Field(..., max_length=254)
    password: str = Field(min_length=8, max_length=128)
    role: Literal["creator", "reviewer", "manager", "admin"] = "creator"
    team: str = Field(default="marketing", max_length=100)


@app.post("/auth/login")
def login(body: LoginBody, request: Request):
    auth_rate_limit(request)
    with db.get() as conn:
        user = db.one(conn, "SELECT * FROM users WHERE email=? AND active=1",
                      (body.email.lower().strip(),))
    if not user or not auth.verify_password(body.password,
                                            user["password_hash"]):
        raise HTTPException(401, "Invalid credentials")  # same msg both cases
    access = auth.create_access(user)
    refresh, _ = auth.create_refresh(user)
    return {"access_token": access, "refresh_token": refresh,
            "token_type": "bearer",
            "user": {"id": user["id"], "email": user["email"],
                     "role": user["role"], "team": user["team"]}}


@app.post("/auth/refresh")
def refresh(request: Request, body: dict = Body(...)):
    auth_rate_limit(request)
    token = body.get("refresh_token", "")
    if not token:
        raise HTTPException(400, "refresh_token required")
    claims = auth.decode_refresh(token)
    auth.revoke(claims["jti"])                      # rotation: old dies
    with db.get() as conn:
        user = db.one(conn, "SELECT * FROM users WHERE id=? AND active=1",
                      (claims["sub"],))
    if not user:
        raise HTTPException(401, "User gone")
    access = auth.create_access(user)
    new_refresh, _ = auth.create_refresh(user)
    return {"access_token": access, "refresh_token": new_refresh,
            "token_type": "bearer"}


@app.post("/auth/logout")
def logout(request: Request):
    header = request.headers.get("Authorization", "")
    if header.lower().startswith("bearer "):
        try:
            claims = auth._decode(header[7:].strip(), "refresh")
            auth.revoke(claims["jti"])
        except HTTPException:
            pass                                   # access token: client drops it
    return {"logged_out": True}


@app.get("/auth/me")
def me(user: dict = Depends(current_user)):
    return user


@app.post("/auth/users", status_code=201)
def create_user(body: UserCreate, _: dict = Depends(
        require_role("admin"))):
    with db.get() as conn:
        if db.one(conn, "SELECT id FROM users WHERE email=?",
                  (body.email.lower().strip(),)):
            raise HTTPException(409, "email already registered")
        cur = conn.execute(
            "INSERT INTO users (email, password_hash, role, team) "
            "VALUES (?,?,?,?) RETURNING id",
            (body.email.lower().strip(), auth.hash_password(body.password),
             body.role, body.team))
        new_id = cur.fetchone()["id"]
        conn.commit()
        row = db.one(conn, "SELECT id, email, role, team FROM users "
                           "WHERE id=?", (new_id,))
    return row


@app.get("/auth/users")
def list_users(user: dict = Depends(require_role("admin"))):
    with db.get() as conn:
        return db.rows(conn, "SELECT id, email, role, team FROM users")


class UserPatch(BaseModel):
    role: Literal["creator", "reviewer", "manager", "admin"]


@app.patch("/auth/users/{uid}")
def update_user(uid: int, body: UserPatch, admin: dict = Depends(
        require_role("admin"))):
    with db.get() as conn:
        row = db.one(conn, "SELECT * FROM users WHERE id=?", (uid,))
        if not row:
            raise HTTPException(404, "user not found")
        if uid == admin["id"] and body.role != "admin":
            raise HTTPException(409, "cannot change your own admin role")
        conn.execute("UPDATE users SET role=? WHERE id=?", (body.role, uid))
        conn.commit()
        return db.one(conn, "SELECT id, email, role, team FROM users WHERE id=?",
                      (uid,))


@app.delete("/auth/users/{uid}", status_code=204)
def delete_user(uid: int, admin: dict = Depends(require_role("admin"))):
    if uid == admin["id"]:
        raise HTTPException(409, "cannot delete your own account")
    with db.get() as conn:
        row = db.one(conn, "SELECT id FROM users WHERE id=?", (uid,))
        if not row:
            raise HTTPException(404, "user not found")
        conn.execute("DELETE FROM users WHERE id=?", (uid,))
        conn.commit()


# ---------- content ----------
@app.post("/content", response_model=ContentOut, status_code=201)
def create_content(body: ContentCreate,
                   user: dict = Depends(current_user)):
    with db.get() as conn:
        cur = conn.execute(
            "INSERT INTO content (type, title, text, channel, created_by,"
            " team) VALUES (?,?,?,?,?,?) RETURNING id",
            (body.type, body.title, body.text, body.channel,
             user["email"], user.get("team") or "marketing"))
        new_id = cur.fetchone()["id"]
        conn.commit()
        row = db.one(conn, "SELECT * FROM content WHERE id=?",
                     (new_id,))
    return row


@app.get("/content", response_model=list[ContentOut])
def list_content(status: str | None = None,
                 user: dict = Depends(current_user)):
    with db.get() as conn:
        if status:
            return db.rows(conn, "SELECT * FROM content WHERE status=? "
                           "ORDER BY id DESC", (status,))
        return db.rows(conn, "SELECT * FROM content ORDER BY id DESC")


@app.get("/content/{cid}", response_model=ContentWithFindings)
def get_content(cid: int, user: dict = Depends(current_user)):
    with db.get() as conn:
        row = db.one(conn, "SELECT * FROM content WHERE id=?", (cid,))
        if not row:
            raise HTTPException(404, "content not found")
        row["findings"] = db.rows(
            conn, "SELECT * FROM finding WHERE content_id=? AND superseded=0"
                  " ORDER BY id", (cid,))
    return row


# ---------- review (the core endpoint) ----------
@app.post("/content/{cid}/review", response_model=ReviewResult)
def run_review(cid: int, request: Request, force_mock: bool = False,
               user: dict = Depends(current_user)):
    rate_limit(request)                      # protect LLM spend
    with db.get() as conn:
        row = db.one(conn, "SELECT * FROM content WHERE id=?", (cid,))
        if not row:
            raise HTTPException(404, "content not found")
        if row["status"] in LOCKED:
            raise HTTPException(
                409, f"cannot review locked content (status '{row['status']}')")
        return review_service.run_review_on(conn, row, user, force_mock)


@app.patch("/findings/{fid}", response_model=Finding)
def patch_finding(fid: int, body: FindingPatch,
                  user: dict = Depends(require_role("reviewer"))):
    with db.get() as conn:
        row = db.one(conn, "SELECT * FROM finding WHERE id=?", (fid,))
        if not row:
            raise HTTPException(404, "finding not found")
        conn.execute("UPDATE finding SET accepted=? WHERE id=?",
                     (body.accepted, fid))
        db.log_audit(conn, row["content_id"], user["email"],
                     "finding_update", f"finding {fid} -> {body.accepted}")
        conn.commit()
        return db.one(conn, "SELECT * FROM finding WHERE id=?", (fid,))


# ---------- workflow ----------
@app.post("/content/{cid}/approve", response_model=ContentOut)
def approve(cid: int, user: dict = Depends(require_role("manager"))):
    actor = user["email"]
    with db.get() as conn:
        row = db.one(conn, "SELECT * FROM content WHERE id=?", (cid,))
        if not row:
            raise HTTPException(404, "content not found")
        require_transition(row["status"], "approved", user["role"])
        crit = db.one(conn, "SELECT COUNT(*) n FROM finding WHERE content_id=?"
                      " AND severity='critical' AND accepted=0"
                      " AND superseded=0",
                      (cid,))["n"]
        if crit:
            raise HTTPException(
                409, f"{crit} unresolved critical finding(s) — accept or "
                     "dismiss them before approving")
        conn.execute("UPDATE content SET status='approved' WHERE id=?",
                     (cid,))
        from .workflow import _snapshot
        _snapshot(conn, cid, actor)
        db.log_audit(conn, cid, actor, "approve", "approved")
        conn.commit()
        return db.one(conn, "SELECT * FROM content WHERE id=?", (cid,))


@app.post("/content/{cid}/request-changes", response_model=ContentOut)
def request_changes(cid: int,
                    user: dict = Depends(require_role("manager"))):
    actor = user["email"]
    with db.get() as conn:
        row = db.one(conn, "SELECT * FROM content WHERE id=?", (cid,))
        if not row:
            raise HTTPException(404, "content not found")
        require_transition(row["status"], "changes", user["role"])
        conn.execute("UPDATE content SET status='changes' WHERE id=?",
                     (cid,))
        from .workflow import _snapshot
        _snapshot(conn, cid, actor)
        db.log_audit(conn, cid, actor, "request_changes", "")
        conn.commit()
        return db.one(conn, "SELECT * FROM content WHERE id=?", (cid,))


@app.get("/audit")
def audit_log(limit: int = 100,
              user: dict = Depends(require_role("manager"))):
    with db.get() as conn:
        return db.rows(conn, "SELECT * FROM audit ORDER BY id DESC LIMIT ?",
                       (limit,))


# ---------- analytics ----------
@app.get("/analytics/summary", response_model=AnalyticsSummary)
def analytics(user: dict = Depends(require_role("manager"))):
    with db.get() as conn:
        # one round-trip for the content counters
        c = db.one(conn, "SELECT COUNT(*) total,"
                         " SUM(CASE WHEN status='approved' THEN 1 ELSE 0 END) approved,"
                         " SUM(CASE WHEN status IN ('draft','review') THEN 1 ELSE 0 END) pending"
                         " FROM content")
        total = c["total"] or 0
        approved = c["approved"] or 0
        pending = c["pending"] or 0

        # one round-trip for the finding matrix — derives n_find, by_cat,
        # by_sev and the heat map without four separate GROUP BY queries.
        cat_sev: dict[str, dict[str, int]] = {}
        sev_n = {s: 0 for s in ("critical", "warning", "suggestion")}
        heat = {}
        for r in db.rows(conn, "SELECT category, severity, COUNT(*) n "
                               "FROM finding WHERE superseded=0 "
                               "GROUP BY category, severity"):
            cat_sev.setdefault(r["category"], {})[r["severity"]] = r["n"]
            sev_n[r["severity"]] = sev_n.get(r["severity"], 0) + r["n"]
            heat[(r["category"], r["severity"])] = r["n"]
        n_find = sum(sev_n.values())
        by_sev = sev_n
        by_cat = [
            {"category": cat, "count": sum(v.values()),
             "critical": v.get("critical", 0),
             "warning": v.get("warning", 0),
             "suggestion": v.get("suggestion", 0)}
            for cat, v in sorted(cat_sev.items(),
                                 key=lambda kv: sum(kv[1].values()),
                                 reverse=True)]

        rules = db.rows(conn, """
            SELECT rule, COUNT(*) count FROM finding
            WHERE superseded=0
            GROUP BY rule ORDER BY count DESC LIMIT 10""")
        cost = db.one(conn, "SELECT COUNT(*) calls, "
                            "COALESCE(SUM(tokens),0) tok FROM audit "
                            "WHERE action='review'") or {}

        # --- per-team compliance: one join instead of two round-trips ---
        by_team = []
        for r in db.rows(conn, """
                SELECT c.team,
                       COUNT(DISTINCT c.id) total,
                       COUNT(DISTINCT CASE WHEN c.status='approved'
                                           THEN c.id END) approved,
                       COUNT(DISTINCT CASE WHEN c.status IN
                             ('draft','review','peer_review')
                                           THEN c.id END) pending,
                       COUNT(f.id) findings,
                       COALESCE(SUM(CASE WHEN f.severity='critical'
                                         THEN 1 ELSE 0 END),0) criticals
                FROM content c LEFT JOIN finding f
                     ON f.content_id=c.id AND f.superseded=0
                GROUP BY c.team"""):
            t = r["total"] or 1
            by_team.append(TeamScore(
                team=r["team"], total=r["total"], approved=r["approved"],
                pending=r["pending"], findings=r["findings"] or 0,
                criticals=r["criticals"] or 0,
                compliance_rate=round((r["approved"] or 0) / t * 100, 1)))

        # --- category x severity heat map (guideline-gap view) ---
        heat_map = [
            {"category": c, "severity": s, "count": heat.get((c, s), 0)}
            for c in ("tone", "term", "claim", "a11y", "visual")
            for s in ("critical", "warning", "suggestion")]

        # --- overdue: in review past SLA (portable: computed in Python) ---
        now = datetime.now(timezone.utc)
        overdue = []
        for r in db.rows(conn, "SELECT id, title, status, sla_due_at "
                               "FROM content WHERE sla_due_at IS NOT NULL "
                               "AND status IN ('review','peer_review')"):
            try:
                due = datetime.fromisoformat(r["sla_due_at"])
            except (TypeError, ValueError):
                continue
            if due.tzinfo is None:
                due = due.replace(tzinfo=timezone.utc)
            if due < now:
                overdue.append({**r, "hours_late":
                                round((now - due).total_seconds() / 3600)})
        overdue.sort(key=lambda o: o["sla_due_at"])

        # --- stale facts: verified > 90 days ago ---
        stale = []
        for r in db.rows(conn, "SELECT id, claim, source, verified_at "
                               "FROM fact WHERE verified_at IS NOT NULL"):
            try:
                v = datetime.fromisoformat(r["verified_at"])
            except (TypeError, ValueError):
                continue
            if v.tzinfo is None:
                v = v.replace(tzinfo=timezone.utc)
            days_old = round((now - v).total_seconds() / 86400)
            if days_old > 90:
                stale.append({**r, "days_old": days_old})
        stale.sort(key=lambda s: s["days_old"], reverse=True)

    # guideline-gap analytics (Living KB v2): recurring finding categories
    # with no covering passage in the ingested guideline documents
    gap_summary = [
        {"category": g["category"], "count": g["count"],
         "missing": g["missing_passages"]}
        for g in guideline_gaps()
    ]

    # compliance = approved content with zero unresolved criticals
    compliant = approved
    rate = round(compliant / total * 100, 1) if total else 0.0
    return AnalyticsSummary(
        total_content=total, approved=approved, pending=pending,
        compliance_rate=rate, total_findings=n_find,
        by_category=[CategoryCount(**c) for c in by_cat],
        most_violated_rules=rules, findings_by_severity=by_sev,
        llm_calls=cost.get("calls", 0), total_tokens=cost.get("tok", 0),
        by_team=by_team, heat_map=heat_map,
        overdue_reviews=overdue, stale_facts=stale,
        guideline_gaps=gap_summary)


@app.get("/analytics/trend", response_model=TrendResponse)
def analytics_trend(days: int = 30,
                    user: dict = Depends(require_role("manager"))):
    """Daily created/approved/findings series for the compliance chart."""
    days = max(7, min(days, 90))
    today = datetime.now(timezone.utc).date()
    start = today - timedelta(days=days - 1)
    start_s = start.isoformat()
    with db.get() as conn:
        rows = db.rows(conn,
            "SELECT substr(created_at,1,10) d, COUNT(*) n,"
            " SUM(CASE WHEN status IN ('approved','published')"
            " THEN 1 ELSE 0 END) appr FROM content "
            "WHERE substr(created_at,1,10) >= ? GROUP BY d", (start_s,))
        created = {r["d"]: r["n"] for r in rows}
        approved = {r["d"]: r["appr"] for r in rows}
        found = {r["d"]: r["n"] for r in db.rows(conn,
            "SELECT substr(created_at,1,10) d, COUNT(*) n FROM finding "
            "WHERE superseded=0 AND substr(created_at,1,10) >= ? "
            "GROUP BY d", (start_s,))}
    points = []
    for i in range(days):
        d = (start + timedelta(days=i)).isoformat()
        created_n = created.get(d, 0)
        approved_n = approved.get(d, 0)
        points.append(TrendPoint(
            date=d, created=created_n, approved=approved_n,
            findings=found.get(d, 0),
            compliance_rate=round(approved_n / created_n * 100, 1)
            if created_n else 0.0))
    return TrendResponse(days=days, points=points)


# ---------- uploads (image content) ----------
@app.post("/content/{cid}/upload", response_model=ContentOut)
def upload_image(cid: int, file: UploadFile = File(...),
                 alt: str = Form(""),
                 user: dict = Depends(current_user)):
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(400, "file must be an image")

    # sync def → FastAPI runs this in a threadpool, so PIL/disk/DB work here
    # never blocks the event loop.
    data = file.file.read()
    if len(data) > settings.max_upload_bytes:
        raise HTTPException(
            413, f"image exceeds "
                 f"{settings.max_upload_bytes // (1024 * 1024)}MB limit")

    # verify it really is a decodable image (stops disguised files)
    try:
        from PIL import Image
        probe = Image.open(io.BytesIO(data))
        probe.verify()
        w, h = probe.size
        if w > 8192 or h > 8192 or (w * h) > 25_000_000:
            raise HTTPException(400, "image dimensions exceed maximum allowable limit (8192x8192)")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(400, "file is not a valid image")

    # SVG script injection protection
    if Path(file.filename or "").suffix.lower() == ".svg" or "svg" in (file.content_type or "").lower():
        raw_text = data.decode("utf-8", errors="ignore").lower()
        if "<script" in raw_text or "javascript:" in raw_text or "onload=" in raw_text or "onerror=" in raw_text:
            raise HTTPException(400, "SVG contains disallowed active scripts")

    with db.get() as conn:
        if not db.one(conn, "SELECT id FROM content WHERE id=?", (cid,)):
            raise HTTPException(404, "content not found")

    # safe filename: uuid + basename only (no path traversal)
    safe = f"{cid}_{uuid.uuid4().hex[:8]}.png" if not re.fullmatch(
        r"[\w.\- ]+\.(png|jpe?g|webp|gif|svg)",
        Path(file.filename or "").name, re.IGNORECASE) else \
        f"{cid}_{uuid.uuid4().hex[:8]}_{Path(file.filename).name}"
    dest = Path(settings.upload_dir) / safe
    dest.write_bytes(data)

    text = alt  # alt text rides on the text field for a11y checks
    with db.get() as conn:
        conn.execute(
            "UPDATE content SET image_path=?, text=CASE WHEN text='' "
            "THEN ? ELSE text END, type='image' WHERE id=?",
            (f"/uploads/{safe}", text, cid))   # URL, not filesystem path
        conn.commit()
        return db.one(conn, "SELECT * FROM content WHERE id=?", (cid,))


# static files for uploaded images (deploy-safe: served by this app)
Path(settings.upload_dir).mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=settings.upload_dir), name="uploads")
