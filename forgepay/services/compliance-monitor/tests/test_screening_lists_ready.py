"""
A sanctions screen whose list never loaded matches nothing, and "no matches" used to mean "clear". These tests pin the fix:
no list, or a stale list, means "error" (which callers must treat as not cleared), never "clear".
"""

from __future__ import annotations

import asyncio

from src.screening.engine import ScreeningEngine


class FakeOfac:
    def __init__(self, entries: int, age: float) -> None:
        self._n, self._age = entries, age
        self.searched = 0

    def entry_count(self) -> int: return self._n
    def get_list_age_hours(self) -> float: return self._age
    def search(self, name: str, threshold: float = 0.85): self.searched += 1; return []
    def check_crypto_address(self, address: str): self.searched += 1; return []


class FakeEu:
    def search(self, name: str, threshold: float = 0.85): return []


class NoRedis:
    async def get(self, *a, **k): return None
    async def set(self, *a, **k): return None
    async def setex(self, *a, **k): return None
    async def lpush(self, *a, **k): return None
    async def expire(self, *a, **k): return None
    async def ltrim(self, *a, **k): return None


def engine(entries: int, age: float) -> tuple[ScreeningEngine, FakeOfac]:
    o = FakeOfac(entries, age)
    return ScreeningEngine(o, FakeEu(), NoRedis()), o  # type: ignore[arg-type]


def test_a_list_that_never_loaded_cannot_clear_an_address_or_a_name() -> None:
    e, o = engine(0, float("inf"))
    addr = asyncio.run(e.screen_crypto_address("0x" + "11" * 20))
    ent = asyncio.run(e.screen_entity("e1", "business", "Anyone Ltd"))
    assert addr.result == "error" and ent.result == "error"
    assert o.searched == 0  # it did not pretend to search an empty list


def test_a_stale_list_cannot_clear_anyone() -> None:
    e, _ = engine(10_000, 24 * 30)  # 30 days old; the limit is 72h
    assert asyncio.run(e.screen_crypto_address("0x" + "22" * 20)).result == "error"


def test_a_fresh_loaded_list_screens_normally() -> None:
    e, o = engine(10_000, 1.0)
    assert asyncio.run(e.screen_crypto_address("0x" + "33" * 20)).result == "clear"
    assert o.searched == 1
