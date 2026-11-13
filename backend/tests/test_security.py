"""Security guards added in hardening Batch 2: scoping, locks, deprovisioning."""
import io
import sqlite3

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.settings import settings

client = TestClient(app)

CREDS = {
    "creator": ("creator@brandguard.demo", "creator123"),
    "reviewer": ("reviewer@brandguard.demo", "reviewer123"),
    "manager": ("manager@brandguard.demo", "manager123"),
    "admin": ("admin@brandguard.demo", "admin12345"),
}
_cache: dict[str, str] = {}


@pytest.fixture(autouse=True)
def _startup():
    with client:
        yield


def hdr(role: str) -> dict:
    if role not in _cache:
        email, pw = CREDS[role]
        r = client.post("/auth/login", json={"email": email, "password": pw})
        assert r.status_code == 200, r.text
        _cache[role] = r.json()["access_token"]
    return {"Authorization": f"Bearer {_cache[role]}"}


def _create(text: str = "clean copy") -> int:
    r = client.post("/content", headers=hdr("manager"), json={
        "type": "text", "title": "scoping", "text": text})
    assert r.status_code == 201, r.text
    return r.json()["id"]


def test_creator_cannot_read_other_team_content():
    cid = _create()                      # manager -> team "brand"
    assert client.get(f"/content/{cid}", headers=hdr("creator")).status_code == 403
    assert client.get(f"/content/{cid}", headers=hdr("reviewer")).status_code == 200


def test_creator_list_excludes_other_teams():
    cid = _create()
    ids = [c["id"] for c in client.get("/content", headers=hdr("creator")).json()]
    assert cid not in ids
    assert cid in [c["id"] for c in client.get("/content", headers=hdr("reviewer")).json()]


def test_upload_rejected_on_locked_content():
    cid = _create()
    conn = sqlite3.connect(settings.database_path)
    conn.execute("UPDATE content SET status='approved' WHERE id=?", (cid,))
    conn.commit()
    conn.close()
    png = io.BytesIO()
    from PIL import Image
    Image.new("RGB", (2, 2), "white").save(png, format="PNG")
    png.seek(0)
    # upload as the creator of this row (manager → team "brand"), so the
    # scope check passes and the LOCKED guard is what rejects it
    r = client.post(f"/content/{cid}/upload", headers=hdr("manager"),
                    files={"file": ("x.png", png, "image/png")})
    assert r.status_code == 409, r.text


def test_admin_can_delete_user_with_sessions():
    email = "temp-delete@brandguard.demo"
    r = client.post("/auth/users", headers=hdr("admin"), json={
        "email": email, "password": "temp-pass-123", "role": "creator"})
    assert r.status_code == 201, r.text
    uid = r.json()["id"]
    # give the account a refresh token so the FK is exercised
    assert client.post("/auth/login", json={
        "email": email, "password": "temp-pass-123"}).status_code == 200
    assert client.delete(f"/auth/users/{uid}", headers=hdr("admin")).status_code == 204
    assert client.post("/auth/login", json={
        "email": email, "password": "temp-pass-123"}).status_code == 401


def test_audit_limit_is_bounded():
    assert client.get("/audit?limit=-1", headers=hdr("manager")).status_code == 422
    assert client.get("/audit?limit=99999", headers=hdr("manager")).status_code == 422
