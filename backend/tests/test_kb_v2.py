"""Living KB v2: document ingestion, embeddings, semantic retrieval,
source citations in findings, and guideline-gap analytics."""
import io
import json
import sys
import types

import pytest
from fastapi.testclient import TestClient

from app import db
from app.main import app
from app.settings import settings
from app.engine import citation, embed as embed_mod, retrieval
from app.kb import chunk_text
from app.models import Finding

client = TestClient(app)

GUIDE_TEXT = (
    "Brand voice guide. Always address the reader as you, never as the "
    "customer. Use short sentences, active voice, and concrete numbers. "
) * 25


@pytest.fixture(autouse=True)
def _startup():
    with client:
        yield


def hdr(role: str = "manager") -> dict:
    creds = {"creator": ("creator@brandguard.demo", "creator123"),
             "manager": ("manager@brandguard.demo", "manager123")}
    email, pw = creds[role]
    r = client.post("/auth/login", json={"email": email, "password": pw})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _ingest(content: bytes, name: str, role: str = "manager"):
    return client.post("/kb/ingest", headers=hdr(role),
                       files={"file": (name, content)})


def _make_pdf(text: str) -> bytes:
    """Minimal single-page PDF whose text pypdf can extract."""
    stream = f"BT /F1 12 Tf 72 720 Td ({text}) Tj ET".encode("latin-1")
    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        b"/Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length " + str(len(stream)).encode()
        + b" >>\nstream\n" + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for i, body in enumerate(objs, 1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n".encode() + body + b"\nendobj\n"
    xref = len(out)
    out += f"xref\n0 {len(objs) + 1}\n".encode()
    out += b"0000000000 65535 f \n"
    for off in offsets:
        out += f"{off:010d} 00000 n \n".encode()
    out += (f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\n"
            f"startxref\n{xref}\n%%EOF").encode()
    return bytes(out)


# --- ingestion --------------------------------------------------------------

def test_ingest_requires_manager():
    assert client.post("/kb/ingest").status_code in (401, 403)
    assert _ingest(b"some text", "x.txt",
                   role="creator").status_code == 403


def test_ingest_text_document_chunks_and_embeds():
    r = _ingest(GUIDE_TEXT.encode(), "brand-voice.txt")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok" and body["source"] == "brand-voice.txt"
    assert body["chunks"] >= 2                    # 2500+ chars → >1 chunk

    with db.get() as conn:
        rows = db.rows(conn, "SELECT * FROM kb_chunk "
                             "WHERE source='brand-voice.txt' "
                             "ORDER BY chunk_index")
        audits = db.rows(conn, "SELECT * FROM audit "
                               "WHERE action='kb_ingest'")
    assert len(rows) == body["chunks"]
    assert [r_["chunk_index"] for r_ in rows] == list(range(len(rows)))
    for r_ in rows:
        vec = json.loads(r_["embedding"])
        assert len(vec) == settings.embed_dim     # 256-d portable vectors
    assert any("brand-voice.txt" in a["detail"] for a in audits)


def test_ingest_documents_listing():
    _ingest(GUIDE_TEXT.encode(), "listing-check.txt")
    assert client.get("/kb/documents").status_code == 401
    docs = client.get("/kb/documents", headers=hdr("creator")).json()
    assert docs["chunks"] >= 1
    hit = [d for d in docs["documents"] if d["source"] == "listing-check.txt"]
    assert hit and hit[0]["chunks"] >= 1 and hit[0]["ingested_at"]


def test_reingest_same_source_replaces_chunks():
    first = _ingest(b"replacement probe document v1 " * 40,
                    "replace-me.txt").json()["chunks"]
    second = _ingest(b"replacement probe document v2 " * 40,
                     "replace-me.txt").json()["chunks"]
    assert first == second >= 1
    with db.get() as conn:
        n = db.one(conn, "SELECT COUNT(*) n FROM kb_chunk "
                         "WHERE source='replace-me.txt'")["n"]
    assert n == second                            # no duplicate accumulation


def test_ingest_docx_extracts_paragraphs():
    import docx
    d = docx.Document()
    d.add_paragraph("Visual identity rule: never stretch or recolor the logo.")
    d.add_paragraph("Palette limit: Signal Green max 10% of canvas.")
    buf = io.BytesIO()
    d.save(buf)
    r = _ingest(buf.getvalue(), "visual-guide.docx")
    assert r.status_code == 200 and r.json()["chunks"] >= 1
    with db.get() as conn:
        text = " ".join(r_["text"] for r_ in db.rows(
            conn, "SELECT text FROM kb_chunk WHERE source='visual-guide.docx'"))
    assert "never stretch or recolor the logo" in text
    assert "Signal Green" in text


def test_ingest_pdf_extracts_text():
    r = _ingest(_make_pdf("Logo guidelines: never stretch or recolor "
                          "the logo."), "logo-rules.pdf")
    assert r.status_code == 200 and r.json()["chunks"] >= 1
    with db.get() as conn:
        row = db.one(conn, "SELECT text FROM kb_chunk "
                           "WHERE source='logo-rules.pdf'")
    assert row and "never stretch or recolor the logo" in row["text"]


def test_ingest_empty_and_corrupt_files_are_honest():
    empty = _ingest(b"", "empty.txt").json()
    assert empty["chunks"] == 0 and empty["status"] == "no text found"
    corrupt = _ingest(b"not really a pdf at all", "broken.pdf").json()
    assert corrupt["chunks"] == 0 and corrupt["status"] == "no text found"


# --- chunking ---------------------------------------------------------------

def test_chunk_text_word_boundaries_and_overlap():
    text = " ".join(f"word{i}" for i in range(500))   # well over 1000 chars
    chunks = chunk_text(text, size=1000, overlap=150)
    assert len(chunks) >= 2
    assert all(len(c) <= 1000 for c in chunks)
    # overlap window is shared between consecutive chunks
    shared = set(chunks[0][-200:].split()) & set(chunks[1][:200].split())
    assert shared, "consecutive chunks must overlap"
    # no word is lost (chunk starts may split a token, never drop one)
    assert set(text.split()) <= set(" ".join(chunks).split())
    assert chunk_text("   ") == []
    assert len(chunk_text("short rule.", size=1000, overlap=150)) == 1


# --- embeddings -------------------------------------------------------------

def test_embed_local_deterministic_and_normalised():
    assert settings.gemini_api_key == ""          # conftest: no API spend
    a = embed_mod.embed_texts(["loyalty reward tier structure"])[0]
    b = embed_mod.embed_texts(["loyalty reward tier structure"])[0]
    assert a == b and len(a) == settings.embed_dim
    norm = sum(x * x for x in a) ** 0.5
    assert abs(norm - 1.0) < 1e-6                 # L2-normalised
    c = embed_mod.embed_texts(["completely unrelated astronomy words"])[0]
    assert a != c


def test_embed_gemini_path_and_fallback(monkeypatch):
    dim = settings.embed_dim
    gemini_vec = [1.0] + [0.0] * (dim - 1)

    class _FakeOpenAI:
        def __init__(self, **kw):
            self.embeddings = self

        def create(self, model, input, dimensions):
            assert model == settings.embed_model
            assert dimensions == dim
            return types.SimpleNamespace(
                data=[types.SimpleNamespace(embedding=gemini_vec)
                      for _ in input])

    fake = types.ModuleType("openai")
    fake.OpenAI = _FakeOpenAI
    monkeypatch.setitem(sys.modules, "openai", fake)
    monkeypatch.setattr(settings, "gemini_api_key", "test-key")
    assert embed_mod.embed_texts(["hello", "world"]) == [gemini_vec,
                                                         gemini_vec]

    class _Boom:
        def __init__(self, **kw):
            raise RuntimeError("gemini down")

    fake.OpenAI = _Boom                          # API failure → local fallback
    embed_mod.reset_client()
    out = embed_mod.embed_texts(["hello"])
    assert out == [embed_mod._local("hello")]


# --- retrieval --------------------------------------------------------------

def test_semantic_retrieval_ranks_related_chunk_first():
    texts = ["puppy dog treats and kennel training schedule",
             "car engine oil change mileage intervals",
             "quantum physics lecture notes for students"]
    with db.get() as conn:
        for i, t in enumerate(texts):
            conn.execute(
                "INSERT INTO kb_chunk (source, chunk_index, text, embedding)"
                " VALUES (?,?,?,?)",
                ("retrieval-probe.txt", i, t,
                 json.dumps(embed_mod._local(t))))
        conn.commit()
    hits = retrieval.relevant_kb_chunks("puppy dog kennel treats", top_k=1)
    assert hits and "puppy" in hits[0]["text"]


def test_search_chunks_falls_back_to_python_on_sqlite():
    assert db.is_postgres() is False
    assert db.vector_enabled is False             # JSON cosine mode in tests
    vec = embed_mod._local("brand palette colour logo")
    with db.get() as conn:
        routed = retrieval.search_chunks(conn, vec, top_k=3)
        direct = retrieval.python_cosine(conn, vec, top_k=3)
    assert routed == direct


def test_relevant_kb_chunks_empty_content_is_noop():
    assert retrieval.relevant_kb_chunks("") == []
    assert retrieval.relevant_kb_chunks("   ") == []


# --- citations --------------------------------------------------------------

def test_attach_citations_grounded_in_source_passage():
    findings = [Finding(category="tone", severity="warning",
                        rule="Urgency / pressure tactics are off-tone",
                        excerpt="hurry",
                        suggestion="Remove urgency; state the benefit "
                                   "calmly.")]
    out = citation.attach_citations(
        findings, "Do not use urgency countdowns or fear tactics.")
    assert out is findings
    assert findings[0].evidence.startswith("KB: ")
    assert "brand-guidelines.md" in findings[0].evidence
    # chunk coordinate + verbatim passage from the Tone of Voice guideline
    assert "§0" in findings[0].evidence
    assert "Tone of Voice" in findings[0].evidence


def test_attach_citations_noop_without_text_or_kb():
    findings = [Finding(category="tone", severity="warning",
                        rule="r", excerpt="e", suggestion="s")]
    before = findings[0].evidence
    assert citation.attach_citations(findings, "   ")[0].evidence == before
    assert citation.attach_citations([], "some copy") == []


def test_review_findings_cite_guideline_passage():
    """E2E: a reviewed submission carries KB source citations."""
    made = client.post("/content", headers=hdr("creator"), json={
        "type": "text", "title": "citation e2e",
        "text": "HURRY!!! Act now — guaranteed returns for our users "
                "before it's gone!", "channel": "web"})
    assert made.status_code == 201
    cid = made.json()["id"]
    body = client.post(f"/content/{cid}/review?force_mock=true",
                       headers=hdr("creator"))
    assert body.status_code == 200
    findings = body.json()["findings"]
    assert findings, "mock engine must produce findings for this copy"
    cited = [f for f in findings if "KB:" in (f.get("evidence") or "")]
    assert cited, f"findings missing KB citations: " \
                  f"{[f['evidence'] for f in findings]}"
    assert all("§" in f["evidence"] for f in cited)   # chunk coordinate


# --- guideline-gap analytics ------------------------------------------------

def test_guideline_gaps_marks_missing_when_kb_empty():
    with db.get() as conn:
        if not db.one(conn, "SELECT COUNT(*) n FROM finding")["n"]:
            conn.execute("INSERT INTO content (type, title, text) "
                         "VALUES ('text','gap probe','copy')")
            cid = db.one(conn, "SELECT MAX(id) id FROM content")["id"]
            conn.execute(
                "INSERT INTO finding (content_id, category, severity, rule)"
                " VALUES (?,?,?,?)",
                (cid, "tone", "warning", "Urgency tactics are off-tone"))
            conn.commit()
        saved = db.rows(conn, "SELECT source, chunk_index, text, embedding "
                              "FROM kb_chunk")
        conn.execute("DELETE FROM kb_chunk")
        conn.commit()
    try:
        gaps = citation.guideline_gaps()
        assert gaps, "findings exist, so gaps must be reported"
        assert all(g["missing_passages"] for g in gaps)
        assert all(g["count"] > 0 for g in gaps)
    finally:
        with db.get() as conn:
            for r in saved:
                conn.execute(
                    "INSERT INTO kb_chunk (source, chunk_index, text,"
                    " embedding) VALUES (?,?,?,?)",
                    (r["source"], r["chunk_index"], r["text"],
                     r["embedding"]))
            conn.commit()


def test_guideline_gaps_covered_by_seeded_guidelines():
    with db.get() as conn:
        assert db.one(conn, "SELECT COUNT(*) n FROM kb_chunk")["n"] > 0
    gaps = citation.guideline_gaps()
    assert gaps
    uncovered = [g["category"] for g in gaps if g["missing_passages"]]
    assert not uncovered, f"seeded brand book covers all categories: " \
                          f"{uncovered}"


def test_analytics_summary_exposes_guideline_gaps():
    r = client.get("/analytics/summary", headers=hdr("manager"))
    assert r.status_code == 200
    gaps = r.json()["guideline_gaps"]
    assert isinstance(gaps, list) and gaps
    assert all({"category", "count", "missing"} <= set(g) for g in gaps)
    assert all(g["count"] > 0 and isinstance(g["missing"], bool)
               for g in gaps)
