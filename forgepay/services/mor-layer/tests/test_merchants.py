"""
End-to-end coverage for the real register -> login -> self-profile flow:
POST /v1/merchants, POST /v1/auth/token, GET /v1/merchants/me.

GET /v1/merchants/me didn't exist before this file — the JWT issued by
/auth/token only carries `sub` (merchant id) and `email`, so a caller (e.g.
a dashboard login flow) needs this roundtrip to get the merchant's name and
Hyperswitch api_key without a second credential.
"""

import uuid

import pytest
from httpx import AsyncClient


def unique_email() -> str:
    return f"merchant-{uuid.uuid4().hex[:12]}@example.com"


@pytest.mark.asyncio
async def test_register_then_login_then_me(client: AsyncClient):
    email = unique_email()
    reg = await client.post(
        "/v1/merchants",
        json={"name": "Acme Robotics", "email": email, "password": "correct-horse-battery"},
    )
    assert reg.status_code == 201
    registered = reg.json()
    assert registered["email"] == email
    assert registered["api_key"].startswith("sk_live_")

    login = await client.post(
        "/v1/auth/token",
        data={"username": email, "password": "correct-horse-battery"},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    assert login.status_code == 200
    token = login.json()["access_token"]
    assert login.json()["token_type"] == "bearer"

    me = await client.get("/v1/merchants/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200
    profile = me.json()
    assert profile["id"] == registered["id"]
    assert profile["email"] == email
    assert profile["name"] == "Acme Robotics"
    assert profile["api_key"] == registered["api_key"]


@pytest.mark.asyncio
async def test_register_duplicate_email_rejected(client: AsyncClient):
    email = unique_email()
    first = await client.post(
        "/v1/merchants", json={"name": "First Co", "email": email, "password": "correct-horse-battery"},
    )
    assert first.status_code == 201

    second = await client.post(
        "/v1/merchants", json={"name": "Second Co", "email": email, "password": "another-password"},
    )
    assert second.status_code == 409


@pytest.mark.asyncio
async def test_login_wrong_password_rejected(client: AsyncClient):
    email = unique_email()
    await client.post(
        "/v1/merchants", json={"name": "Acme", "email": email, "password": "correct-horse-battery"},
    )

    login = await client.post(
        "/v1/auth/token",
        data={"username": email, "password": "wrong-password"},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    assert login.status_code == 401


@pytest.mark.asyncio
async def test_login_unknown_email_rejected(client: AsyncClient):
    login = await client.post(
        "/v1/auth/token",
        data={"username": unique_email(), "password": "whatever"},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    assert login.status_code == 401


@pytest.mark.asyncio
async def test_me_rejects_unauthenticated(client: AsyncClient):
    resp = await client.get("/v1/merchants/me")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_me_returns_the_authenticated_callers_own_profile(client: AsyncClient, merchant: dict):
    resp = await client.get("/v1/merchants/me", headers=merchant["headers"])
    assert resp.status_code == 200
    assert resp.json()["id"] == merchant["id"]
