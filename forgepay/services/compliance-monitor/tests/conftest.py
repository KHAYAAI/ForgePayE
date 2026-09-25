"""
Pytest fixtures shared across compliance-monitor tests.

Persistence tests run against sqlite (via aiosqlite) rather than a real
Postgres instance -- acceptable per this service's own test-suite convention
because the ORM models (src/db/models.py) are written to be Postgres/sqlite
portable (generic JSON columns, no JSONB). The production path is always
Postgres/asyncpg -- see src/db/session.py and src/config.py's
DATABASE_URL fail-closed check for production.

Each test that needs a database gets its own temp-file sqlite database (not
":memory:", which does not survive across separate connections/engines) via
the `db_url` fixture, so a test can construct a *second*, independent
manager instance pointed at the same file to prove data survives a manager
restart -- the property that was missing when everything lived in a
process-local dict.
"""

from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from src.db.models import Base


@pytest.fixture
def db_url(tmp_path) -> str:
    db_file = tmp_path / "compliance_monitor_test.db"
    return f"sqlite+aiosqlite:///{db_file}"


@pytest.fixture
async def session_factory(db_url: str):
    """
    A fresh sqlite-backed async_sessionmaker with the full schema created.

    Yields the factory (not the engine) since that is what every manager
    constructor (SarManager, KycManager, TransactionMonitoringEngine) takes.
    Disposes the engine on teardown -- each test function gets its own
    asyncio event loop, and a pooled connection opened in one loop errors if
    reused from another (see src/db/session.py::dispose_engine's docstring).
    """
    engine = create_async_engine(db_url)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    factory = async_sessionmaker(bind=engine, expire_on_commit=False)
    yield factory
    await engine.dispose()


@pytest.fixture
async def make_session_factory(db_url: str):
    """
    A factory-of-factories: call this to build additional independent
    async_sessionmaker instances against the *same* db_url (same sqlite
    file), without recreating the schema. Used by persistence tests that
    construct a fresh manager "as if the process restarted" and assert the
    data is still there.
    """
    engines = []

    def _make() -> async_sessionmaker:
        engine = create_async_engine(db_url)
        engines.append(engine)
        return async_sessionmaker(bind=engine, expire_on_commit=False)

    yield _make

    for engine in engines:
        await engine.dispose()
