"""
JWT Bearer token validation for the Liquidity Forecaster service.

Usage in route handlers:
    from src.auth import get_current_merchant

    @router.get("/...")
    async def my_route(merchant_id: str = Depends(get_current_merchant)):
        ...

The token must contain a ``sub`` claim matching the ``merchant_id`` path
parameter.  An ``X-Internal-Secret`` header bypass is available for
service-to-service calls (background poll task, ingest triggers).
"""

from __future__ import annotations

import structlog
from fastapi import Depends, HTTPException, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import ExpiredSignatureError, JWTError, jwt

from src.config import get_settings

log = structlog.get_logger(__name__)

_bearer = HTTPBearer(auto_error=True)


def _decode_token(token: str) -> dict:
    """Decode and validate a JWT, raising HTTP 401 on any failure."""
    cfg = get_settings()
    try:
        payload: dict = jwt.decode(
            token,
            cfg.jwt_secret,
            algorithms=[cfg.jwt_algorithm],
        )
        return payload
    except ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except JWTError as exc:
        log.warning("jwt_validation_failed", error=str(exc))
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
            headers={"WWW-Authenticate": "Bearer"},
        )


async def get_current_merchant(
    credentials: HTTPAuthorizationCredentials = Security(_bearer),
) -> str:
    """
    FastAPI dependency that returns the ``merchant_id`` (``sub`` claim) from
    the Bearer token.  Raises HTTP 401 if the token is missing or invalid.
    """
    payload = _decode_token(credentials.credentials)
    merchant_id: str | None = payload.get("sub")
    if not merchant_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token is missing 'sub' claim",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return merchant_id


def verify_merchant_access(token_merchant_id: str, path_merchant_id: str) -> None:
    """
    Confirm the authenticated merchant may access resources for
    ``path_merchant_id``.  Currently enforces strict equality; extend for
    admin/multi-tenant roles as needed.
    """
    if token_merchant_id != path_merchant_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: merchant_id mismatch",
        )
