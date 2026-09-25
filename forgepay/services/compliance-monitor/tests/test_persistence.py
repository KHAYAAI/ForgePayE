"""
Proves persistence is real, not just "doesn't crash".

The property that was missing before this change: an in-memory dict
obviously "works" for a single-process test, since the manager instance the
test built is the only thing that ever reads it back. What actually matters
is that the data survives a *fresh* manager instance -- i.e. a process
restart -- against the same underlying database. Every test below builds
one manager, writes through it, then builds a *second*, independent manager
(via `make_session_factory`, pointed at the same sqlite file) and reads the
data back through that second instance.

Also covers the FinCEN filing-status seam (src/reporting/fincen.py): the
distinction between "submitted_unfiled" (default, unconfigured) and "filed"
(a real provider actually got FinCEN to accept it) must never collapse.
"""

from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker

from src.kyc.manager import KycManager
from src.models import SarReport
from src.monitoring.engine import TransactionMonitoringEngine
from src.reporting.fincen import FincenFilingResult
from src.reporting.sar import SarManager

# ---------------------------------------------------------------------------
# SAR / CTR persistence
# ---------------------------------------------------------------------------


async def test_sar_survives_manager_restart(
    session_factory: async_sessionmaker, make_session_factory
) -> None:
    first = SarManager(session_factory=session_factory)
    created = await first.create_draft_sar(
        merchant_id="merch-persist",
        transaction_ids=["txn-1", "txn-2"],
        activity_description="structuring pattern across 3 accounts",
        suspicious_types=["structuring"],
        total_amount=25_000.0,
        activity_start_date="2026-09-01",
        activity_end_date="2026-09-05",
    )

    # A brand new manager, brand new engine/session factory -- as if the
    # process had restarted -- pointed at the *same* underlying sqlite file.
    second = SarManager(session_factory=make_session_factory())
    reloaded = await second.get_sar(created.id)

    assert reloaded is not None
    assert reloaded.id == created.id
    assert reloaded.merchant_id == "merch-persist"
    assert reloaded.transaction_ids == ["txn-1", "txn-2"]
    assert reloaded.total_amount == 25_000.0
    assert reloaded.status == "draft"


async def test_ctr_survives_manager_restart(
    session_factory: async_sessionmaker, make_session_factory
) -> None:
    first = SarManager(session_factory=session_factory)
    await first.create_ctr(
        merchant_id="merch-persist",
        transaction_id="txn-cash-1",
        amount=15_000.0,
        currency="USD",
        transaction_date="2026-09-01",
    )

    second = SarManager(session_factory=make_session_factory())
    ctrs = await second.get_ctrs(merchant_id="merch-persist")

    assert len(ctrs) == 1
    assert ctrs[0].transaction_id == "txn-cash-1"
    assert ctrs[0].amount == 15_000.0


# ---------------------------------------------------------------------------
# KYC persistence
# ---------------------------------------------------------------------------


async def test_kyc_record_survives_manager_restart(
    session_factory: async_sessionmaker, make_session_factory
) -> None:
    first = KycManager(session_factory=session_factory)
    await first.update_kyc_status(
        entity_id="entity-persist-1",
        status="approved",
        risk_level="high",
        reviewer_notes="manual review passed",
        documents_provided=["passport", "proof_of_address"],
        aml_risk_factors=["high_risk_jurisdiction"],
        entity_type="business",
    )

    second = KycManager(session_factory=make_session_factory())
    reloaded = await second.get_kyc_status("entity-persist-1")

    assert reloaded is not None
    assert reloaded.status == "approved"
    assert reloaded.risk_level == "high"
    assert reloaded.entity_type == "business"
    assert reloaded.documents_provided == ["passport", "proof_of_address"]
    assert reloaded.aml_risk_factors == ["high_risk_jurisdiction"]
    assert reloaded.verified_at is not None
    assert reloaded.expires_at is not None


async def test_kyc_update_then_restart_preserves_latest_state(
    session_factory: async_sessionmaker, make_session_factory
) -> None:
    """A second write through a fresh manager instance must not resurrect
    the first manager's stale in-memory copy -- there is no in-memory copy
    any more, only the database."""
    first = KycManager(session_factory=session_factory)
    await first.update_kyc_status(entity_id="entity-2", status="pending", risk_level="low")

    second = KycManager(session_factory=make_session_factory())
    await second.update_kyc_status(entity_id="entity-2", status="rejected", risk_level="low")

    third = KycManager(session_factory=make_session_factory())
    reloaded = await third.get_kyc_status("entity-2")
    assert reloaded.status == "rejected"


# ---------------------------------------------------------------------------
# AML alert persistence
# ---------------------------------------------------------------------------


async def test_aml_alert_survives_engine_restart(
    session_factory: async_sessionmaker, make_session_factory
) -> None:
    from datetime import UTC, datetime

    from src.models import MonitoringRule, TransactionMonitoringResult

    first = TransactionMonitoringEngine(session_factory=session_factory)
    result = TransactionMonitoringResult(
        transaction_id="txn-aml-1",
        merchant_id="merch-persist",
        amount=12_000.0,
        currency="USD",
        evaluated_at=datetime.now(UTC).isoformat(),
        rules_triggered=[
            MonitoringRule(
                rule_id="structuring",
                rule_name="Structuring",
                category="structuring",
                severity="high",
                description="multiple sub-threshold deposits",
                triggered_values={"count": 4},
            )
        ],
        risk_score=65,
        decision="review",
        requires_sar=True,
    )
    await first._persist_alert(result)

    second = TransactionMonitoringEngine(session_factory=make_session_factory())
    alerts = await second.get_alerts(merchant_id="merch-persist")

    assert len(alerts) == 1
    assert alerts[0].transaction_id == "txn-aml-1"
    assert alerts[0].risk_score == 65
    assert alerts[0].requires_sar is True
    assert len(alerts[0].rules_triggered) == 1
    assert alerts[0].rules_triggered[0].rule_id == "structuring"


# ---------------------------------------------------------------------------
# FinCEN filing seam
# ---------------------------------------------------------------------------


class _FakeAcceptingFincenProvider:
    """A stand-in for a real FincenFilingProvider that actually files."""

    name = "fake-accepting"

    async def file_sar(self, sar: SarReport) -> FincenFilingResult:
        return FincenFilingResult(
            accepted=True,
            status="filed",
            acknowledgement_id="FINCEN-ACK-12345",
            detail="accepted by fake provider",
        )


async def test_submit_sar_without_real_provider_is_unfiled_not_submitted(
    session_factory: async_sessionmaker,
) -> None:
    """
    With only the default UnconfiguredFincenFilingProvider wired up (the
    real state of this service today), submit_sar() must land on a status
    distinct from what a real filing would produce, and must never
    fabricate an acknowledgement id.
    """
    mgr = SarManager(session_factory=session_factory)
    sar = await mgr.create_draft_sar(
        merchant_id="merch-fincen",
        transaction_ids=["txn-1"],
        activity_description="test",
        suspicious_types=["structuring"],
    )

    submitted = await mgr.submit_sar(sar.id)

    assert submitted.status == "submitted_unfiled"
    assert submitted.status != "submitted"  # the old, ambiguous value
    assert submitted.status != "filed"
    assert submitted.fincen_acknowledgement_id is None
    assert submitted.submitted_at is not None


async def test_submit_sar_with_real_provider_reports_filed(
    session_factory: async_sessionmaker,
) -> None:
    """When a real provider actually gets FinCEN to accept the filing, the
    SAR should land on "filed" and carry the real acknowledgement id."""
    mgr = SarManager(
        session_factory=session_factory,
        fincen_provider=_FakeAcceptingFincenProvider(),
    )
    sar = await mgr.create_draft_sar(
        merchant_id="merch-fincen",
        transaction_ids=["txn-1"],
        activity_description="test",
        suspicious_types=["structuring"],
    )

    submitted = await mgr.submit_sar(sar.id)

    assert submitted.status == "filed"
    assert submitted.fincen_acknowledgement_id == "FINCEN-ACK-12345"


async def test_dashboard_stats_do_not_count_unfiled_as_filed(
    session_factory: async_sessionmaker,
) -> None:
    """The dashboard must be able to tell "we tried, nothing is configured"
    apart from "FinCEN confirmed this" -- see get_dashboard_stats()."""
    mgr = SarManager(session_factory=session_factory)
    sar = await mgr.create_draft_sar(
        merchant_id="merch-fincen",
        transaction_ids=["txn-1"],
        activity_description="test",
        suspicious_types=["structuring"],
    )
    await mgr.submit_sar(sar.id)

    stats = await mgr.get_dashboard_stats()

    assert stats["sars"]["submitted_unfiled"] == 1
    assert stats["sars"]["filed"] == 0
    assert stats["sars"]["total"] == 1


async def test_submit_sar_requires_draft_status(session_factory: async_sessionmaker) -> None:
    """Preserves the pre-existing draft-only guard."""
    mgr = SarManager(session_factory=session_factory)
    sar = await mgr.create_draft_sar(
        merchant_id="merch-fincen",
        transaction_ids=["txn-1"],
        activity_description="test",
        suspicious_types=["structuring"],
    )
    await mgr.submit_sar(sar.id)

    with pytest.raises(ValueError, match="already in status"):
        await mgr.submit_sar(sar.id)


async def test_submit_sar_not_found_raises_key_error(session_factory: async_sessionmaker) -> None:
    mgr = SarManager(session_factory=session_factory)
    with pytest.raises(KeyError):
        await mgr.submit_sar("does-not-exist")


# ---------------------------------------------------------------------------
# Screening cache (Redis, 24h TTL) -- not a regulatory record, so this
# proves the wiring rather than restart-survival like the sections above.
# ---------------------------------------------------------------------------


class _FakeRedis:
    """A minimal in-process stand-in for redis.asyncio.Redis's async API."""

    def __init__(self) -> None:
        self.store: dict[str, tuple[str, int]] = {}
        self.raise_on_call = False

    async def setex(self, key: str, ttl: int, value: str) -> None:
        if self.raise_on_call:
            raise ConnectionError("redis unavailable")
        self.store[key] = (value, ttl)

    async def get(self, key: str) -> str | None:
        if self.raise_on_call:
            raise ConnectionError("redis unavailable")
        entry = self.store.get(key)
        return entry[0] if entry else None


async def test_screening_result_cached_with_24h_ttl() -> None:
    from src.sanctions.eu_list import EuSanctionsManager
    from src.sanctions.ofac import OfacListManager
    from src.screening.engine import ScreeningEngine

    fake_redis = _FakeRedis()
    engine = ScreeningEngine(
        ofac=OfacListManager(sdn_url="https://fake.treasury.gov/sdn.xml"),
        eu=EuSanctionsManager(list_url="https://fake.eu/list.xml"),
        redis_client=fake_redis,
    )

    result = await engine.screen_entity(
        entity_id="entity-cache-1", entity_type="person", name="Nobody Notable"
    )

    key = "compliance-monitor:screening:entity-cache-1"
    assert key in fake_redis.store
    _cached_json, ttl = fake_redis.store[key]
    assert ttl == 86_400
    assert result.entity_id == "entity-cache-1"

    history = await engine.get_history("entity-cache-1")
    assert len(history) == 1
    assert history[0].entity_id == "entity-cache-1"


async def test_screening_cache_outage_does_not_fail_the_request() -> None:
    """A cache is allowed to degrade; the actual screening result computed
    fresh must still be returned even if Redis is down."""
    from src.sanctions.eu_list import EuSanctionsManager
    from src.sanctions.ofac import OfacListManager
    from src.screening.engine import ScreeningEngine

    fake_redis = _FakeRedis()
    fake_redis.raise_on_call = True
    engine = ScreeningEngine(
        ofac=OfacListManager(sdn_url="https://fake.treasury.gov/sdn.xml"),
        eu=EuSanctionsManager(list_url="https://fake.eu/list.xml"),
        redis_client=fake_redis,
    )

    # Must not raise even though every redis call fails.
    result = await engine.screen_entity(
        entity_id="entity-cache-2", entity_type="person", name="Nobody Notable"
    )
    assert result.entity_id == "entity-cache-2"

    history = await engine.get_history("entity-cache-2")
    assert history == []
