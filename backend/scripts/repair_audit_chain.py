"""Relink the audit hash chain after a forked append (race bug).

Run with DATABASE_URL pointing at the target DB:

    DATABASE_URL=postgres://... python backend/scripts/repair_audit_chain.py
    DATABASE_URL=postgres://... python backend/scripts/repair_audit_chain.py --apply

Dry-run by default: reports the first break and how many rows would be
relinked. --apply rewrites only prev_hash/hash, in one transaction, from the
first break to the end. Row contents (actor/action/detail/at) are untouched.
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import db  # noqa: E402


def plan(rows):
    """Return [(id, prev_hash, hash)] for every row that needs relinking."""
    prev, fixes, first = "genesis", [], None
    for r in rows:
        expect = db._chain_hash(prev, r["content_id"], r["actor"],
                                r["action"], r["detail"], r["tokens"], r["at"])
        if r["hash"] != expect:
            if first is None:
                first = r["id"]
            fixes.append((r["id"], prev, expect))
        prev = expect
    return first, fixes


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="write the repair")
    args = ap.parse_args()

    with db.get() as conn:
        rows = db.rows(conn, "SELECT * FROM audit ORDER BY id")
        first, fixes = plan(rows)
        print(f"rows={len(rows)} first_break={first} relink={len(fixes)}")
        if not fixes:
            print("chain already valid")
            return 0
        if not args.apply:
            print("dry-run; re-run with --apply to write")
            return 1
        for rid, prev_hash, h in fixes:
            conn.execute("UPDATE audit SET prev_hash=?, hash=? WHERE id=?",
                         (prev_hash, h, rid))
        conn.commit()
        print("after repair:", db.verify_chain())
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
