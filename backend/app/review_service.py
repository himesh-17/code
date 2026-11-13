"""Shared review runner — the one place that runs a full review.

Called by POST /content/{cid}/review (main.py) and by the auto
re-review inside workflow remediation (Round 3 improvement #2).
Kept out of main.py so workflow.py can import it without a cycle.
"""
from datetime import datetime, timedelta, timezone
import logging
import time

from fastapi import HTTPException

from . import db
from .settings import settings
from .engine.citation import attach_citations
from .models import Finding, ReviewResult
from .engine import review as engine, a11y, compliance, visual, vision

log = logging.getLogger("brandguard.review")


def _stamp(items: list[dict], source: str) -> list[Finding]:
    for d in items:
        d.setdefault("evidence", source)
    return [Finding(**d) for d in items]


def run_review_on(row: dict, user: dict,
                  force_mock: bool = False) -> ReviewResult:
    """Run engine + deterministic checks + vision, persist findings,
    stamp SLA, audit.

    The LLM/vision/embedding calls happen with NO database connection held;
    the connection is only opened for the write at the end. This keeps a slow
    provider from starving the pool (and, on SQLite, from holding a lock)."""
    start = time.monotonic()
    budget = settings.review_budget_sec
    cid = row["id"]
    findings, llm_used, latency, provider, tokens = engine.review(
        row["text"], use_mock=force_mock)

    findings += _stamp(a11y.check(row["text"]),
                       "Brand accessibility guideline (WCAG 2.1 AA)")
    findings += _stamp(compliance.check(row["text"], row["type"]),
                       "Guideline: Claims & Compliance")
    if row["image_path"] and time.monotonic() - start < budget:
        findings += _stamp(visual.check(row["image_path"]),
                           "Guideline: Visual Identity (palette)")
        if not force_mock:
            vision_findings, vision_tokens = vision.check(row["image_path"])
            findings += _stamp(vision_findings,
                               "Vision OCR + pixel WCAG (Gemini)")
            tokens += vision_tokens
    elif row["image_path"]:
        log.warning("review %s: budget exhausted before vision check", cid)

    # Living KB v2: cite the exact guideline passage behind each finding
    # (semantic retrieval over kb_chunk — no-op when the KB has no chunks)
    if time.monotonic() - start < budget:
        findings = attach_citations(findings, row["text"], force_local=force_mock)
    else:
        log.warning("review %s: budget exhausted before citations", cid)

    with db.get() as conn:
        # Supersede prior findings (kept for history) rather than deleting
        # them, then write this review's findings.
        conn.execute(
            "UPDATE finding SET superseded=1 WHERE content_id=? AND superseded=0",
            (cid,))
        for f in findings:
            conn.execute(
                "INSERT INTO finding (content_id, category, severity, rule,"
                " excerpt, suggestion, confidence, evidence)"
                " VALUES (?,?,?,?,?,?,?,?)",
                (cid, f.category, f.severity, f.rule, f.excerpt,
                 f.suggestion, f.confidence, f.evidence))
        # SLA timer: review window starts at submission
        due = (datetime.now(timezone.utc)
               + timedelta(hours=settings.sla_hours)
               ).strftime("%Y-%m-%d %H:%M:%S")
        conn.execute(
            "UPDATE content SET status='review', sla_due_at=?"
            " WHERE id=? AND status='draft'",
            (due, cid))
        db.log_audit(conn, cid, user["email"], "review",
                     f"{len(findings)} findings ({provider}), {latency}ms",
                     tokens)
        conn.commit()
        stored = db.rows(conn, "SELECT * FROM finding WHERE content_id=? "
                         "AND superseded=0 ORDER BY id", (cid,))

    model_name = {
        "groq": settings.groq_model,
        "openai": settings.openai_model,
        "mock": "mock-rules",
    }.get(provider, provider)
    return ReviewResult(content_id=cid,
                        findings=[Finding(**f) for f in stored],
                        provider=provider, model=model_name,
                        llm_used=llm_used,
                        latency_ms=latency, tokens=tokens)
