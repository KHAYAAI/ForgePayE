"""
KYC (Know Your Customer) / CDD (Customer Due Diligence) record management.

Backed by the `kyc_records` Postgres table (src/db/models.py). Provides
status updates, expiry tracking, and risk level computation.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from src.db.models import KycRecordRow
from src.models import KycRecord

logger = structlog.get_logger(__name__)

# ---------------------------------------------------------------------------
# Risk factor definitions
# ---------------------------------------------------------------------------

# Countries classified as high or very-high risk for KYC risk scoring
_HIGH_RISK_JURISDICTIONS: frozenset[str] = frozenset(
    {
        "IR", "KP", "SY", "CU", "RU", "BY",  # OFAC comprehensive sanctioned
        "MM", "SD", "YE", "LY", "ML", "AF",  # FATF high-risk
        "PK", "HT",                            # FATF increased monitoring
    }
)

_VERY_HIGH_RISK_BUSINESS_TYPES: frozenset[str] = frozenset(
    {
        "money_services", "cryptocurrency_exchange", "gambling", "arms_dealer",
        "private_banking", "correspondent_banking", "shell_company",
        "trust_services", "anonymous_company",
    }
)

_HIGH_RISK_BUSINESS_TYPES: frozenset[str] = frozenset(
    {
        "real_estate", "precious_metals", "art_dealer", "charity_ngo",
        "gaming", "adult_entertainment", "cannabis", "pawnshop",
    }
)

# Default KYC expiry periods by risk level
_EXPIRY_DAYS: dict[str, int] = {
    "low": 1095,       # 3 years
    "medium": 730,     # 2 years
    "high": 365,       # 1 year
    "very_high": 180,  # 6 months
}


def _record_from_row(row: KycRecordRow) -> KycRecord:
    return KycRecord(
        entity_id=row.entity_id,
        entity_type=row.entity_type,
        status=row.status,
        risk_level=row.risk_level,
        verified_at=row.verified_at,
        expires_at=row.expires_at,
        documents_provided=list(row.documents_provided or []),
        aml_risk_factors=list(row.aml_risk_factors or []),
        last_reviewed_at=row.last_reviewed_at,
        reviewer_notes=row.reviewer_notes,
    )


class KycManager:
    """
    PostgreSQL-backed KYC record store with risk-level computation.

    `session_factory` is an `async_sessionmaker[AsyncSession]` -- normally
    `src.db.session.get_session_factory()`, injected explicitly (see
    src/main.py) so tests can point a manager at an isolated database.
    """

    def __init__(self, session_factory: async_sessionmaker[AsyncSession]) -> None:
        self._session_factory = session_factory

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def get_kyc_status(self, entity_id: str) -> KycRecord | None:
        """Return the KYC record for `entity_id`, or None if not found."""
        async with self._session_factory() as session:
            row = await session.get(KycRecordRow, entity_id)
            if row is None:
                return None

            # Auto-expire: mark as expired if past expiry date
            if row.expires_at and row.status not in ("rejected", "expired"):
                expires_dt = datetime.fromisoformat(row.expires_at.replace("Z", "+00:00"))
                if datetime.now(UTC) > expires_dt:
                    row.status = "expired"
                    await session.commit()

            return _record_from_row(row)

    async def update_kyc_status(
        self,
        entity_id: str,
        status: str,
        risk_level: str,
        reviewer_notes: str | None = None,
        documents_provided: list[str] | None = None,
        aml_risk_factors: list[str] | None = None,
        entity_type: str = "person",
    ) -> KycRecord:
        """
        Create or update the KYC record for `entity_id`.

        Automatically sets:
        - verified_at (when status transitions to "approved")
        - expires_at (based on risk_level)
        - last_reviewed_at (always now)
        """
        now = datetime.now(UTC).isoformat()

        async with self._session_factory() as session:
            row = await session.get(KycRecordRow, entity_id)
            existing = _record_from_row(row) if row is not None else None

            verified_at = existing.verified_at if existing else None
            if status == "approved" and (not existing or existing.status != "approved"):
                verified_at = now

            expires_at: str | None = None
            if status == "approved":
                expiry_days = _EXPIRY_DAYS.get(risk_level, 365)
                expires_dt = datetime.now(UTC) + timedelta(days=expiry_days)
                expires_at = expires_dt.isoformat()
            elif existing:
                expires_at = existing.expires_at

            new_documents = (
                documents_provided
                if documents_provided is not None
                else (existing.documents_provided if existing else [])
            )
            new_risk_factors = (
                aml_risk_factors
                if aml_risk_factors is not None
                else (existing.aml_risk_factors if existing else [])
            )
            new_entity_type = entity_type if not existing else existing.entity_type

            if row is None:
                row = KycRecordRow(
                    entity_id=entity_id,
                    entity_type=new_entity_type,
                    status=status,
                    risk_level=risk_level,
                    verified_at=verified_at,
                    expires_at=expires_at,
                    documents_provided=new_documents,
                    aml_risk_factors=new_risk_factors,
                    last_reviewed_at=now,
                    reviewer_notes=reviewer_notes,
                )
                session.add(row)
            else:
                row.entity_type = new_entity_type
                row.status = status
                row.risk_level = risk_level
                row.verified_at = verified_at
                row.expires_at = expires_at
                row.documents_provided = new_documents
                row.aml_risk_factors = new_risk_factors
                row.last_reviewed_at = now
                row.reviewer_notes = reviewer_notes

            await session.commit()
            record = _record_from_row(row)

        logger.info(
            "kyc.status_updated",
            entity_id=entity_id,
            status=status,
            risk_level=risk_level,
        )
        return record

    async def get_expiring_soon(self, days: int = 30) -> list[KycRecord]:
        """Return KYC records whose expiry falls within the next `days` days."""
        now = datetime.now(UTC)
        cutoff = now + timedelta(days=days)

        async with self._session_factory() as session:
            stmt = select(KycRecordRow).where(KycRecordRow.status == "approved")
            rows = (await session.execute(stmt)).scalars().all()

        result: list[KycRecord] = []
        for row in rows:
            if not row.expires_at:
                continue
            try:
                exp_dt = datetime.fromisoformat(row.expires_at.replace("Z", "+00:00"))
                if now <= exp_dt <= cutoff:
                    result.append(_record_from_row(row))
            except ValueError:
                pass
        result.sort(key=lambda r: r.expires_at or "")
        return result

    def compute_risk_level(self, entity: dict[str, Any]) -> str:
        """
        Compute a risk level ("low" | "medium" | "high" | "very_high")
        based on entity attributes.

        Pure function -- touches no storage, so it stays synchronous.

        Entity dict keys (all optional):
            jurisdiction: str        — ISO-3166 alpha-2 country code
            business_type: str       — see _HIGH_RISK_BUSINESS_TYPES
            annual_volume_usd: float — expected annual transaction volume
            is_pep: bool             — Politically Exposed Person
            adverse_media: bool      — adverse media hits found
        """
        score = 0

        jurisdiction = (entity.get("jurisdiction") or "").upper()
        if jurisdiction in _HIGH_RISK_JURISDICTIONS:
            score += 40

        business_type = (entity.get("business_type") or "").lower()
        if business_type in _VERY_HIGH_RISK_BUSINESS_TYPES:
            score += 50
        elif business_type in _HIGH_RISK_BUSINESS_TYPES:
            score += 25

        annual_volume = float(entity.get("annual_volume_usd") or 0)
        if annual_volume > 10_000_000:
            score += 20
        elif annual_volume > 1_000_000:
            score += 10

        if entity.get("is_pep"):
            score += 30

        if entity.get("adverse_media"):
            score += 20

        if score >= 70:
            return "very_high"
        if score >= 40:
            return "high"
        if score >= 20:
            return "medium"
        return "low"

    async def list_all(self) -> list[KycRecord]:
        """Return all KYC records (for internal use / admin dashboards)."""
        async with self._session_factory() as session:
            rows = (await session.execute(select(KycRecordRow))).scalars().all()
        return [_record_from_row(r) for r in rows]
