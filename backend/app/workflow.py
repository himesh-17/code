"""Collaborative workflow: peer review, comment threads, version history
with side-by-side diff data, SLA publishing, signed webhooks, audit verify."""
from collections import defaultdict, deque
import difflib
import hashlib
import hmac
import json
import time
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from . import db
from .auth import current_user, require_role
from .settings import settings
from .state import LOCKED, require_transition

router = APIRouter(tags=["workflow"])


# --- helpers ---------------------------------------------------------------
def _content(conn, cid: int) -> dict:
    row = db.one(conn, "SELECT * FROM content WHERE id=?", (cid,))
    if not row:
        raise HTTPException(404, "content not found")
    return row


def _snapshot(conn, cid: int, author: str) -> int:
    """Record the current text as the next immutable version."""
    row = _content(conn, cid)
    n = db.one(conn, "SELECT COALESCE(MAX(version),0) v FROM content_version "
                     "WHERE content_id=?", (cid,))["v"] + 1
    conn.execute(
        "INSERT INTO content_version (content_id, version, title, text,"
        " status, author) VALUES (?,?,?,?,?,?)",
        (cid, n, row["title"], row["text"], row["status"], author))
    return n


def _dispatch_webhook(event: str, cid: int, extra: dict) -> dict:
    """HMAC-SHA256-signed POST to WEBHOOK_URL ("" = disabled)."""
    if not settings.webhook_url:
        return {"sent": False, "reason": "webhook_url not configured"}
    payload = {"event": event, "content_id": cid, "product": "BrandGuard AI",
               **extra}
    body = json.dumps(payload, sort_keys=True).encode()
    sig = hmac.new(settings.webhook_secret.encode(), body,
                   hashlib.sha256).hexdigest()
    try:
        import httpx
        r = httpx.post(settings.webhook_url, content=body,
                       headers={"X-BrandGuard-Signature": f"sha256={sig}",
                                "Content-Type": "application/json"},
                       timeout=3.0)
        return {"sent": r.is_success, "status": r.status_code}
    except Exception as e:                       # webhook must never block publish
        return {"sent": False, "error": str(e)[:120]}


def _dispatch_slack(row: dict, email: str) -> dict:
    """Post publication alert to Slack ("" = disabled). Never raises."""
    if not settings.slack_webhook_url:
        return {"sent": False, "reason": "slack_webhook_url not configured"}
    payload = {
        "text": f" BrandGuard published *{row['title']}* ({row['channel']}) by {email}"
    }
    try:
        import httpx
        r = httpx.post(settings.slack_webhook_url, json=payload, timeout=3.0)
        return {"sent": r.is_success, "status": r.status_code}
    except Exception as e:
        return {"sent": False, "error": str(e)[:120]}


def _rate_limit(request: Request) -> None:
    # Delegate to main.py's rate_limit to share the in-memory window across all endpoints
    from .main import rate_limit
    rate_limit(request)


class PeerBody(BaseModel):
    action: str                          # approve | reject
    note: str = Field(default="", max_length=1000)


class CommentBody(BaseModel):
    body: str = Field(..., min_length=1, max_length=5000)
    parent_id: int | None = None


class CommentPatch(BaseModel):
    resolved: bool
    reply: str = Field(default="", max_length=5000)


class ContentPatch(BaseModel):
    title: str | None = Field(default=None, max_length=500)
    text: str | None = Field(default=None, max_length=50_000)


class RemediateBody(BaseModel):
    finding_ids: list[int] | None = None   # None => all accepted (1)
    apply: bool = False


# --- peer review stage -----------------------------------------------------
@router.post("/content/{cid}/peer-review")
def peer_review(cid: int, body: PeerBody,
                user: dict = Depends(require_role("reviewer"))):
    if body.action not in ("approve", "reject"):
        raise HTTPException(422, "action must be approve|reject")
    new_status = "peer_review" if body.action == "approve" else "changes"
    with db.get() as conn:
        row = _content(conn, cid)
        require_transition(row["status"], new_status, user["role"])
        if new_status == "peer_review":
            # SLA window restarts for the manager's decision (not just the
            # original AI review) so peer-review time is accounted for.
            due = (datetime.now(timezone.utc)
                   + timedelta(hours=settings.sla_hours)
                   ).strftime("%Y-%m-%d %H:%M:%S")
            conn.execute("UPDATE content SET status=?, sla_due_at=? WHERE id=?",
                         (new_status, due, cid))
        else:
            conn.execute("UPDATE content SET status=?, sla_due_at=NULL "
                         "WHERE id=?", (new_status, cid))
        _snapshot(conn, cid, user["email"])
        db.log_audit(conn, cid, user["email"], f"peer_{body.action}",
                     body.note[:200])
        conn.commit()
        return db.one(conn, "SELECT * FROM content WHERE id=?", (cid,))


# --- comment threads -------------------------------------------------------
@router.get("/content/{cid}/comments")
def list_comments(cid: int, user: dict = Depends(current_user)):
    with db.get() as conn:
        _content(conn, cid)
        return db.rows(conn, "SELECT * FROM comment WHERE content_id=? "
                             "ORDER BY id", (cid,))


@router.post("/content/{cid}/comments", status_code=201)
def add_comment(cid: int, body: CommentBody,
                user: dict = Depends(current_user)):
    if not body.body.strip():
        raise HTTPException(422, "comment body required")
    with db.get() as conn:
        _content(conn, cid)
        if body.parent_id:
            parent = db.one(conn, "SELECT id FROM comment WHERE id=? "
                                  "AND content_id=?", (body.parent_id, cid))
            if not parent:
                raise HTTPException(404, "parent comment not found")
        cur = conn.execute(
            "INSERT INTO comment (content_id, parent_id, author, body) "
            "VALUES (?,?,?,?) RETURNING id",
            (cid, body.parent_id, user["email"], body.body.strip()))
        new_id = cur.fetchone()["id"]
        db.log_audit(conn, cid, user["email"], "comment",
                     body.body.strip()[:200])
        conn.commit()
        return db.one(conn, "SELECT * FROM comment WHERE id=?",
                      (new_id,))


@router.patch("/comments/{iid}")
def resolve_comment(iid: int, body: CommentPatch,
                    user: dict = Depends(require_role("reviewer"))):
    with db.get() as conn:
        row = db.one(conn, "SELECT * FROM comment WHERE id=?", (iid,))
        if not row:
            raise HTTPException(404, "comment not found")
        conn.execute("UPDATE comment SET resolved=? WHERE id=?",
                     (1 if body.resolved else 0, iid))
        # If reply message provided, create a reply comment
        if body.reply and body.reply.strip():
            conn.execute(
                "INSERT INTO comment (content_id, parent_id, author, body) "
                "VALUES (?,?,?,?)",
                (row["content_id"], iid, user["email"], body.reply.strip()))
            db.log_audit(conn, row["content_id"], user["email"], "comment_reply",
                         body.reply.strip()[:200])
        db.log_audit(conn, row["content_id"], user["email"],
                     "comment_resolve", f"comment {iid} -> {body.resolved}")
        conn.commit()
        return db.one(conn, "SELECT * FROM comment WHERE id=?", (iid,))


# --- version history + diff ------------------------------------------------
@router.patch("/content/{cid}")
def edit_content(cid: int, body: ContentPatch,
                 user: dict = Depends(current_user)):
    with db.get() as conn:
        row = _content(conn, cid)
        if row["status"] in LOCKED:
            raise HTTPException(403, "approved/published content is locked")
        if body.text is None and body.title is None:
            raise HTTPException(422, "nothing to change")
        text_changed = body.text is not None and body.text != row["text"]
        sets, args = [], []
        if body.title is not None:
            sets.append("title=?"), args.append(body.title)
        if body.text is not None:
            sets.append("text=?"), args.append(body.text)
        if text_changed:
            # prior findings belong to the old text — supersede them (kept for
            # history) and drop back to draft
            sets.append("status='draft'")
            conn.execute("UPDATE finding SET superseded=1 WHERE content_id=?"
                         " AND superseded=0", (cid,))
        conn.execute(f"UPDATE content SET {', '.join(sets)} WHERE id=?",
                     (*args, cid))
        _snapshot(conn, cid, user["email"])     # record the NEW state
        db.log_audit(conn, cid, user["email"], "edit",
                     "text changed" if text_changed else "title changed")
        conn.commit()
        return db.one(conn, "SELECT * FROM content WHERE id=?", (cid,))


@router.get("/content/{cid}/versions")
def list_versions(cid: int, user: dict = Depends(current_user)):
    with db.get() as conn:
        _content(conn, cid)
        return db.rows(conn, "SELECT id, content_id, version, status,"
                             " author, created_at, length(text) AS chars"
                             " FROM content_version WHERE content_id=? "
                             "ORDER BY version", (cid,))


@router.get("/content/{cid}/diff")
def diff_versions(cid: int, frm: int, to: int,
                  user: dict = Depends(current_user)):
    """Side-by-side source for the UI: unified-diff line list."""
    with db.get() as conn:
        _content(conn, cid)
        a = db.one(conn, "SELECT * FROM content_version WHERE content_id=? "
                         "AND version=?", (cid, frm))
        b = db.one(conn, "SELECT * FROM content_version WHERE content_id=? "
                         "AND version=?", (cid, to))
    if not a or not b:
        raise HTTPException(404, "version not found")
    lines = list(difflib.unified_diff(
        a["text"].splitlines(), b["text"].splitlines(),
        fromfile=f"v{frm} ({a['status']})", tofile=f"v{to} ({b['status']})",
        lineterm=""))
    added = sum(1 for l in lines if l.startswith("+") and not l.startswith("+++"))
    removed = sum(1 for l in lines if l.startswith("-") and not l.startswith("---"))
    return {"from": frm, "to": to, "lines": lines,
            "added": added, "removed": removed}


# --- remediate (auto-apply fixes + re-review) ------------------------------
@router.post("/content/{cid}/remediate")
def remediate(cid: int, body: RemediateBody,
              user: dict = Depends(require_role("reviewer"))):
    with db.get() as conn:
        row = _content(conn, cid)
        if row["status"] in LOCKED:
            raise HTTPException(409, "approved/published content is locked")
        finds = db.rows(conn, "SELECT * FROM finding WHERE content_id=? "
                              "AND accepted=1 AND superseded=0", (cid,))
        if body.finding_ids is not None:
            wants = set(body.finding_ids)
            finds = [f for f in finds if f["id"] in wants]
        new, applied, skipped = row["text"], [], []
        for f in finds:
            ex, sug = f["excerpt"], f["suggestion"]
            # drop-in text replacements only: excerpt verbatim in current text
            if ex and ex in new and sug and sug != ex and len(sug) < 400:
                new = new.replace(ex, sug, 1)
                applied.append(f["id"])
            else:
                skipped.append(f["id"])
        if new == row["text"]:
            raise HTTPException(422, "no applicable accepted suggestions")
        diff = list(difflib.unified_diff(row["text"].splitlines(), new.splitlines(),
                                         fromfile="current", tofile="remediated", lineterm=""))
        if not body.apply:
            return {"applied": applied, "skipped": skipped, "lines": diff}   # preview
        conn.execute("UPDATE content SET text=?, status='draft' WHERE id=?", (new, cid))
        conn.execute("UPDATE finding SET superseded=1 WHERE content_id=?"
                     " AND superseded=0", (cid,))
        _snapshot(conn, cid, user["email"])          # reuse existing version capture
        db.log_audit(conn, cid, user["email"], "remediate",
                     f"applied={applied} skipped={skipped}")
        conn.commit()
    from .review_service import run_review_on       # auto re-review
    with db.get() as conn:
        row = db.one(conn, "SELECT * FROM content WHERE id=?", (cid,))
        result = run_review_on(conn, row, user)
    return {"applied": applied, "skipped": skipped,
            "lines": diff, "review": result}


# --- publish (integration target) -----------------------------------------
@router.post("/content/{cid}/publish")
def publish(cid: int, user: dict = Depends(require_role("manager"))):
    with db.get() as conn:
        row = _content(conn, cid)
        require_transition(row["status"], "published", user["role"])
        import datetime as _dt
        now = _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
        conn.execute("UPDATE content SET status='published', "
                     "published_at=? WHERE id=?", (now, cid))
        _snapshot(conn, cid, user["email"])
        result = _dispatch_webhook("content.published", cid, {
            "channel": row["channel"], "title": row["title"],
            "published_by": user["email"]})
        slack_result = _dispatch_slack(row, user["email"])
        db.log_audit(conn, cid, user["email"], "publish",
                     json.dumps({"webhook": result, "slack": slack_result}))
        conn.commit()
        row = db.one(conn, "SELECT * FROM content WHERE id=?", (cid,))
    return {"content": row, "webhook": result, "slack": slack_result}


# --- inbound integrations (webhook listener) ------------------------------
@router.post("/integrations/inbound")
async def inbound_webhook(request: Request):
    """External tools (CI, Drive, CMS) trigger review, approval, or publish via HMAC.

    Each call performs exactly one action (review|approve|publish). Approve and
    publish bypass the human UI, so they can be disabled with
    INBOUND_ALLOW_AUTOPUBLISH=0 while keeping the read-only review action.
    """
    _rate_limit(request)
    if not settings.webhook_secret:
        raise HTTPException(503, "inbound webhook not configured: webhook_secret is unset")
    body_bytes = await request.body()
    sig_header = request.headers.get("X-BrandGuard-Signature", "")
    if not sig_header:
        raise HTTPException(401, "missing X-BrandGuard-Signature header")

    expected_sig = "sha256=" + hmac.new(
        settings.webhook_secret.encode(), body_bytes, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig_header, expected_sig):
        raise HTTPException(401, "invalid webhook signature")

    try:
        data = json.loads(body_bytes)
    except Exception:
        raise HTTPException(400, "invalid json body")

    action = data.get("action")
    cid = data.get("content_id")
    if action not in ("review", "approve", "publish"):
        raise HTTPException(400, f"unknown action: {action}")
    if not isinstance(cid, int):
        raise HTTPException(400, "content_id must be an integer")
    if action in ("approve", "publish") and not settings.inbound_allow_autopublish:
        raise HTTPException(
            403, "inbound approve/publish is disabled "
                 "(INBOUND_ALLOW_AUTOPUBLISH=0)")

    actor = "inbound-webhook"
    with db.get() as conn:
        row = _content(conn, cid)
        if action == "review":
            from .review_service import run_review_on
            system_user = {"email": "inbound-webhook@brandguard.system", "role": "reviewer"}
            result = run_review_on(conn, row, system_user)
            db.log_audit(conn, cid, actor, "inbound_review", "triggered via inbound webhook")
            conn.commit()
            return {"action": "review", "content_id": cid, "review": result}

        elif action == "approve":
            if row["status"] not in ("review", "peer_review"):
                raise HTTPException(
                    409, f"approval only from 'review'/'peer_review' (now '{row['status']}')")
            crit = db.one(conn, "SELECT COUNT(*) n FROM finding WHERE content_id=?"
                          " AND severity='critical' AND accepted=0"
                          " AND superseded=0", (cid,))["n"]
            if crit:
                raise HTTPException(
                    409, f"{crit} unresolved critical finding(s) — accept or dismiss them before approving")
            conn.execute("UPDATE content SET status='approved' WHERE id=?", (cid,))
            _snapshot(conn, cid, actor)
            db.log_audit(conn, cid, actor, "approve", "approved via inbound webhook")
            conn.commit()
            updated = db.one(conn, "SELECT * FROM content WHERE id=?", (cid,))
            return {"action": "approve", "content": updated}

        elif action == "publish":
            if row["status"] != "approved":
                raise HTTPException(
                    409, f"only approved content publishes (now '{row['status']}')")
            import datetime as _dt
            now = _dt.datetime.now(_dt.timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
            conn.execute("UPDATE content SET status='published', published_at=? WHERE id=?", (now, cid))
            _snapshot(conn, cid, actor)
            webhook_res = _dispatch_webhook("content.published", cid, {
                "channel": row["channel"], "title": row["title"], "published_by": actor})
            slack_res = _dispatch_slack(row, actor)
            db.log_audit(conn, cid, actor, "publish", json.dumps({"webhook": webhook_res, "slack": slack_res}))
            conn.commit()
            updated = db.one(conn, "SELECT * FROM content WHERE id=?", (cid,))
            return {"action": "publish", "content": updated, "webhook": webhook_res, "slack": slack_res}


# --- audit integrity -------------------------------------------------------
@router.get("/audit/verify")
def audit_verify(user: dict = Depends(require_role("manager"))):
    return db.verify_chain()
