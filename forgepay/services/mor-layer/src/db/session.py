"""
Async SQLAlchemy engine and session factory.
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
        _engine = create_async_engine(
            settings.database_url,
            pool_size=10,
            max_overflow=20,
            pool_pre_ping=True,
            echo=settings.debug,
        )
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

    get_engine()/get_session_factory() intentionally cache a single engine
    for the life of the process — right for a running service, wrong for a
    test suite where pytest-asyncio hands each test function (by default) its
    own event loop: asyncpg connections are bound to the loop that opened
    them, so a pooled connection opened during test A raises "Event loop is
    closed" when test B (a new loop) tries to check it back in. Call this
    from an autouse test fixture after each test so every test gets an
    engine bound to its own loop instead of reusing a stale one.
    """
    global _engine, _session_factory
    if _engine is not None:
        await _engine.dispose()
    _engine = None
    _session_factory = None
