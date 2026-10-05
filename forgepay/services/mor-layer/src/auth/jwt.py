"""
JWT creation and verification using python-jose.
"""

from __future__ import annotations

from typing import Any

from datetime import UTC, datetime, timedelta

from jose import jwt

from src.config import get_settings


def create_access_token(merchant_id: str, email: str) -> str:
    cfg = get_settings()
    payload = {
        "sub":   merchant_id,
        "email": email,
        "iat":   datetime.now(UTC),
        "exp":   datetime.now(UTC) + timedelta(minutes=cfg.jwt_expire_mins),
    }
    token: str = jwt.encode(payload, cfg.jwt_secret, algorithm=cfg.jwt_algorithm)
    return token


def decode_access_token(token: str) -> dict[str, Any]:
    cfg = get_settings()
    claims: dict[str, Any] = jwt.decode(token, cfg.jwt_secret, algorithms=[cfg.jwt_algorithm])
    return claims
