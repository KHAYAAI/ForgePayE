"""
SAR (Suspicious Activity Report) management.

Manages draft → submitted → acknowledged lifecycle for SARs.

Production integration point: `submit_sar()` should call the FinCEN BSA
e-filing API (https://bsaefiling.fincen.treas.gov/main.html) via their
SOAP/REST interface with a valid filing certificate.  That call is
stubbed here as the actual API requires BSA credentials and PKI certs.

CTR (Currency Transaction Report) generation is also provided for cash
transactions over $10,000.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

import structlog

from src.models import CtrReport, SarReport

logger = structlog.get_logger(__name__)


class SarManager:
    """
    In-memory SAR store.

    Production: replace _sars / _ctrs with PostgreSQL tables via SQLAlchemy.
    """

    def __init__(self) -> None:
        # sar_id → SarReport
        self._sars: dict[str, SarReport] = {}
        # ctr_id → CtrReport
        self._ctrs: dict[str, CtrReport] = {}

    # ------------------------------------------------------------------
    # SAR lifecycle
    # ------------------------------------------------------------------

    def create_draft_sar(
        self,
        merchant_id: str,
        transaction_ids: list[str],
        activity_description: str,
        suspicious_types: list[str],
        filing_type: str = "initial",
        activity_start_date: str = "",
        activity_end_date: str = "",
        total_amount: float = 0.0,
    ) -> SarReport:
        """Create a new SAR in draft status."""
        sar_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()

        sar = SarReport(
            id=sar_id,
            merchant_id=merchant_id,
            transaction_ids=transaction_ids,
            filing_type=filing_type,
            status="draft",
            activity_description=activity_description,
            suspicious_activity_type=suspicious_types,
            total_amount=total_amount,
            activity_start_date=activity_start_date or now[:10],
            activity_end_date=activity_end_date or now[:10],
            created_at=now,
            submitted_at=None,
        )
        self._sars[sar_id] = sar
        logger.info(
            "sar.created",
            sar_id=sar_id,
            merchant_id=merchant_id,
            transaction_count=len(transaction_ids),
        )
        return sar

    def submit_sar(self, sar_id: str) -> SarReport:
        """
        Mark a SAR as submitted.

        Production: call FinCEN BSA e-filing API here.
        The API returns an acknowledgement ID which should be stored.
        """
        sar = self._sars.get(sar_id)
        if sar is None:
            raise KeyError(f"SAR {sar_id!r} not found")
        if sar.status != "draft":
            raise ValueError(f"SAR {sar_id!r} is already in status {sar.status!r}")

        now = datetime.now(timezone.utc).isoformat()

        # Production stub: replace with actual FinCEN BSA e-filing call
        # response = await fincen_client.submit_sar(sar)
        # acknowledgement_id = response["acknowledgement_id"]

        updated = sar.model_copy(update={"status": "submitted", "submitted_at": now})
        self._sars[sar_id] = updated
        logger.info("sar.submitted", sar_id=sar_id, merchant_id=sar.merchant_id)
        return updated

    def acknowledge_sar(self, sar_id: str) -> SarReport:
        """Mark a SAR as acknowledged by FinCEN (called via webhook or polling)."""
        sar = self._sars.get(sar_id)
        if sar is None:
            raise KeyError(f"SAR {sar_id!r} not found")

        updated = sar.model_copy(update={"status": "acknowledged"})
        self._sars[sar_id] = updated
        logger.info("sar.acknowledged", sar_id=sar_id)
        return updated

    def get_sar(self, sar_id: str) -> SarReport | None:
        return self._sars.get(sar_id)

    def get_sars(
        self,
        merchant_id: str | None = None,
        status: str | None = None,
    ) -> list[SarReport]:
        """
        Return SARs, optionally filtered by merchant_id and/or status.
        Sorted most-recently-created first.
        """
        results = list(self._sars.values())
        if merchant_id:
            results = [s for s in results if s.merchant_id == merchant_id]
        if status:
            results = [s for s in results if s.status == status]
        results.sort(key=lambda s: s.created_at, reverse=True)
        return results

    # ------------------------------------------------------------------
    # CTR management
    # ------------------------------------------------------------------

    def create_ctr(
        self,
        merchant_id: str,
        transaction_id: str,
        amount: float,
        currency: str,
        transaction_date: str,
    ) -> CtrReport:
        """Create a Currency Transaction Report for a cash transaction > $10,000."""
        ctr_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()

        ctr = CtrReport(
            id=ctr_id,
            merchant_id=merchant_id,
            transaction_id=transaction_id,
            amount=amount,
            currency=currency,
            transaction_date=transaction_date,
            filing_status="pending",
            created_at=now,
        )
        self._ctrs[ctr_id] = ctr
        logger.info(
            "ctr.created",
            ctr_id=ctr_id,
            merchant_id=merchant_id,
            amount=amount,
            currency=currency,
        )
        return ctr

    def get_ctrs(
        self,
        merchant_id: str | None = None,
        status: str | None = None,
    ) -> list[CtrReport]:
        results = list(self._ctrs.values())
        if merchant_id:
            results = [c for c in results if c.merchant_id == merchant_id]
        if status:
            results = [c for c in results if c.filing_status == status]
        results.sort(key=lambda c: c.created_at, reverse=True)
        return results

    # ------------------------------------------------------------------
    # Dashboard stats
    # ------------------------------------------------------------------

    def get_dashboard_stats(self) -> dict:
        """Aggregate compliance metrics for the dashboard endpoint."""
        total_sars = len(self._sars)
        draft_sars = sum(1 for s in self._sars.values() if s.status == "draft")
        submitted_sars = sum(1 for s in self._sars.values() if s.status == "submitted")
        acknowledged_sars = sum(1 for s in self._sars.values() if s.status == "acknowledged")
        pending_ctrs = sum(1 for c in self._ctrs.values() if c.filing_status == "pending")

        return {
            "sars": {
                "total": total_sars,
                "draft": draft_sars,
                "submitted": submitted_sars,
                "acknowledged": acknowledged_sars,
            },
            "ctrs": {
                "total": len(self._ctrs),
                "pending": pending_ctrs,
                "filed": len(self._ctrs) - pending_ctrs,
            },
        }
