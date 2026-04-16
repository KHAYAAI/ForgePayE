"""
Pytest fixtures shared across all MoR layer tests.

Uses httpx.AsyncClient for async FastAPI testing (no real HTTP calls).
Hyperswitch is mocked via respx (httpx-compatible mock library).
"""

import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport

from src.main import app
from src.config import get_settings, Settings


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


@pytest_asyncio.fixture
async def client() -> AsyncClient:
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://testserver",
    ) as c:
        yield c
