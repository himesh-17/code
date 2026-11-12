"""All runtime config from environment — nothing hardcoded, deploy-safe.

Root .env is loaded explicitly so the app works whether it is started from
the repo root or from backend/ (uvicorn app.main:app). Real env vars set by
the host always win (override=False)."""
import logging
import os
from pathlib import Path
from dotenv import load_dotenv
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parents[2]

load_dotenv(BASE_DIR / ".env", override=False)
load_dotenv(Path(__file__).resolve().parent / ".env", override=False)

log = logging.getLogger("brandguard.config")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(extra="ignore")

    # runtime
    host: str = "0.0.0.0"
    port: int = 8001
    database_path: str = str(BASE_DIR / "data" / "brandguard.db")
    database_url: str = ""              # postgres://… (Supabase) overrides path
    upload_dir: str = str(BASE_DIR / "data" / "uploads")
    cors_origins: str = "http://localhost:5173,http://localhost:3000"
    review_rate_per_min: int = 10
    auth_rate_per_min: int = 60
    max_upload_bytes: int = 5 * 1024 * 1024
    max_content_chars: int = 20_000
    # demo accounts/guidelines on boot — set SEED_DEMO=0 for a clean prod DB
    seed_demo: bool = True
    # total wall-clock budget for one review (LLM + vision + citations)
    review_budget_sec: float = 60.0

    # llm
    llm_provider: str = "mock"          # groq | openai | mock
    groq_api_key: str = ""
    groq_model: str = "openai/gpt-oss-120b"
    openai_api_key: str = ""
    openai_model: str = "gpt-4o"
    llm_timeout: float = 30.0

    # vision (Gemini REST; comma-separated failover chain — flash tiers
    # intermittently 503 under demand, lite absorbs the overflow)
    gemini_api_key: str = ""
    gemini_vision_models: str = "gemini-3.8-flash,gemini-flash-lite-latest"
    vision_timeout: float = 30.0

    # embedding (Gemini → local fallback; 256‑dim portable vectors)
    embed_model: str = "gemini-embedding-001"
    embed_dim: int = 256

    # auth (full JWT: access + rotating refresh)
    jwt_secret: str = ""                # required in prod; dev fallback below
    jwt_algorithm: str = "HS256"
    access_ttl_min: int = 60
    refresh_ttl_days: int = 7

    # workflow
    sla_hours: int = 24                 # review due window

    # integration
    webhook_url: str = ""               # publish webhook target ("" = skip)
    webhook_secret: str = ""            # HMAC-SHA256 signing secret
    slack_webhook_url: str = ""         # Slack incoming webhook URL ("" = skip)
    # inbound webhook can trigger approve/publish without a human in the loop
    # (CI/CD). Set INBOUND_ALLOW_AUTOPUBLISH=0 to require an operator for those
    # actions; the read-only "review" action stays allowed.
    inbound_allow_autopublish: bool = True

    @property
    def origins(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def secret(self) -> str:
        # dev-only fallback; prod must set JWT_SECRET
        return self.jwt_secret or "brandguard-dev-secret-do-not-use-in-prod"

    def validate(self) -> None:
        """Surface prod misconfiguration loudly (logs + /health).

        STRICT_CONFIG=1 turns these into a hard startup failure once the
        deploy environment is confirmed correct — a self-inflicted outage is
        worse than a loud warning right before a demo.
        """
        problems = []
        if not self.database_url and os.getenv("RENDER"):
            problems.append("DATABASE_URL is not set — ephemeral SQLite; "
                            "data resets on every deploy")
        if not self.jwt_secret and (self.database_url or os.getenv("RENDER")):
            problems.append("JWT_SECRET is not set — the public dev fallback "
                            "key is signing tokens")
        for p in problems:
            log.critical("CONFIG: %s", p)
        if problems and os.getenv("STRICT_CONFIG") == "1":
            raise RuntimeError("; ".join(problems))


settings = Settings()
