"""
JWT creation and verification using python-jose.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from jose import JWTError, jwt

from src.config import get_settings


def create_access_token(merchant_id: str, email: str) -> str:
    cfg = get_settings()
    payload = {
        "sub":   merchant_id,
        "email": email,
        "iat":   datetime.now(UTC),
        "exp":   datetime.now(UTC) + timedelta(minutes=cfg.jwt_expire_mins),
    }
    return jwt.encode(payload, cfg.jwt_secret, algorithm=cfg.jwt_algorithm)


def decode_access_token(token: str) -> dict:
    cfg = get_settings()
    return jwt.decode(token, cfg.jwt_secret, algorithms=[cfg.jwt_algorithm])
