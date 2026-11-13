"""Optional Supabase Storage mirror for uploaded creatives.

Render's free tier has an ephemeral filesystem: uploaded images are lost on
every redeploy or spin-down. With SUPABASE_URL + SUPABASE_SERVICE_KEY set we
push a copy to Supabase Storage (free tier: 1 GB) and pull it back when the
local copy is gone. Plain REST — no extra dependency, and the app behaves
exactly as before when the storage keys are absent.
"""
import logging

import httpx

from .settings import settings

log = logging.getLogger("brandguard.storage")


def enabled() -> bool:
    return bool(settings.supabase_url and settings.supabase_service_key)


def _base() -> str:
    base = settings.supabase_url.rstrip("/")
    # Render/Supabase users paste either the project URL or the REST URL;
    # Storage always lives at /storage/v1, so drop a trailing /rest/v1.
    if base.endswith("/rest/v1"):
        base = base[: -len("/rest/v1")]
    return base


def _object_url(name: str) -> str:
    return f"{_base()}/storage/v1/object/{settings.supabase_bucket}/{name}"


def public_url(name: str) -> str:
    """Browser-reachable URL — needs a public bucket."""
    return f"{_base()}/storage/v1/object/public/{settings.supabase_bucket}/{name}"


def push(name: str, data: bytes, content_type: str = "image/png") -> bool:
    """Mirror the file into the bucket. False when disabled or failed."""
    if not enabled():
        return False
    try:
        r = httpx.post(
            _object_url(name),
            content=data,
            headers={
                "Authorization": f"Bearer {settings.supabase_service_key}",
                "apikey": settings.supabase_service_key,
                "Content-Type": content_type,
                "x-upsert": "true",
            },
            timeout=20.0,
        )
        if r.status_code >= 300:
            log.warning("storage push %s failed: %s %s",
                        name, r.status_code, r.text[:120])
            return False
        return True
    except Exception as exc:                      # network hiccup → keep local
        log.warning("storage push %s failed: %s", name, exc)
        return False


def fetch(name: str) -> bytes | None:
    """Read the object back — works for private buckets too."""
    if not enabled():
        return None
    try:
        r = httpx.get(
            _object_url(name),
            headers={
                "Authorization": f"Bearer {settings.supabase_service_key}",
                "apikey": settings.supabase_service_key,
            },
            timeout=20.0,
        )
        return r.content if r.status_code == 200 else None
    except Exception as exc:
        log.warning("storage fetch %s failed: %s", name, exc)
        return None
