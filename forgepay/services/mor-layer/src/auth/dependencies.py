"""
FastAPI dependency for extracting and validating the current merchant from a JWT.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from src.db.models import Merchant
from src.db.session import get_db
from .jwt import decode_access_token

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/v1/auth/token")
oauth2_optional = OAuth2PasswordBearer(tokenUrl="/v1/auth/token", auto_error=False)


async def get_current_merchant(
    token: Annotated[str, Depends(oauth2_scheme)],
    db:    Annotated[AsyncSession, Depends(get_db)],
) -> Merchant:
    credentials_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired token",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = decode_access_token(token)
        merchant_id: str | None = payload.get("sub")
        if not merchant_id:
            raise credentials_exc
    except JWTError:
        raise credentials_exc

    result = await db.execute(select(Merchant).where(Merchant.id == merchant_id))
    merchant = result.scalar_one_or_none()
    if merchant is None:
        raise credentials_exc
    return merchant


async def optional_merchant(
    token: Annotated[str | None, Depends(oauth2_optional)],
    db:    Annotated[AsyncSession, Depends(get_db)],
) -> Merchant | None:
    if not token:
        return None
    try:
        return await get_current_merchant(token, db)
    except HTTPException:
        return None
