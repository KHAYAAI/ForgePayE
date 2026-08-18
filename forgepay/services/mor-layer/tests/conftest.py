"""
Pytest fixtures shared across all MoR layer tests.

Uses httpx.AsyncClient for async FastAPI testing (no real HTTP calls).
Hyperswitch is mocked via respx (httpx-compatible mock library).
"""

import uuid

import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport

from src.api.checkout import dispose_redis
from src.auth.jwt import create_access_token
from src.db.models import Merchant
from src.db.session import dispose_engine, get_session_factory
from src.main import app
from src.config import get_settings, Settings

# These test merchants authenticate via JWT bearer token (create_access_token
# below), never via password login — password_hash is only NOT NULL on the
# Merchant model, its actual value is never checked by anything these tests
# exercise. A fixed placeholder avoids paying for a real bcrypt hash (slow by
# design) on every fixture use, and sidesteps unrelated passlib/bcrypt
# backend-detection breakage across dependency versions.
_DUMMY_PASSWORD_HASH = "$2b$12$00000000000000000000000000000000000000000000000000"


@pytest.fixture(scope="session")
def test_settings() -> Settings:
    return Settings(
        environment="test",
        hyperswitch_base_url="http://hyperswitch-test.local",
        hyperswitch_api_key="test_api_key",
        hyperswitch_publishable_key="test_pub_key",
        hyperswitch_webhook_secret="test_webhook_secret",
        unified_router_url="http://unified-router-test.local",
        internal_webhook_secret="test_internal_secret",
        database_url="postgresql+asyncpg://test:test@localhost/test",
        redis_url="redis://localhost:6379/15",
        jwt_secret="test_jwt_secret",
        tax_provider="internal",
    )


@pytest.fixture(autouse=True)
def override_settings(test_settings: Settings):
    app.dependency_overrides[get_settings] = lambda: test_settings
    yield
    app.dependency_overrides.clear()


@pytest_asyncio.fixture(autouse=True)
async def reset_db_engine():
    """
    Every DB-touching test gets its own asyncio event loop (pytest-asyncio's
    default function-scoped loop), but get_engine()/get_session_factory()
    cache a single engine for the process. A connection opened in test A's
    loop raises "Event loop is closed" when test B (a fresh loop) tries to
    return it to the pool. Dispose after every test so the next one starts
    with a clean engine bound to its own loop. See dispose_engine()'s
    docstring in src/db/session.py.
    """
    yield
    await dispose_engine()
    await dispose_redis()


@pytest_asyncio.fixture
async def client() -> AsyncClient:
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as c:
        yield c


@pytest_asyncio.fixture
async def merchant() -> dict:
    """
    A real, persisted Merchant row plus a valid Bearer token for it.

    A real row (not just a JWT + an auth-dependency override) is required:
    checkout_sessions.merchant_id is a real foreign key, so creating a
    checkout session for a merchant that only "exists" in an auth mock still
    fails at the INSERT with a ForeignKeyViolationError. Inserting directly
    via the DB session rather than going through POST /v1/merchants +
    /v1/auth/token also keeps tests clear of those endpoints' strict
    per-IP rate limits (5/min and 10/min respectively).

    Requires Postgres reachable at MOR_DATABASE_URL (or its default,
    forgepay/devpassword@localhost:5432/forgepay_dev) with this service's
    schema already migrated — matching what forgepay-ci.yml's mor-layer job
    already assumes by setting MOR_DATABASE_URL for the pytest step.

    Returns {"id": ..., "email": ..., "headers": {"Authorization": "Bearer ..."}}.
    """
    merchant_id = str(uuid.uuid4())
    email = f"{merchant_id}@example.test"

    factory = get_session_factory()
    async with factory() as session:
        session.add(
            Merchant(
                id=merchant_id,
                email=email,
                name="Test Merchant",
                password_hash=_DUMMY_PASSWORD_HASH,
                api_key=f"sk_live_{uuid.uuid4().hex}",
            )
        )
        await session.commit()

    token = create_access_token(merchant_id, email)
    return {
        "id": merchant_id,
        "email": email,
        "headers": {"Authorization": f"Bearer {token}"},
    }
