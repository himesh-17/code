"""Startup config visibility: prod misconfiguration is loud, not silent.

STRICT_CONFIG=1 upgrades the warnings to a hard startup failure once the
deploy environment has been confirmed correct.
"""
import pytest

from app.settings import Settings


def test_local_dev_needs_no_secret():
    s = Settings(database_url="", jwt_secret="")
    s.validate()  # no prod markers -> dev fallback is fine, no raise


def test_postgres_without_jwt_secret_is_logged_and_strict_raises(monkeypatch, caplog):
    monkeypatch.delenv("STRICT_CONFIG", raising=False)
    s = Settings(database_url="postgres://example", jwt_secret="")
    with caplog.at_level("CRITICAL", logger="brandguard.config"):
        s.validate()
    assert "JWT_SECRET" in caplog.text

    monkeypatch.setenv("STRICT_CONFIG", "1")
    with pytest.raises(RuntimeError, match="JWT_SECRET"):
        s.validate()


def test_render_without_database_url_is_logged_and_strict_raises(monkeypatch, caplog):
    monkeypatch.setenv("RENDER", "true")
    monkeypatch.delenv("STRICT_CONFIG", raising=False)
    s = Settings(database_url="", jwt_secret="x")
    with caplog.at_level("CRITICAL", logger="brandguard.config"):
        s.validate()
    assert "DATABASE_URL" in caplog.text

    monkeypatch.setenv("STRICT_CONFIG", "1")
    with pytest.raises(RuntimeError, match="DATABASE_URL"):
        s.validate()


def test_seed_demo_can_be_disabled(monkeypatch):
    monkeypatch.setenv("SEED_DEMO", "0")
    assert Settings().seed_demo is False
