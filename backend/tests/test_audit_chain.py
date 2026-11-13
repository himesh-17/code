"""Concurrent audit appends must not fork the hash chain.

Two writers that both read the same "last hash" and then insert create a
duplicate link (same prev_hash/hash) and verify_chain() reports broken_at.
This test reproduces that race with threads and asserts the chain stays valid.
"""
import threading

from app import db


def setup_module(module):
    db.init()


def test_concurrent_log_audit_stays_valid(monkeypatch):
    n_threads, per_thread = 8, 12
    errors = []
    barrier = threading.Barrier(n_threads)

    def worker(i: int):
        try:
            barrier.wait(timeout=10)
            for j in range(per_thread):
                with db.get() as conn:
                    db.log_audit(conn, None, f"u{i}", "login", f"w{i}-{j}")
                    conn.commit()
        except Exception as e:  # pragma: no cover - surfaced below
            errors.append(repr(e))

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(n_threads)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=60)

    assert not errors, errors
    res = db.verify_chain()
    assert res["ok"] is True, res
    assert res["checked"] >= n_threads * per_thread
