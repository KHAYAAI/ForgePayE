"""
KYC (Know Your Customer) / CDD (Customer Due Diligence) record management.

Stores KYC records in memory (prod: back with Postgres or Redis).
Provides status updates, expiry tracking, and risk level computation.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

import structlog

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


class KycManager:
    """
    In-memory KYC record store with risk-level computation.

    Production note: swap `_store` for a PostgreSQL-backed repository or
    a Redis hash store with TTL aligned to the expiry dates.
    """

    def __init__(self) -> None:
        # entity_id → KycRecord
        self._store: dict[str, KycRecord] = {}

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def get_kyc_status(self, entity_id: str) -> KycRecord | None:
        """Return the KYC record for `entity_id`, or None if not found."""
        record = self._store.get(entity_id)
        if record is None:
            return None

        # Auto-expire: mark as expired if past expiry date
        if record.expires_at and record.status not in ("rejected", "expired"):
            expires_dt = datetime.fromisoformat(record.expires_at.replace("Z", "+00:00"))
            if datetime.now(timezone.utc) > expires_dt:
                record = record.model_copy(update={"status": "expired"})
                self._store[entity_id] = record

        return record

    def update_kyc_status(
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
        now = datetime.now(timezone.utc).isoformat()
        existing = self._store.get(entity_id)

        verified_at = existing.verified_at if existing else None
        if status == "approved" and (not existing or existing.status != "approved"):
            verified_at = now

        expires_at: str | None = None
        if status == "approved":
            expiry_days = _EXPIRY_DAYS.get(risk_level, 365)
            expires_dt = datetime.now(timezone.utc) + timedelta(days=expiry_days)
            expires_at = expires_dt.isoformat()
        elif existing:
            expires_at = existing.expires_at

        record = KycRecord(
            entity_id=entity_id,
            entity_type=entity_type if not existing else existing.entity_type,
            status=status,
            risk_level=risk_level,
            verified_at=verified_at,
            expires_at=expires_at,
            documents_provided=documents_provided
            if documents_provided is not None
            else (existing.documents_provided if existing else []),
            aml_risk_factors=aml_risk_factors
            if aml_risk_factors is not None
            else (existing.aml_risk_factors if existing else []),
            last_reviewed_at=now,
            reviewer_notes=reviewer_notes,
        )
        self._store[entity_id] = record
        logger.info(
            "kyc.status_updated",
            entity_id=entity_id,
            status=status,
            risk_level=risk_level,
        )
        return record

    def get_expiring_soon(self, days: int = 30) -> list[KycRecord]:
        """Return KYC records whose expiry falls within the next `days` days."""
        now = datetime.now(timezone.utc)
        cutoff = now + timedelta(days=days)
        result: list[KycRecord] = []
        for record in self._store.values():
            if record.status not in ("approved",):
                continue
            if not record.expires_at:
                continue
            try:
                exp_dt = datetime.fromisoformat(record.expires_at.replace("Z", "+00:00"))
                if now <= exp_dt <= cutoff:
                    result.append(record)
            except ValueError:
                pass
        result.sort(key=lambda r: r.expires_at or "")
        return result

    def compute_risk_level(self, entity: dict[str, Any]) -> str:
        """
        Compute a risk level ("low" | "medium" | "high" | "very_high")
        based on entity attributes.

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

    def list_all(self) -> list[KycRecord]:
        """Return all KYC records (for internal use / admin dashboards)."""
        return list(self._store.values())
