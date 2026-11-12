"""Living brand knowledge base: CRUD for guidelines/glossary/facts/colors,
plus bulk import (onboarding wizard) and export (backup/versioning).

Read = any authenticated role (creators must be able to consult the KB);
write/delete = manager+. Dict bodies keep /docs honest without Pydantic
boilerplate for four near-identical tables.

Also: ingest guideline PDFs/DOCX, auto-chunk+embed into kb_chunk, and
       persist 256-d vectors (Gemini API or local zlib.crc32 fallback).
"""
import io
import json
import re
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import JSONResponse

from . import db
from .auth import current_user, require_role
from .settings import settings

router = APIRouter(prefix="/kb", tags=["knowledge base"])

GLOSSARY_KINDS = {"approved", "prohibited", "preferred", "competitor"}

SPEC: dict[str, dict] = {
    "guidelines": {"table": "guideline", "fields": ("title", "body"),
                   "label": "title"},
    "glossary": {"table": "glossary", "fields": ("term", "kind", "note"),
                 "label": "term", "validate": "glossary"},
    "facts": {"table": "fact", "fields": ("claim", "source"),
              "label": "claim"},
    "colors": {"table": "brand_color", "fields": ("hex", "name"),
               "label": "hex", "validate": "hex"},
}


def _check(kind: str, body: dict) -> dict:
    spec = SPEC[kind]
    if not isinstance(body, dict):
        raise HTTPException(422, "body must be a JSON object")
    out = {}
    for f in spec["fields"]:
        val = str(body.get(f, "")).strip()
        if f in ("title", "body", "term", "claim") and not val:
            raise HTTPException(422, f"'{f}' is required")
        out[f] = val
    if spec.get("validate") == "glossary" and out["kind"] not in GLOSSARY_KINDS:
        raise HTTPException(422, f"kind must be one of "
                                 f"{sorted(GLOSSARY_KINDS)}")
    if spec.get("validate") == "hex" and not re.fullmatch(
            r"#[0-9A-Fa-f]{6}", out["hex"]):
        raise HTTPException(422, "hex must look like #1B4DFF")
    return out


@router.get("/export")
def export(_: dict = Depends(current_user)):
    with db.get() as conn:
        return {k: db.rows(conn, f"SELECT * FROM {s['table']} ORDER BY id")
                for k, s in SPEC.items()}


@router.post("/import")
def bulk_import(body: dict, user: dict = Depends(require_role("manager"))):
    """Onboarding: paste a whole brand book at once."""
    added, skipped = {}, []
    with db.get() as conn:
        for kind, items in (body or {}).items():
            if kind not in SPEC or not isinstance(items, list):
                skipped.append(kind)
                continue
            n = 0
            for item in items:
                data = _check(kind, item)          # validates + rejects bad
                cols = ", ".join(data)
                ph = ", ".join("?" * len(data))
                conn.execute(f"INSERT INTO {SPEC[kind]['table']} "
                             f"({cols}) VALUES ({ph})", tuple(data.values()))
                n += 1
            added[kind] = n
        db.log_audit(conn, None, user["email"], "kb_import",
                     f"added={added} skipped={skipped}")
    conn.commit()
    return {"added": added, "skipped": skipped}


def _extract_text(data: bytes, name: str) -> str:
    """Sync extraction (pypdf/docx are CPU-bound) — run off the event loop."""
    if name.endswith(".pdf"):
        try:
            import pypdf
            reader = pypdf.PdfReader(io.BytesIO(data))
            return " ".join(page.extract_text() or ""
                            for page in reader.pages)
        except Exception:
            return ""
    if name.endswith(".docx"):
        try:
            import docx
            doc = docx.Document(io.BytesIO(data))
            return "\n".join(p.text for p in doc.paragraphs if p.text)
        except Exception:
            return ""
    # .txt / .md / unknown-but-text: best-effort decode
    return data.decode("utf-8", errors="ignore")


def _read_file_text(upload: UploadFile) -> str:
    """Extract text from an uploaded guideline document.

    Extension-dispatched: a corrupt PDF/DOCX returns "" (honest
    'no text found') instead of decoding binary garbage into chunks."""
    data = upload.file.read()
    if not data:
        return ""
    return _extract_text(data, (upload.filename or "").lower())


CHUNK_SIZE = 1000
CHUNK_OVERLAP = 150


def chunk_text(text: str, size: int = CHUNK_SIZE,
               overlap: int = CHUNK_OVERLAP) -> list[str]:
    """~1000-char windows with 150-char overlap, cut on word boundaries."""
    flat = " ".join(text.split())
    if not flat:
        return []
    chunks, start = [], 0
    while start < len(flat):
        end = min(start + size, len(flat))
        if end < len(flat):
            cut = flat.rfind(" ", start, end)
            if cut > start + size // 2:
                end = cut
        piece = flat[start:end].strip()
        if piece:
            chunks.append(piece)
        if end >= len(flat):
            break
        start = max(end - overlap, start + 1)
    return chunks


@router.post("/ingest", name="kb_ingest")
def kb_ingest(
    file: UploadFile = File(...),
    user: dict = Depends(require_role("manager")),
):
    """Ingest a brand guideline PDF/DOCX/TXT (Living KB v2).

    Extract → chunk (~1000 chars, 150 overlap) → embed (Gemini or local
    256-d fallback) → store. The JSON embedding is the portable truth;
    the derived pgvector column is synced when available. Re-ingesting a
    file replaces its previous chunks. Returns {"chunks", "status", "source"}.

    Sync def on purpose: PDF/DOCX parsing and embedding are blocking, so
    FastAPI runs this in the threadpool instead of stalling the event loop.
    """
    source = Path(file.filename or "document").name
    text = _read_file_text(file)
    if not text.strip():
        return {"chunks": 0, "status": "no text found", "source": source}
    chunks = chunk_text(text)
    if not chunks:
        return {"chunks": 0, "status": "no usable chunks", "source": source}
    from .engine.embed import embed_texts
    embeddings = embed_texts(chunks)          # list[list[float]]
    added = 0
    with db.get() as conn:
        conn.execute("DELETE FROM kb_chunk WHERE source=?", (source,))
        for i, (chunk, vec) in enumerate(zip(chunks, embeddings)):
            cur = conn.execute(
                "INSERT INTO kb_chunk (source, chunk_index, text, embedding)"
                " VALUES (?,?,?,?) RETURNING id",
                (source, i, chunk, json.dumps(vec)))
            db.sync_vector(conn, cur.fetchone()["id"], vec)
            added += 1
        db.log_audit(conn, None, user["email"], "kb_ingest",
                     f"source={source} chunks={added}")
        conn.commit()
    from .engine.citation import clear_gap_cache
    clear_gap_cache()
    return {"chunks": added, "status": "ok", "source": source}


@router.get("/documents")
def kb_documents(_: dict = Depends(current_user)):
    """Ingested guideline documents with chunk counts (Living KB v2)."""
    with db.get() as conn:
        docs = db.rows(
            conn, "SELECT source, COUNT(*) chunks, MAX(created_at)"
                  " ingested_at FROM kb_chunk GROUP BY source"
                  " ORDER BY source")
        total = sum(d["chunks"] for d in docs)
    return {"documents": docs, "chunks": total}


# --- per-table CRUD (generated from SPEC, one code path) -------------------
for _kind, _spec in SPEC.items():
    def _list(kind: str = _kind, user: dict = Depends(current_user)):
        with db.get() as conn:
            return db.rows(conn, f"SELECT * FROM {SPEC[kind]['table']} "
                                 "ORDER BY id")

    def _create(kind: str = _kind, body: dict | None = None,
                user: dict = Depends(require_role("manager"))):
        data = _check(kind, body or {})
        with db.get() as conn:
            cols = ", ".join(data)
            ph = ", ".join("?" * len(data))
            cur = conn.execute(
                f"INSERT INTO {SPEC[kind]['table']} ({cols}) VALUES ({ph})"
                " RETURNING id",
                tuple(data.values()))
            new_id = cur.fetchone()["id"]
            db.log_audit(conn, None, user["email"], f"kb_create_{kind}",
                         str(data)[:200])
            conn.commit()
            return db.one(conn, f"SELECT * FROM {SPEC[kind]['table']} "
                                "WHERE id=?", (new_id,))

    def _update(i: int, kind: str = _kind, body: dict | None = None,
                user: dict = Depends(require_role("manager"))):
        with db.get() as conn:
            if not db.one(conn, f"SELECT id FROM {SPEC[kind]['table']} "
                                "WHERE id=?", (i,)):
                raise HTTPException(404, f"{kind} not found")
            data = _check(kind, body or {})
            sets = ", ".join(f"{k}=?" for k in data)
            conn.execute(f"UPDATE {SPEC[kind]['table']} SET {sets} WHERE id=?",
                         (*data.values(), i))
            db.log_audit(conn, None, user["email"], f"kb_update_{kind}",
                         f"id={i}")
            conn.commit()
            return db.one(conn, f"SELECT * FROM {SPEC[kind]['table']} "
                                "WHERE id=?", (i,))

    def _delete(i: int, kind: str = _kind,
                user: dict = Depends(require_role("manager"))):
        with db.get() as conn:
            if not db.one(conn, f"SELECT id FROM {SPEC[kind]['table']} "
                                "WHERE id=?", (i,)):
                raise HTTPException(404, f"{kind} not found")
            conn.execute(f"DELETE FROM {SPEC[kind]['table']} WHERE id=?", (i,))
            db.log_audit(conn, None, user["email"], f"kb_delete_{kind}",
                         f"id={i}")
            conn.commit()
        return {"deleted": i}

    router.add_api_route(f"/{_kind}", _list, methods=["GET"],
                         name=f"list_{_kind}")
    router.add_api_route(f"/{_kind}", _create, methods=["POST"],
                         name=f"create_{_kind}", status_code=201)
    router.add_api_route(f"/{_kind}/{{i}}", _update, methods=["PATCH"],
                         name=f"update_{_kind}")
    router.add_api_route(f"/{_kind}/{{i}}", _delete, methods=["DELETE"],
                         name=f"delete_{_kind}")
