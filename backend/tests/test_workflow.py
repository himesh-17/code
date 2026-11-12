"""Workflow: peer review, comments, versions/diff, SLA, publish, audit chain."""
import sqlite3

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.settings import settings

client = TestClient(app)

CREDS = {"creator": ("creator@brandguard.demo", "creator123"),
         "reviewer": ("reviewer@brandguard.demo", "reviewer123"),
         "manager": ("manager@brandguard.demo", "manager123")}


@pytest.fixture(autouse=True)
def _startup():
    with client:
        yield


def hdr(role: str) -> dict:
    email, pw = CREDS[role]
    r = client.post("/auth/login", json={"email": email, "password": pw})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _make_reviewed(text: str = "Guaranteed returns! Act now! $5.00") -> int:
    cid = client.post("/content", headers=hdr("creator"), json={
        "type": "email", "title": "wf", "text": text,
        "channel": "email"}).json()["id"]
    body = client.post(f"/content/{cid}/review?force_mock=true",
                       headers=hdr("creator")).json()
    for f in body["findings"]:
        client.patch(f"/findings/{f['id']}", json={"accepted": 1},
                     headers=hdr("reviewer"))
    return cid


def test_sla_timer_set_on_review():
    cid = _make_reviewed()
    row = client.get(f"/content/{cid}", headers=hdr("manager")).json()
    assert row["sla_due_at"], "review must start the SLA window"
    assert row["status"] == "review"


def test_peer_review_roles_and_states():
    cid = _make_reviewed()
    # creator cannot peer review
    assert client.post(f"/content/{cid}/peer-review", headers=hdr("creator"),
                       json={"action": "approve"}).status_code == 403
    # reviewer approves -> peer_review
    r = client.post(f"/content/{cid}/peer-review", headers=hdr("reviewer"),
                    json={"action": "approve", "note": "reads well"})
    assert r.status_code == 200 and r.json()["status"] == "peer_review"
    # cannot peer-review twice
    assert client.post(f"/content/{cid}/peer-review", headers=hdr("reviewer"),
                       json={"action": "approve"}).status_code == 409
    # manager can approve from peer_review
    assert client.post(f"/content/{cid}/approve",
                       headers=hdr("manager")).status_code == 200


def test_peer_review_reject_sends_back():
    cid = _make_reviewed()
    r = client.post(f"/content/{cid}/peer-review", headers=hdr("reviewer"),
                    json={"action": "reject", "note": "missing disclaimer"})
    assert r.status_code == 200 and r.json()["status"] == "changes"


def test_approval_requires_reviewed_state():
    cid = client.post("/content", headers=hdr("creator"), json={
        "type": "text", "title": "raw", "text": "hi",
        "channel": "web"}).json()["id"]          # still 'draft'
    assert client.post(f"/content/{cid}/approve",
                       headers=hdr("manager")).status_code == 409


def test_comments_thread_and_resolve():
    cid = _make_reviewed()
    top = client.post(f"/content/{cid}/comments", headers=hdr("manager"),
                      json={"body": "Tighten the headline"}).json()
    reply = client.post(f"/content/{cid}/comments", headers=hdr("creator"),
                        json={"body": "Done in v2",
                              "parent_id": top["id"]}).json()
    assert reply["parent_id"] == top["id"]
    listed = client.get(f"/content/{cid}/comments",
                        headers=hdr("creator")).json()
    assert len(listed) == 2
    # resolve is manager-only
    assert client.patch(f"/comments/{top['id']}",
                        headers=hdr("creator"),
                        json={"resolved": True}).status_code == 403
    assert client.patch(f"/comments/{top['id']}", headers=hdr("manager"),
                        json={"resolved": True}).json()["resolved"] == 1
    # bad parent
    assert client.post(f"/content/{cid}/comments", headers=hdr("creator"),
                       json={"body": "x", "parent_id": 999999}
                       ).status_code == 404


def test_versions_and_diff():
    cid = _make_reviewed()
    # edit before approval: snapshot + findings invalidated
    client.post(f"/content/{cid}/request-changes", headers=hdr("manager"))
    client.patch(f"/content/{cid}", headers=hdr("creator"),
                 json={"text": "Rewritten copy with USD 5.00 pricing."})
    row = client.get(f"/content/{cid}", headers=hdr("creator")).json()
    assert row["status"] == "draft" and row["findings"] == []
    versions = client.get(f"/content/{cid}/versions",
                          headers=hdr("creator")).json()
    assert len(versions) >= 2
    d = client.get(f"/content/{cid}/diff?frm={versions[0]['version']}"
                   f"&to={versions[-1]['version']}",
                   headers=hdr("creator")).json()
    assert d["lines"] and (d["added"] + d["removed"]) >= 1


def test_approved_content_locked():
    cid = _make_reviewed()
    client.post(f"/content/{cid}/approve", headers=hdr("manager"))
    assert client.patch(f"/content/{cid}", headers=hdr("creator"),
                        json={"text": "hacked"}).status_code == 403


def test_publish_flow_and_webhook_skip():
    cid = _make_reviewed()
    # cannot publish unapproved
    assert client.post(f"/content/{cid}/publish",
                       headers=hdr("manager")).status_code == 409
    assert client.post(f"/content/{cid}/approve",
                       headers=hdr("manager")).status_code == 200
    # creator cannot publish
    assert client.post(f"/content/{cid}/publish",
                       headers=hdr("creator")).status_code == 403
    r = client.post(f"/content/{cid}/publish", headers=hdr("manager"))
    assert r.status_code == 200
    body = r.json()
    assert body["content"]["status"] == "published"
    assert body["webhook"]["sent"] is False   # webhook_url unset in tests
    assert client.post(f"/content/{cid}/publish", headers=hdr("manager")
                       ).status_code == 409   # published is terminal


def test_audit_chain_verifies_and_detects_tampering():
    _make_reviewed()
    assert client.get("/audit/verify", headers=hdr("manager")
                      ).json()["ok"] is True
    # tamper with a historical row directly in the DB
    conn = sqlite3.connect(settings.database_path)
    orig_actor = conn.execute("SELECT actor FROM audit WHERE id=1").fetchone()[0]
    conn.execute("UPDATE audit SET actor='evil' WHERE id=1")
    conn.commit()
    conn.close()
    bad = client.get("/audit/verify", headers=hdr("manager")).json()
    assert bad["ok"] is False and bad["broken_at"] == 1
    # restore for other tests
    conn = sqlite3.connect(settings.database_path)
    conn.execute("UPDATE audit SET actor=? WHERE id=1", (orig_actor,))
    conn.commit()
    conn.close()
    assert client.get("/audit/verify", headers=hdr("manager")
                      ).json()["ok"] is True
