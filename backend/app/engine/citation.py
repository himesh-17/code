"""Source citation for findings (Living KB v2).

attach_citations() grounds every finding in the exact kb_chunk passage
retrieved for the submission, so reviewers can audit the copy against the
organisation's real guideline document. guideline_gaps() surfaces recurring
finding categories that no ingested passage covers — the KB coverage gaps
shown on the dashboard."""
from __future__ import annotations

import logging

from .. import db
from ..models import Finding
from .retrieval import relevant_kb_chunks, tokenize

# guideline_gaps() re-embeds on every analytics load (an external Gemini call
# when a key is set). Cache by a cheap signature of its inputs; ingest clears
# it explicitly so updated guidelines are never served stale.
_GAP_CACHE: dict[tuple, list[dict]] = {}
_GAP_CACHE_MAX = 8


def clear_gap_cache() -> None:
    _GAP_CACHE.clear()

log = logging.getLogger("brandguard.citation")

# A passage counts as coverage for a category when it mentions any of
# these domain keywords (matched against the retrieved corpus).
CATEGORY_KEYWORDS: dict[str, tuple[str, ...]] = {
    "tone":   ("tone", "voice", "style", "writing", "language"),
    "term":   ("term", "glossary", "naming", "product name", "currency"),
    "claim":  ("claim", "fact", "substantiat", "legal", "disclaimer", "fdic"),
    "a11y":   ("accessib", "wcag", "contrast", "alt text", "screen reader"),
    "visual": ("visual", "colour", "color", "palette", "logo", "font"),
}

PASSAGE_LIMIT = 240


def _passage(text: str, limit: int = PASSAGE_LIMIT) -> str:
    """Flatten whitespace and trim at a word boundary for evidence display."""
    flat = " ".join(text.split())
    if len(flat) <= limit:
        return flat
    return flat[:limit].rsplit(" ", 1)[0] + "…"


def attach_citations(findings: list[Finding], content_text: str,
                     top_k: int = 5, force_local: bool = False) -> list[Finding]:
    """Append the exact source passage to each finding's evidence.

    Retrieval happens once per submission (semantic, over kb_chunk); each
    finding then picks the chunk sharing the most tokens with its rule and
    excerpt. Findings with no grounded overlap are left untouched — a
    citation must never point at an unrelated passage."""
    if not findings or not content_text or not content_text.strip():
        return findings
    chunks = relevant_kb_chunks(content_text, top_k=top_k, force_local=force_local)
    if not chunks:
        return findings
    chunk_tokens = [set(tokenize(c["text"])) for c in chunks]
    for f in findings:
        query_tokens = set(tokenize(f"{f.rule} {f.excerpt} {f.suggestion}"))
        if not query_tokens:
            query_tokens = set(tokenize(content_text))
        best, best_overlap = -1, 0
        for i, ct in enumerate(chunk_tokens):
            overlap = len(query_tokens & ct)
            if overlap > best_overlap:
                best, best_overlap = i, overlap
        if best < 0:
            continue
        c = chunks[best]
        cite = (f'KB: {c["source"]} §{c["chunk_index"]} — '
                f'"{_passage(c["text"])}"')
        f.evidence = f"{f.evidence} | {cite}" if f.evidence else cite
    return findings


def guideline_gaps() -> list[dict]:
    """Recurring finding categories with no covering passage in the KB.

    One semantic retrieval covers the whole analytics call; a category is
    marked missing when none of its domain keywords appear in the retrieved
    corpus (or the KB is empty). Returns [{category, count, missing_passages}].
    """
    with db.get() as conn:
        counts = db.rows(
            conn, "SELECT category, COUNT(*) AS cnt FROM finding "
                  "WHERE accepted=0 AND superseded=0 GROUP BY category")
        rules = db.rows(conn, "SELECT DISTINCT rule FROM finding "
                              "WHERE accepted=0 AND superseded=0")
        n_chunks = db.one(conn, "SELECT COUNT(*) n FROM kb_chunk")["n"]
    if not counts:
        return []
    if not n_chunks:
        return [{"category": r["category"], "count": r["cnt"],
                 "missing_passages": True}
                for r in sorted(counts, key=lambda x: -x["cnt"])]
    key = (tuple(sorted((r["category"], r["cnt"]) for r in counts)),
           tuple(sorted(r["rule"] for r in rules)), n_chunks)
    cached = _GAP_CACHE.get(key)
    if cached is not None:
        return cached
    query = " ".join([r["category"] for r in counts]
                     + [r["rule"] for r in rules])
    # At this KB's scale consider (almost) the whole store — a gap means
    # "no passage anywhere covers this", not "not in the top 3".
    chunks = relevant_kb_chunks(query, top_k=min(n_chunks, 40))
    corpus = " ".join(c["text"].lower() for c in chunks)
    gaps = []
    for r in sorted(counts, key=lambda x: -x["cnt"]):
        keywords = CATEGORY_KEYWORDS.get(r["category"],
                                         (r["category"].lower(),))
        gaps.append({
            "category": r["category"],
            "count": r["cnt"],
            "missing_passages": not any(k in corpus for k in keywords),
        })
    _GAP_CACHE[key] = gaps
    if len(_GAP_CACHE) > _GAP_CACHE_MAX:
        _GAP_CACHE.pop(next(iter(_GAP_CACHE)))
    return gaps
