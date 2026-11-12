"""Full JWT auth: bcrypt passwords, HS256 access tokens, rotating refresh
with server-side revocation, and role-based route guards.

Roles are ordered: creator < reviewer < manager < admin. A higher role
satisfies any lower-role requirement."""
import secrets
import time
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Depends, HTTPException, Request

from . import db
from .settings import settings

ROLE_ORDER = {"creator": 0, "reviewer": 1, "manager": 2, "admin": 3}


# --- passwords -------------------------------------------------------------
def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()


def verify_password(pw: str, h: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), h.encode())
    except Exception:
        return False


# --- tokens ----------------------------------------------------------------
def _now() -> datetime:
    return datetime.now(timezone.utc)


def create_access(user: dict) -> str:
    return jwt.encode(
        {"sub": str(user["id"]), "email": user["email"],
         "role": user["role"], "team": user["team"], "type": "access",
         "iat": int(time.time()),
         "exp": int(time.time()) + settings.access_ttl_min * 60},
        settings.secret, algorithm=settings.jwt_algorithm)


def create_refresh(user: dict) -> tuple[str, str]:
    jti = secrets.token_urlsafe(24)
    exp = _now() + timedelta(days=settings.refresh_ttl_days)
    token = jwt.encode(
        {"sub": str(user["id"]), "jti": jti, "type": "refresh",
         "iat": int(time.time()), "exp": int(exp.timestamp())},
        settings.secret, algorithm=settings.jwt_algorithm)
    with db.get() as conn:
        conn.execute(
            "INSERT INTO refresh_token (jti, user_id, expires_at) "
            "VALUES (?,?,?)", (jti, user["id"], exp.isoformat()))
        conn.commit()
    return token, jti


def revoke(jti: str) -> None:
    with db.get() as conn:
        conn.execute("UPDATE refresh_token SET revoked=1 WHERE jti=?",
                     (jti,))
        conn.commit()


# --- dependencies ----------------------------------------------------------
def _decode(token: str, expected_type: str) -> dict:
    try:
        claims = jwt.decode(token, settings.secret,
                            algorithms=[settings.jwt_algorithm])
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Invalid token")
    if claims.get("type") != expected_type:
        raise HTTPException(401, f"Wrong token type (expected {expected_type})")
    return claims


def current_user(request: Request) -> dict:
    """Auth dependency: validates Bearer access token -> claims dict."""
    header = request.headers.get("Authorization", "")
    if not header.lower().startswith("bearer "):
        raise HTTPException(401, "Missing bearer token")
    claims = _decode(header[7:].strip(), "access")
    with db.get() as conn:
        user = db.one(conn, "SELECT id, email, role, team, active "
                            "FROM users WHERE id=?", (int(claims["sub"]),))
    if not user or not user["active"]:
        raise HTTPException(401, "User disabled or deleted")
    return user


def require_role(minimum: str):
    """Role guard factory: Depends(require_role('manager'))."""
    need = ROLE_ORDER[minimum]

    def guard(user: dict = Depends(current_user)) -> dict:
        have = ROLE_ORDER.get(user["role"], -1)
        if have < need:
            raise HTTPException(
                403, f"Role '{user['role']}' insufficient — "
                     f"'{minimum}' or higher required")
        return user

    return guard


def decode_refresh(token: str) -> dict:
    claims = _decode(token, "refresh")
    jti = claims.get("jti", "")
    with db.get() as conn:
        row = db.one(conn, "SELECT user_id, revoked, expires_at FROM refresh_token "
                           "WHERE jti=?", (jti,))
        if not row:
            raise HTTPException(401, "Refresh token revoked or unknown")
        if row["revoked"]:
            # Token reuse detection: revoked token presented -> revoke all tokens for this user
            conn.execute("UPDATE refresh_token SET revoked=1 WHERE user_id=?",
                         (row["user_id"],))
            db.log_audit(conn, None, f"user:{row['user_id']}", "token_reuse_detected",
                         f"revoked token {jti[:8]} reused — invalidating all sessions")
            conn.commit()
            raise HTTPException(401, "Refresh token revoked or unknown")
        if datetime.fromisoformat(row["expires_at"]).replace(
                tzinfo=timezone.utc) < _now():
            raise HTTPException(401, "Refresh token expired")
    return claims
