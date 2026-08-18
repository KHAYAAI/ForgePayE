"""
Authorization tests for compliance-monitor.

Covers two classes of bugs found in a security review:

1. Cross-merchant IDOR: routers that filter by `merchant_id` (monitoring
   alerts, SARs, CTRs) or expose a single resource by id (SAR detail /
   submit) must verify the authenticated caller actually owns that
   merchant_id (or holds the "admin" scope) — not just accept whatever
   merchant_id the query/path asks for.

2. Unrestricted rule toggle: PUT /api/v1/monitoring/rules/{id}/toggle is a
   platform-wide configuration change and must require the "admin" scope,
   not just any valid authenticated caller.

These tests build a minimal FastAPI app wired to the real routers and real
in-memory engines/managers (no network access — the OFAC/EU managers here
are only used for age/entry-count metadata, never refreshed), and drive it
through FastAPI's TestClient using real signed JWTs.
"""

from __future__ import annotations

from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.auth import create_access_token
from src.monitoring.engine import TransactionMonitoringEngine
from src.reporting.sar import SarManager
from src.routers import monitoring, reporting
from src.sanctions.eu_list import EuSanctionsManager
from src.sanctions.ofac import OfacListManager

MERCHANT_A = "merch-aaa"
MERCHANT_B = "merch-bbb"


def _token(merchant_id: str, scopes: list[str]) -> str:
    return create_access_token({"sub": merchant_id, "scopes": scopes})


def _auth_headers(merchant_id: str, scopes: list[str]) -> dict[str, str]:
    return {"Authorization": f"Bearer {_token(merchant_id, scopes)}"}


@pytest.fixture
def app() -> FastAPI:
    application = FastAPI()
    application.include_router(monitoring.router)
    application.include_router(reporting.router)

    application.state.monitoring_engine = TransactionMonitoringEngine()
    application.state.sar_manager = SarManager()
    application.state.ofac_manager = OfacListManager(sdn_url="https://fake.treasury.gov/sdn.xml")
    application.state.eu_manager = EuSanctionsManager(list_url="https://fake.eu/list.xml")
    return application


@pytest.fixture
def client(app: FastAPI) -> TestClient:
    return TestClient(app)


def _seed_alert(app: FastAPI, merchant_id: str, txn_id: str) -> None:
    """Directly populate the in-memory alert store (avoids network calls)."""
    from src.models import TransactionMonitoringResult
    from datetime import datetime, timezone

    result = TransactionMonitoringResult(
        transaction_id=txn_id,
        merchant_id=merchant_id,
        amount=100.0,
        currency="USD",
        evaluated_at=datetime.now(timezone.utc).isoformat(),
        rules_triggered=[],
        risk_score=40,
        decision="review",
        requires_sar=False,
    )
    app.state.monitoring_engine._alerts.setdefault(merchant_id, []).append(result)


def _create_sar(app: FastAPI, merchant_id: str) -> Any:
    return app.state.sar_manager.create_draft_sar(
        merchant_id=merchant_id,
        transaction_ids=["txn-1"],
        activity_description="test",
        suspicious_types=["structuring"],
    )


def _create_ctr(app: FastAPI, merchant_id: str) -> Any:
    return app.state.sar_manager.create_ctr(
        merchant_id=merchant_id,
        transaction_id="txn-1",
        amount=15000.0,
        currency="USD",
        transaction_date="2026-08-01",
    )


# ---------------------------------------------------------------------------
# 1. Monitoring alerts — cross-merchant IDOR
# ---------------------------------------------------------------------------


def test_alerts_cross_merchant_denied(app: FastAPI, client: TestClient) -> None:
    _seed_alert(app, MERCHANT_A, "txn-a1")
    _seed_alert(app, MERCHANT_B, "txn-b1")

    headers = _auth_headers(MERCHANT_A, scopes=["*"])
    resp = client.get(f"/api/v1/monitoring/alerts?merchant_id={MERCHANT_B}", headers=headers)
    assert resp.status_code == 403


def test_alerts_same_merchant_allowed(app: FastAPI, client: TestClient) -> None:
    _seed_alert(app, MERCHANT_A, "txn-a1")

    headers = _auth_headers(MERCHANT_A, scopes=["*"])
    resp = client.get(f"/api/v1/monitoring/alerts?merchant_id={MERCHANT_A}", headers=headers)
    assert resp.status_code == 200
    body = resp.json()
    assert all(a["merchant_id"] == MERCHANT_A for a in body)


def test_alerts_no_filter_defaults_to_own_merchant(app: FastAPI, client: TestClient) -> None:
    _seed_alert(app, MERCHANT_A, "txn-a1")
    _seed_alert(app, MERCHANT_B, "txn-b1")

    headers = _auth_headers(MERCHANT_A, scopes=["*"])
    resp = client.get("/api/v1/monitoring/alerts", headers=headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body and all(a["merchant_id"] == MERCHANT_A for a in body)


def test_alerts_admin_can_see_any_merchant(app: FastAPI, client: TestClient) -> None:
    _seed_alert(app, MERCHANT_A, "txn-a1")
    _seed_alert(app, MERCHANT_B, "txn-b1")

    headers = _auth_headers("ops-admin", scopes=["admin"])
    resp = client.get(f"/api/v1/monitoring/alerts?merchant_id={MERCHANT_B}", headers=headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body and all(a["merchant_id"] == MERCHANT_B for a in body)

    # No filter at all: admin sees everything.
    resp_all = client.get("/api/v1/monitoring/alerts", headers=headers)
    assert resp_all.status_code == 200
    assert len(resp_all.json()) == 2


# ---------------------------------------------------------------------------
# 2. Rule toggle — must require admin scope
# ---------------------------------------------------------------------------


def test_toggle_rule_without_admin_scope_denied(client: TestClient) -> None:
    headers = _auth_headers(MERCHANT_A, scopes=["*"])
    resp = client.put(
        "/api/v1/monitoring/rules/structuring/toggle?enabled=false", headers=headers
    )
    assert resp.status_code == 403


def test_toggle_rule_with_admin_scope_succeeds(app: FastAPI, client: TestClient) -> None:
    rule_id = app.state.monitoring_engine.list_rules()[0]["rule_id"]
    headers = _auth_headers("ops-admin", scopes=["admin"])
    resp = client.put(
        f"/api/v1/monitoring/rules/{rule_id}/toggle?enabled=false", headers=headers
    )
    assert resp.status_code == 200
    assert resp.json()["enabled"] is False


def test_toggle_rule_requires_authentication(client: TestClient) -> None:
    resp = client.put("/api/v1/monitoring/rules/structuring/toggle?enabled=false")
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# 3. Evaluate transaction — caller may only submit for their own merchant
# ---------------------------------------------------------------------------


def test_evaluate_transaction_cross_merchant_denied(client: TestClient) -> None:
    headers = _auth_headers(MERCHANT_A, scopes=["*"])
    resp = client.post(
        "/api/v1/monitoring/evaluate",
        headers=headers,
        json={
            "transaction_id": "txn-1",
            "merchant_id": MERCHANT_B,
            "amount": 100.0,
            "currency": "USD",
        },
    )
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# 4. SARs — cross-merchant IDOR on list, detail, and submit
# ---------------------------------------------------------------------------


def test_sar_list_cross_merchant_denied(client: TestClient) -> None:
    headers = _auth_headers(MERCHANT_A, scopes=["*"])
    resp = client.get(f"/api/v1/reporting/sar?merchant_id={MERCHANT_B}", headers=headers)
    assert resp.status_code == 403


def test_sar_list_same_merchant_allowed(app: FastAPI, client: TestClient) -> None:
    _create_sar(app, MERCHANT_A)
    headers = _auth_headers(MERCHANT_A, scopes=["*"])
    resp = client.get(f"/api/v1/reporting/sar?merchant_id={MERCHANT_A}", headers=headers)
    assert resp.status_code == 200
    assert all(s["merchant_id"] == MERCHANT_A for s in resp.json())


def test_sar_detail_cross_merchant_denied(app: FastAPI, client: TestClient) -> None:
    sar = _create_sar(app, MERCHANT_B)
    headers = _auth_headers(MERCHANT_A, scopes=["*"])
    resp = client.get(f"/api/v1/reporting/sar/{sar.id}", headers=headers)
    assert resp.status_code == 403


def test_sar_detail_same_merchant_allowed(app: FastAPI, client: TestClient) -> None:
    sar = _create_sar(app, MERCHANT_A)
    headers = _auth_headers(MERCHANT_A, scopes=["*"])
    resp = client.get(f"/api/v1/reporting/sar/{sar.id}", headers=headers)
    assert resp.status_code == 200
    assert resp.json()["merchant_id"] == MERCHANT_A


def test_sar_detail_admin_allowed(app: FastAPI, client: TestClient) -> None:
    sar = _create_sar(app, MERCHANT_B)
    headers = _auth_headers("ops-admin", scopes=["admin"])
    resp = client.get(f"/api/v1/reporting/sar/{sar.id}", headers=headers)
    assert resp.status_code == 200


def test_sar_submit_cross_merchant_denied(app: FastAPI, client: TestClient) -> None:
    sar = _create_sar(app, MERCHANT_B)
    headers = _auth_headers(MERCHANT_A, scopes=["*"])
    resp = client.put(f"/api/v1/reporting/sar/{sar.id}/submit", headers=headers)
    assert resp.status_code == 403
    # And the SAR must not have been mutated.
    assert app.state.sar_manager.get_sar(sar.id).status == "draft"


def test_sar_submit_same_merchant_allowed(app: FastAPI, client: TestClient) -> None:
    sar = _create_sar(app, MERCHANT_A)
    headers = _auth_headers(MERCHANT_A, scopes=["*"])
    resp = client.put(f"/api/v1/reporting/sar/{sar.id}/submit", headers=headers)
    assert resp.status_code == 200
    assert resp.json()["status"] == "submitted"


def test_create_sar_for_other_merchant_denied(client: TestClient) -> None:
    headers = _auth_headers(MERCHANT_A, scopes=["*"])
    resp = client.post(
        "/api/v1/reporting/sar",
        headers=headers,
        json={
            "merchant_id": MERCHANT_B,
            "transaction_ids": ["txn-1"],
            "activity_description": "test",
            "suspicious_activity_types": ["structuring"],
            "activity_start_date": "2026-08-01",
            "activity_end_date": "2026-08-02",
            "total_amount": 100.0,
        },
    )
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# 5. CTRs — cross-merchant IDOR on list
# ---------------------------------------------------------------------------


def test_ctr_list_cross_merchant_denied(client: TestClient) -> None:
    headers = _auth_headers(MERCHANT_A, scopes=["*"])
    resp = client.get(f"/api/v1/reporting/ctr?merchant_id={MERCHANT_B}", headers=headers)
    assert resp.status_code == 403


def test_ctr_list_admin_allowed(app: FastAPI, client: TestClient) -> None:
    _create_ctr(app, MERCHANT_B)
    headers = _auth_headers("ops-admin", scopes=["admin"])
    resp = client.get(f"/api/v1/reporting/ctr?merchant_id={MERCHANT_B}", headers=headers)
    assert resp.status_code == 200
    assert all(c["merchant_id"] == MERCHANT_B for c in resp.json())


# ---------------------------------------------------------------------------
# 6. Dashboard — aggregates every merchant, so it is admin-only
# ---------------------------------------------------------------------------


def test_dashboard_requires_admin(client: TestClient) -> None:
    headers = _auth_headers(MERCHANT_A, scopes=["*"])
    resp = client.get("/api/v1/reporting/dashboard", headers=headers)
    assert resp.status_code == 403


def test_dashboard_admin_allowed(client: TestClient) -> None:
    headers = _auth_headers("ops-admin", scopes=["admin"])
    resp = client.get("/api/v1/reporting/dashboard", headers=headers)
    assert resp.status_code == 200
