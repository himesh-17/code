"""Tests run against an isolated temp DB — never the demo database."""
import tempfile
from pathlib import Path

from app.settings import settings

_tmp = Path(tempfile.mkdtemp(prefix="bgtest_"))
settings.database_path = str(_tmp / "test.db")
settings.database_url = ""          # tests always use the temp SQLite file
settings.upload_dir = str(_tmp / "uploads")
settings.llm_provider = "mock"   # tests never spend API tokens
settings.gemini_api_key = ""     # ...nor vision tokens (test_vision re-keys)
settings.review_rate_per_min = 10_000  # suite runs many reviews; limiter
                                      # has its own test (sets 3 explicitly)
settings.auth_rate_per_min = 10_000    # suite logs in for every request
