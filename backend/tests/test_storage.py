"""Supabase Storage mirror: off by default, and the REST calls are correct.

The storage keys are absent in tests and in dev, so the app must behave
exactly like it did before (local filesystem only).
"""
import httpx

from app import storage
from app.settings import settings


def test_disabled_without_keys():
    settings.supabase_url = ""
    settings.supabase_service_key = ""
    assert storage.enabled() is False
    assert storage.push("x.png", b"x") is False
    assert storage.fetch("x.png") is None


def test_push_and_fetch_use_the_bucket(monkeypatch):
    settings.supabase_url = "https://demo.supabase.co"
    settings.supabase_service_key = "svc-key"
    settings.supabase_bucket = "uploads"
    assert storage.enabled() is True
    assert storage.public_url("a.png") == (
        "https://demo.supabase.co/storage/v1/object/public/uploads/a.png")

    calls = {}

    def fake_post(url, **kw):
        calls["post"] = (url, kw)
        return httpx.Response(200, json={"Key": "a.png"})

    def fake_get(url, **kw):
        calls["get"] = (url, kw)
        return httpx.Response(200, content=b"bytes")

    monkeypatch.setattr(storage.httpx, "post", fake_post)
    monkeypatch.setattr(storage.httpx, "get", fake_get)

    assert storage.push("a.png", b"bytes", "image/png") is True
    assert calls["post"][0] == (
        "https://demo.supabase.co/storage/v1/object/uploads/a.png")
    assert calls["post"][1]["headers"]["Authorization"] == "Bearer svc-key"

    assert storage.fetch("a.png") == b"bytes"
    assert calls["get"][0] == (
        "https://demo.supabase.co/storage/v1/object/uploads/a.png")
