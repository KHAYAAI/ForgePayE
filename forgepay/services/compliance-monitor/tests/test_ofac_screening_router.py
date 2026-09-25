"""
Regression tests for two bugs found in a launch-readiness review of the
real-time transaction screening endpoint (POST /v1/screening):

1. Wrong-engine wiring: the router's dependency read `screening_engine`
   (a ScreeningEngine — entity/address lookups only) off app.state instead
   of `transaction_screening_engine` (a TransactionScreeningEngine — the
   class the route handlers actually call `.screen_transaction()` /
   `.batch_screen()` on). Every call raised AttributeError before ever
   reaching a sanctions check. Not caught before because test_screening.py
   and test_ofac_feed_integration.py both construct TransactionScreeningEngine
   directly and call its methods directly — never through the actual route,
   so the app.state wiring was never exercised.

2. Fail-open on error: TransactionScreeningEngine.screen_transaction()'s
   except-Exception path returned risk_score=0/is_match=False — the same
   shape as a transaction that was actually screened and came back clean.
   A screening outage (Redis down, a parsing bug, a timeout) was therefore
   indistinguishable from "checked, no match."

These tests build a minimal FastAPI app wired to the real router (matching
the pattern in test_authorization.py: real routers, real signed JWTs, driven
through TestClient) rather than calling engine methods directly, so they
would have caught bug #1, and use a monkeypatched engine method to force the
error path for bug #2 without needing real OFAC feed data.
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.auth import create_access_token
from src.ofac.feed import OfacFeedManager
from src.routers import ofac_screening
from src.sanctions.screening import TransactionScreeningEngine

MERCHANT = "merch-aaa"


def _auth_headers() -> dict[str, str]:
    token = create_access_token({"sub": MERCHANT, "scopes": ["compliance:read"]})
    return {"Authorization": f"Bearer {token}"}


def _screening_engine() -> TransactionScreeningEngine:
    # redis_client=None is fine here: _search_with_variants reads the
    # in-process _entries dict (empty by default), which never touches
    # Redis for a service that hasn't called refresh_all_feeds().
    ofac_manager = OfacFeedManager(redis_client=None)
    return TransactionScreeningEngine(ofac_manager=ofac_manager)


@pytest.fixture
def app_with_transaction_engine() -> FastAPI:
    """The correctly-wired app: only `transaction_screening_engine` is set,
    matching what main.py actually does. Before the fix, this 503'd because
    the router read the (unset) `screening_engine` attribute instead."""
    application = FastAPI()
    application.include_router(ofac_screening.router)
    application.state.transaction_screening_engine = _screening_engine()
    return application


@pytest.fixture
def app_with_wrong_engine_only() -> FastAPI:
    """Simulates the pre-fix misconfiguration one level up: if something
    only ever wires `screening_engine` (the entity/address engine) and never
    `transaction_screening_engine`, the route must fail closed with a clear
    503, not silently fall back to the wrong engine and AttributeError."""
    application = FastAPI()
    application.include_router(ofac_screening.router)
    application.state.screening_engine = object()  # wrong type on purpose
    return application


_BODY = {
    "transaction_id": "txn-1",
    "agent_id": "agent-xyz",
    "counterparty_name": "Totally Normal Company",
    "amount_usd": 100.0,
}


def test_screening_endpoint_uses_the_transaction_engine(
    app_with_transaction_engine: FastAPI,
) -> None:
    """POST /v1/screening must actually work end to end through the real
    dependency wiring, not just when the engine method is called directly."""
    client = TestClient(app_with_transaction_engine)
    resp = client.post("/v1/screening", json=_BODY, headers=_auth_headers())

    assert resp.status_code == 200
    body = resp.json()
    assert body["transaction_id"] == "txn-1"
    # No sanctions data loaded in this test -> genuinely clean, not an error.
    assert body["is_match"] is False
    assert body["recommended_action"] == "allow"


def test_screening_endpoint_503s_without_the_transaction_engine(
    app_with_wrong_engine_only: FastAPI,
) -> None:
    """If only the wrong engine is wired, this must be a clear 503 ('not
    initialized'), never a 500 from calling a method that doesn't exist."""
    client = TestClient(app_with_wrong_engine_only)
    resp = client.post("/v1/screening", json=_BODY, headers=_auth_headers())

    assert resp.status_code == 503


@pytest.mark.asyncio
async def test_screen_transaction_fails_closed_on_internal_error() -> None:
    """A screening call that errors must not look identical to a clean
    result: risk_score/is_match must land in a 'needs review' state, and
    the same convention screening/engine.py's entity/address screener
    already uses for its own error path."""
    engine = _screening_engine()
    # _search_with_variants is synchronous; a plain Mock's side_effect
    # raises on call, which is what the code path being tested needs —
    # an AsyncMock here would return an un-awaited coroutine instead of
    # actually raising where screen_transaction calls it.
    engine._search_with_variants = MagicMock(side_effect=RuntimeError("boom"))  # type: ignore[method-assign]

    result = await engine.screen_transaction(
        transaction_id="txn-err",
        agent_id="agent-xyz",
        counterparty_name="Whoever",
        amount_usd=1.0,
    )

    assert result.is_match is True
    assert 40 <= result.risk_score < 80  # lands in the router's "review" band
    assert any("screening_error" in reason for reason in result.hit_reasons)
