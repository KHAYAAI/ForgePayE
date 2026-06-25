"""
Merchant registration and authentication endpoints.
"""

from __future__ import annotations

import secrets
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from passlib.context import CryptContext
from pydantic import BaseModel, EmailStr
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.auth.jwt import create_access_token
from src.db.models import Merchant
from src.db.session import get_db
from src.rate_limiting import check_rate_limit

router = APIRouter(prefix="/merchants", tags=["merchants"])
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# Separate router for auth token endpoint (standard OAuth2 path)
auth_router = APIRouter(prefix="/auth", tags=["auth"])


class MerchantCreate(BaseModel):
    name:     str
    email:    EmailStr
    password: str


class MerchantResponse(BaseModel):
    id:      str
    email:   str
    name:    str
    api_key: str


class TokenResponse(BaseModel):
    access_token: str
    token_type:   str = "bearer"


@router.post("", response_model=MerchantResponse, status_code=201)
async def register_merchant(
    body: MerchantCreate,
    db:   Annotated[AsyncSession, Depends(get_db)],
    request: Request,
) -> MerchantResponse:
    # Rate limit: 5 registrations per minute per IP (strict on registration)
    check_rate_limit(request, "5/minute")

    if len(body.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")

    # Check for duplicate email
    existing = await db.execute(select(Merchant).where(Merchant.email == body.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Email already registered")

    merchant = Merchant(
        id=str(uuid.uuid4()),
        email=body.email,
        name=body.name,
        password_hash=pwd_context.hash(body.password),
        api_key=f"sk_live_{secrets.token_hex(24)}",
    )
    db.add(merchant)
    await db.commit()
    await db.refresh(merchant)

    return MerchantResponse(
        id=merchant.id,
        email=merchant.email,
        name=merchant.name,
        api_key=merchant.api_key,
    )


@auth_router.post("/token", response_model=TokenResponse)
async def login(
    form: Annotated[OAuth2PasswordRequestForm, Depends()],
    db:   Annotated[AsyncSession, Depends(get_db)],
    request: Request,
) -> TokenResponse:
    # Rate limit: 10 login attempts per minute per IP (strict on auth)
    check_rate_limit(request, "10/minute")

    result = await db.execute(select(Merchant).where(Merchant.email == form.username))
    merchant = result.scalar_one_or_none()

    if not merchant or not pwd_context.verify(form.password, merchant.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = create_access_token(merchant.id, merchant.email)
    return TokenResponse(access_token=token)
