"""
Async SQLAlchemy engine and session factory.

Mirrors mor-layer/src/db/session.py's pattern exactly (same singleton +
dispose_engine() shape), adapted to this service's src.config.Settings.
"""

from __future__ import annotations

from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from src.config import get_settings

_engine = None
_session_factory = None


def get_engine():
    global _engine
    if _engine is None:
        settings = get_settings()
        kwargs: dict = {
            "pool_pre_ping": True,
            "echo": settings.log_level.upper() == "DEBUG",
        }
        # sqlite (used by the test suite -- see tests/conftest.py) doesn't
        # take pool_size/max_overflow the way a real Postgres pool does.
        if not settings.database_url.startswith("sqlite"):
            kwargs["pool_size"] = 10
            kwargs["max_overflow"] = 20
        _engine = create_async_engine(settings.database_url, **kwargs)
    return _engine


def get_session_factory() -> async_sessionmaker[AsyncSession]:
    global _session_factory
    if _session_factory is None:
        _session_factory = async_sessionmaker(
            bind=get_engine(),
            class_=AsyncSession,
            expire_on_commit=False,
        )
    return _session_factory


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    factory = get_session_factory()
    async with factory() as session:
        yield session


async def dispose_engine() -> None:
    """
    Dispose the cached engine and drop the module-level singletons so the
    next get_engine()/get_session_factory() call builds a fresh one.

    Same rationale as mor-layer's dispose_engine(): get_engine() caches a
    single engine for the life of the process, which is right for a running
    service but wrong for a test suite where each test function gets its own
    asyncio event loop -- a pooled connection opened during test A raises
    "Event loop is closed" when test B (a new loop) tries to check it back
    in. Call this from an autouse test fixture after each test.
    """
    global _engine, _session_factory
    if _engine is not None:
        await _engine.dispose()
    _engine = None
    _session_factory = None
