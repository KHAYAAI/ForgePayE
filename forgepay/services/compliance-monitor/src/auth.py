"""
Dual authentication: JWT Bearer token  OR  API Key header.

JWT tokens are signed with HS256 using the JWT_SECRET env var.
API keys are validated against a simple in-memory registry (prod: pull from Redis/DB).

Usage in route handlers:

    from src.auth import require_auth

    @router.get("/some-endpoint")
    async def handler(caller: dict = Depends(require_auth)):
        ...
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
from typing import Any

import structlog
from fastapi import Depends, Header, HTTPException, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt

from src.config import get_settings

logger = structlog.get_logger(__name__)
settings = get_settings()

# ---------------------------------------------------------------------------
# Bearer token extractor — optional so we can try API key fallback
# ---------------------------------------------------------------------------
_bearer_scheme = HTTPBearer(auto_error=False)


# ---------------------------------------------------------------------------
# In-memory API key store (hashed).
# Production: populate from Redis or database at startup.
# Format: sha256(raw_key) → {"merchant_id": ..., "scopes": [...]}
# ---------------------------------------------------------------------------
_API_KEY_STORE: dict[str, dict[str, Any]] = {}


def register_api_key(raw_key: str, merchant_id: str, scopes: list[str] | None = None) -> None:
    """Register an API key (called at startup or when a key is provisioned)."""
    key_hash = hashlib.sha256(raw_key.encode()).hexdigest()
    _API_KEY_STORE[key_hash] = {"merchant_id": merchant_id, "scopes": scopes or ["*"]}


def generate_api_key(merchant_id: str, scopes: list[str] | None = None) -> str:
    """Generate a random API key, register it, and return the raw value."""
    raw = secrets.token_urlsafe(32)
    register_api_key(raw, merchant_id, scopes)
    return raw


# ---------------------------------------------------------------------------
# JWT helpers
# ---------------------------------------------------------------------------

_JWT_ALGORITHM = "HS256"
_JWT_EXPIRY_SECONDS = 3600


def create_access_token(payload: dict[str, Any], expires_in: int = _JWT_EXPIRY_SECONDS) -> str:
    import time

    data = {**payload, "exp": int(time.time()) + expires_in}
    return jwt.encode(data, settings.jwt_secret, algorithm=_JWT_ALGORITHM)


def decode_access_token(token: str) -> dict[str, Any]:
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=[_JWT_ALGORITHM])
    except JWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid or expired JWT: {exc}",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc


# ---------------------------------------------------------------------------
# FastAPI dependency
# ---------------------------------------------------------------------------

async def require_auth(
    credentials: HTTPAuthorizationCredentials | None = Security(_bearer_scheme),
    x_compliance_api_key: str | None = Header(default=None, alias="X-Compliance-API-Key"),
) -> dict[str, Any]:
    """
    Returns the caller context dict.  Raises 401 if neither JWT nor API key is valid.

    Caller context keys:
        merchant_id: str
        auth_method: "jwt" | "api_key"
        scopes: list[str]
    """
    # 1. Try JWT Bearer
    if credentials is not None and credentials.scheme.lower() == "bearer":
        payload = decode_access_token(credentials.credentials)
        return {
            "merchant_id": payload.get("sub", ""),
            "auth_method": "jwt",
            "scopes": payload.get("scopes", ["*"]),
        }

    # 2. Try API key header
    if x_compliance_api_key:
        key_hash = hashlib.sha256(x_compliance_api_key.encode()).hexdigest()
        record = _API_KEY_STORE.get(key_hash)
        if record:
            return {
                "merchant_id": record["merchant_id"],
                "auth_method": "api_key",
                "scopes": record["scopes"],
            }

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Authentication required: provide Bearer JWT or X-Compliance-API-Key header",
        headers={"WWW-Authenticate": "Bearer"},
    )


async def require_internal(
    x_internal_secret: str | None = Header(default=None, alias="X-Internal-Secret"),
) -> None:
    """
    Dependency for internal cluster-only endpoints.
    Validates a shared secret passed as a header (stored in Vault / K8s secret).
    """
    expected = settings.internal_service_secret
    if not expected:
        # If no secret configured, reject all internal-only requests in production
        if settings.environment == "production":
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not configured")
        return  # dev/test: allow through

    if not x_internal_secret or not hmac.compare_digest(expected, x_internal_secret):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid internal secret")
