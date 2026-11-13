"""RAG-lite retrieval over brand-guideline chunks.

Two interchangeable ranks over the same kb_chunk store:
  * BM25 (stdlib) for the pinned `guideline` table bodies
  * semantic cosine for ingested documents (Living KB v2) — exact
    `embedding_vec <=>` distance on Postgres+pgvector, cosine-in-Python
    over the portable JSON column everywhere else.

Glossary + facts stay pinned in every prompt (exact-match data retrieval
can't miss); only the long guideline bodies are ranked/retrieved."""
import re
import json
import logging

from .. import db
from .embed import embed_texts

log = logging.getLogger("brandguard.retrieval")

_TOKEN = re.compile(r"[a-z0-9']+")
K1, B = 1.5, 0.75


def tokenize(text: str) -> list[str]:
    return _TOKEN.findall(text.lower())


def bm25_rank(query_tokens: list[str],
              docs_tokens: list[list[str]]) -> list[float]:
    """Standard BM25 scores for each doc against the query."""
    n = len(docs_tokens)
    if not n or not query_tokens:
        return [0.0] * n
    df: dict[str, int] = {}
    for d in docs_tokens:
        for t in set(d):
            df[t] = df.get(t, 0) + 1
    avgdl = sum(len(d) for d in docs_tokens) / n or 1.0
    scores = []
    for d in docs_tokens:
        tf: dict[str, int] = {}
        for t in d:
            tf[t] = tf.get(t, 0) + 1
        s = 0.0
        for t in query_tokens:
            if t not in tf:
                continue
            idf = __import__("math").log(1 + (n - df[t] + 0.5) / (df[t] + 0.5))
            freq = tf[t]
            s += idf * freq * (K1 + 1) / (
                freq + K1 * (1 - B + B * len(d) / avgdl))
        scores.append(s)
    return scores


def _cosine_sim(a: list[float], b: list[float]) -> float:
    """Cosine similarity between two unit vectors."""
    if not a or not b:
        return 0.0
    num = sum(x * y for x, y in zip(a, b))
    den = (sum(x * x for x in a) * sum(y * y for y in b)) ** 0.5
    return num / den if den else 0.0


def pgvector_cosine(conn, query_vec: list[float], top_k: int = 3) -> list[dict]:
    """Postgres + pgvector: exact cosine distance computed in the database.

    The JSON embedding stays the portable truth; embedding_vec is the
    derived index. Raises so callers can fall back on any error.
    """
    return db.rows(
        conn,
        "SELECT id, source, chunk_index, text, embedding FROM kb_chunk "
        "ORDER BY embedding_vec <=> %s::vector LIMIT %s",
        (json.dumps(query_vec), top_k))


def python_cosine(conn, query_vec: list[float], top_k: int = 3) -> list[dict]:
    """SQLite/JSON fallback: cosine similarity computed in Python."""
    rows_ = db.rows(
        conn, "SELECT id, source, chunk_index, text, embedding FROM kb_chunk")
    scored = []
    for r in rows_:
        try:
            stored = json.loads(r["embedding"])
        except (TypeError, ValueError):
            continue
        scored.append((_cosine_sim(query_vec, stored), r))
    scored.sort(key=lambda x: -x[0])
    return [r for _, r in scored[:top_k]]


def search_chunks(conn, query_vec: list[float], top_k: int = 3) -> list[dict]:
    """Best available ranker: pgvector when live, Python cosine otherwise."""
    if db.is_postgres() and db.vector_enabled:
        try:
            return pgvector_cosine(conn, query_vec, top_k)
        except Exception as e:
            log.warning("pgvector query failed, cosine-in-Python: %s", e)
    return python_cosine(conn, query_vec, top_k)


def relevant_kb_chunks(content: str, top_k: int = 3,
                       vec: list[float] | None = None,
                       force_local: bool = False) -> list[dict]:
    """kb_chunk passages most relevant to this content (semantic retrieval).

    Pass `vec` to reuse a pre-computed embedding and skip the API call.
    Empty content retrieves nothing — never cite a passage for copy that
    does not exist."""
    if not content or not content.strip():
        return []
    with db.get() as conn:
        if vec is None:
            vec = embed_texts([content], force_local=force_local)[0]
        return search_chunks(conn, vec, top_k)


def relevant_guidelines(content: str, top_k: int = 3) -> list[dict]:
    """Guideline chunks most relevant to this content (always ≥1, ordered)."""
    with db.get() as conn:
        guides = db.rows(conn, "SELECT * FROM guideline ORDER BY id")
    if not guides:
        return []
    docs = [tokenize(f"{g['title']} {g['body']}") for g in guides]
    scores = bm25_rank(tokenize(content), docs)
    ranked = sorted(zip(guides, scores), key=lambda x: -x[1])
    # keep everything if the KB is tiny or nothing matches at all
    total = sum(scores)
    if total == 0 or len(guides) <= top_k:
        return guides
    hits = [g for g, s in ranked[:top_k] if s > 0]
    return hits or ranked[:1]
