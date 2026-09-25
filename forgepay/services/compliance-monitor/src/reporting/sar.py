"""
SAR (Suspicious Activity Report) management.

Manages draft → submitted_unfiled/filed → acknowledged lifecycle for SARs,
backed by the `sars` / `ctrs` Postgres tables (src/db/models.py). Persistence
is not optional here -- SAR/CTR records are real regulatory filings; see
src/config.py's production fail-closed check on DATABASE_URL.

Production integration point: `submit_sar()` calls a FincenFilingProvider
(src/reporting/fincen.py) which should call the real FinCEN BSA e-filing API
(https://bsaefiling.fincen.treas.gov/main.html). No real provider is wired up
yet -- see fincen.py's module docstring for why -- so every submission today
resolves to the honest "submitted_unfiled" status rather than "filed".

CTR (Currency Transaction Report) generation is also provided for cash
transactions over $10,000.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from src.db.models import CtrRow, SarRow
from src.models import CtrReport, SarReport
from src.reporting.fincen import (
    FincenFilingProvider,
    current_fincen_filing_provider,
)

logger = structlog.get_logger(__name__)


def _sar_from_row(row: SarRow) -> SarReport:
    return SarReport(
        id=row.id,
        merchant_id=row.merchant_id,
        transaction_ids=list(row.transaction_ids or []),
        filing_type=row.filing_type,
        status=row.status,
        activity_description=row.activity_description,
        suspicious_activity_type=list(row.suspicious_activity_type or []),
        total_amount=row.total_amount,
        activity_start_date=row.activity_start_date,
        activity_end_date=row.activity_end_date,
        created_at=row.created_at,
        submitted_at=row.submitted_at,
        fincen_acknowledgement_id=row.fincen_acknowledgement_id,
    )


def _ctr_from_row(row: CtrRow) -> CtrReport:
    return CtrReport(
        id=row.id,
        merchant_id=row.merchant_id,
        transaction_id=row.transaction_id,
        amount=row.amount,
        currency=row.currency,
        transaction_date=row.transaction_date,
        filing_status=row.filing_status,
        created_at=row.created_at,
    )


class SarManager:
    """
    PostgreSQL-backed SAR / CTR store.

    `session_factory` is an `async_sessionmaker[AsyncSession]` -- normally
    `src.db.session.get_session_factory()`, injected explicitly (see
    src/main.py) rather than reached for globally, so tests can point a
    manager at an isolated database.
    """

    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession],
        fincen_provider: FincenFilingProvider | None = None,
    ) -> None:
        self._session_factory = session_factory
        # Falls back to the process-wide provider (default: Unconfigured) so
        # a real integration can be wired in one place via
        # set_fincen_filing_provider() without touching every call site.
        self._fincen_provider = fincen_provider or current_fincen_filing_provider()

    # ------------------------------------------------------------------
    # SAR lifecycle
    # ------------------------------------------------------------------

    async def create_draft_sar(
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
        now = datetime.now(UTC).isoformat()

        row = SarRow(
            id=sar_id,
            merchant_id=merchant_id,
            transaction_ids=list(transaction_ids),
            filing_type=filing_type,
            status="draft",
            activity_description=activity_description,
            suspicious_activity_type=list(suspicious_types),
            total_amount=total_amount,
            activity_start_date=activity_start_date or now[:10],
            activity_end_date=activity_end_date or now[:10],
            created_at=now,
            submitted_at=None,
            fincen_acknowledgement_id=None,
        )
        async with self._session_factory() as session:
            session.add(row)
            await session.commit()

        logger.info(
            "sar.created",
            sar_id=sar_id,
            merchant_id=merchant_id,
            transaction_count=len(transaction_ids),
        )
        return _sar_from_row(row)

    async def submit_sar(self, sar_id: str) -> SarReport:
        """
        Submit a draft SAR: attempt a real FinCEN BSA e-filing via the
        configured FincenFilingProvider, then persist whatever it actually
        reports.

        The SAR's status only becomes "filed" when the provider reports
        FinCEN actually accepted the filing (`accepted=True`). Otherwise it
        becomes "submitted_unfiled" -- a distinct value from "filed" so
        nothing downstream (dashboard stats, a compliance officer reading
        the record) can mistake "we tried, nothing is actually configured"
        for "FinCEN has this."
        """
        async with self._session_factory() as session:
            row = await session.get(SarRow, sar_id)
            if row is None:
                raise KeyError(f"SAR {sar_id!r} not found")
            if row.status != "draft":
                raise ValueError(f"SAR {sar_id!r} is already in status {row.status!r}")

            sar = _sar_from_row(row)
            filing_result = await self._fincen_provider.file_sar(sar)

            now = datetime.now(UTC).isoformat()
            row.status = "filed" if filing_result.accepted else "submitted_unfiled"
            row.submitted_at = now
            row.fincen_acknowledgement_id = filing_result.acknowledgement_id

            await session.commit()
            updated = _sar_from_row(row)

        logger.info(
            "sar.submitted",
            sar_id=sar_id,
            merchant_id=updated.merchant_id,
            fincen_status=filing_result.status,
            actually_filed=filing_result.accepted,
            fincen_provider=self._fincen_provider.name,
        )
        return updated

    async def acknowledge_sar(self, sar_id: str) -> SarReport:
        """Mark a SAR as acknowledged by FinCEN (called via webhook or polling)."""
        async with self._session_factory() as session:
            row = await session.get(SarRow, sar_id)
            if row is None:
                raise KeyError(f"SAR {sar_id!r} not found")
            row.status = "acknowledged"
            await session.commit()
            updated = _sar_from_row(row)

        logger.info("sar.acknowledged", sar_id=sar_id)
        return updated

    async def get_sar(self, sar_id: str) -> SarReport | None:
        async with self._session_factory() as session:
            row = await session.get(SarRow, sar_id)
            return _sar_from_row(row) if row is not None else None

    async def get_sars(
        self,
        merchant_id: str | None = None,
        status: str | None = None,
    ) -> list[SarReport]:
        """
        Return SARs, optionally filtered by merchant_id and/or status.
        Sorted most-recently-created first.
        """
        stmt = select(SarRow)
        if merchant_id:
            stmt = stmt.where(SarRow.merchant_id == merchant_id)
        if status:
            stmt = stmt.where(SarRow.status == status)

        async with self._session_factory() as session:
            rows = (await session.execute(stmt)).scalars().all()

        results = [_sar_from_row(r) for r in rows]
        results.sort(key=lambda s: s.created_at, reverse=True)
        return results

    # ------------------------------------------------------------------
    # CTR management
    # ------------------------------------------------------------------

    async def create_ctr(
        self,
        merchant_id: str,
        transaction_id: str,
        amount: float,
        currency: str,
        transaction_date: str,
    ) -> CtrReport:
        """Create a Currency Transaction Report for a cash transaction > $10,000."""
        ctr_id = str(uuid.uuid4())
        now = datetime.now(UTC).isoformat()

        row = CtrRow(
            id=ctr_id,
            merchant_id=merchant_id,
            transaction_id=transaction_id,
            amount=amount,
            currency=currency,
            transaction_date=transaction_date,
            filing_status="pending",
            created_at=now,
        )
        async with self._session_factory() as session:
            session.add(row)
            await session.commit()

        logger.info(
            "ctr.created",
            ctr_id=ctr_id,
            merchant_id=merchant_id,
            amount=amount,
            currency=currency,
        )
        return _ctr_from_row(row)

    async def get_ctrs(
        self,
        merchant_id: str | None = None,
        status: str | None = None,
    ) -> list[CtrReport]:
        stmt = select(CtrRow)
        if merchant_id:
            stmt = stmt.where(CtrRow.merchant_id == merchant_id)
        if status:
            stmt = stmt.where(CtrRow.filing_status == status)

        async with self._session_factory() as session:
            rows = (await session.execute(stmt)).scalars().all()

        results = [_ctr_from_row(r) for r in rows]
        results.sort(key=lambda c: c.created_at, reverse=True)
        return results

    # ------------------------------------------------------------------
    # Dashboard stats
    # ------------------------------------------------------------------

    async def get_dashboard_stats(self) -> dict:
        """Aggregate compliance metrics for the dashboard endpoint."""
        async with self._session_factory() as session:
            sar_rows = (await session.execute(select(SarRow))).scalars().all()
            ctr_rows = (await session.execute(select(CtrRow))).scalars().all()

        total_sars = len(sar_rows)
        draft_sars = sum(1 for s in sar_rows if s.status == "draft")
        submitted_unfiled_sars = sum(1 for s in sar_rows if s.status == "submitted_unfiled")
        filed_sars = sum(1 for s in sar_rows if s.status == "filed")
        acknowledged_sars = sum(1 for s in sar_rows if s.status == "acknowledged")
        pending_ctrs = sum(1 for c in ctr_rows if c.filing_status == "pending")

        return {
            "sars": {
                "total": total_sars,
                "draft": draft_sars,
                # Locally marked "submitted" but never actually transmitted
                # to FinCEN -- see src/reporting/fincen.py. Do not read this
                # as "filed with FinCEN".
                "submitted_unfiled": submitted_unfiled_sars,
                # Only SARs a real FincenFilingProvider confirmed FinCEN
                # actually accepted. This is the only count here that means
                # "FinCEN has this."
                "filed": filed_sars,
                "acknowledged": acknowledged_sars,
            },
            "ctrs": {
                "total": len(ctr_rows),
                "pending": pending_ctrs,
                "filed": len(ctr_rows) - pending_ctrs,
            },
        }
