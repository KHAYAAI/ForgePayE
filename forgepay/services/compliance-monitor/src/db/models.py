"""
SQLAlchemy ORM models for the ForgePay Compliance Monitor.

Mirrors mor-layer/src/db/models.py's conventions (DeclarativeBase `Base`,
string primary keys via uuid4, timezone-naive-string timestamps kept as the
pydantic models in src/models.py already represent them).

Columns are typed to be Postgres/sqlite-portable: list-of-string fields use
the generic `JSON` type (not JSONB) so the same models work against the real
asyncpg/Postgres production path and against sqlite in tests -- see
src/db/session.py and tests/conftest.py.
"""

from __future__ import annotations

from uuid import uuid4

from sqlalchemy import JSON, Boolean, Float, Integer, String, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def _new_id() -> str:
    return str(uuid4())


class Base(DeclarativeBase):
    pass


class SarRow(Base):
    """A Suspicious Activity Report. Mirrors src.models.SarReport."""

    __tablename__ = "sars"

    id:                        Mapped[str]        = mapped_column(String(36), primary_key=True, default=_new_id)
    merchant_id:                Mapped[str]        = mapped_column(String(255), nullable=False, index=True)
    transaction_ids:             Mapped[list[str]]       = mapped_column(JSON, nullable=False, default=list)
    filing_type:                 Mapped[str]        = mapped_column(String(50), nullable=False, default="initial")
    status:                       Mapped[str]        = mapped_column(String(30), nullable=False, default="draft", index=True)
    activity_description:        Mapped[str]        = mapped_column(Text, nullable=False)
    suspicious_activity_type:    Mapped[list[str]]       = mapped_column(JSON, nullable=False, default=list)
    total_amount:                 Mapped[float]      = mapped_column(Float, nullable=False, default=0.0)
    activity_start_date:         Mapped[str]        = mapped_column(String(32), nullable=False)
    activity_end_date:           Mapped[str]        = mapped_column(String(32), nullable=False)
    created_at:                   Mapped[str]        = mapped_column(String(64), nullable=False)
    submitted_at:                 Mapped[str | None] = mapped_column(String(64), nullable=True)
    # See src/reporting/fincen.py -- always NULL until a real
    # FincenFilingProvider actually files with FinCEN.
    fincen_acknowledgement_id:   Mapped[str | None] = mapped_column(String(255), nullable=True)


class CtrRow(Base):
    """A Currency Transaction Report. Mirrors src.models.CtrReport."""

    __tablename__ = "ctrs"

    id:                Mapped[str]   = mapped_column(String(36), primary_key=True, default=_new_id)
    merchant_id:        Mapped[str]   = mapped_column(String(255), nullable=False, index=True)
    transaction_id:      Mapped[str]   = mapped_column(String(255), nullable=False, index=True)
    amount:               Mapped[float] = mapped_column(Float, nullable=False)
    currency:             Mapped[str]   = mapped_column(String(10), nullable=False)
    transaction_date:     Mapped[str]   = mapped_column(String(32), nullable=False)
    filing_status:        Mapped[str]   = mapped_column(String(20), nullable=False, default="pending", index=True)
    created_at:            Mapped[str]   = mapped_column(String(64), nullable=False)


class KycRecordRow(Base):
    """A KYC/CDD record for a merchant or end-customer entity. Mirrors src.models.KycRecord."""

    __tablename__ = "kyc_records"

    entity_id:            Mapped[str]        = mapped_column(String(255), primary_key=True)
    entity_type:           Mapped[str]        = mapped_column(String(50), nullable=False)
    status:                 Mapped[str]        = mapped_column(String(30), nullable=False, index=True)
    risk_level:             Mapped[str]        = mapped_column(String(20), nullable=False)
    verified_at:            Mapped[str | None] = mapped_column(String(64), nullable=True)
    expires_at:             Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    documents_provided:      Mapped[list[str]]       = mapped_column(JSON, nullable=False, default=list)
    aml_risk_factors:        Mapped[list[str]]       = mapped_column(JSON, nullable=False, default=list)
    last_reviewed_at:        Mapped[str]        = mapped_column(String(64), nullable=False)
    reviewer_notes:          Mapped[str | None] = mapped_column(Text, nullable=True)


class AmlAlertRow(Base):
    """
    A persisted AML monitoring alert -- one row per TransactionMonitoringResult
    that TransactionMonitoringEngine.evaluate_transaction() decided was worth
    keeping (triggered >= 1 rule, or risk_score >= 30). Mirrors
    src.models.TransactionMonitoringResult; `id` is a synthetic surrogate key
    since the same transaction_id could in principle be evaluated more than
    once (evaluate_transaction() itself carries no dedup guarantee -- only the
    run_monitoring_cycle() cron path's `_evaluated_ids` set does).
    """

    __tablename__ = "aml_alerts"

    id:                Mapped[str]   = mapped_column(String(36), primary_key=True, default=_new_id)
    transaction_id:      Mapped[str]   = mapped_column(String(255), nullable=False, index=True)
    merchant_id:          Mapped[str]   = mapped_column(String(255), nullable=False, index=True)
    amount:                Mapped[float] = mapped_column(Float, nullable=False)
    currency:              Mapped[str]   = mapped_column(String(10), nullable=False)
    evaluated_at:          Mapped[str]   = mapped_column(String(64), nullable=False, index=True)
    rules_triggered:        Mapped[list[str]]  = mapped_column(JSON, nullable=False, default=list)
    risk_score:             Mapped[int]   = mapped_column(Integer, nullable=False)
    decision:                Mapped[str]   = mapped_column(String(20), nullable=False)
    requires_sar:            Mapped[bool]  = mapped_column(Boolean, nullable=False, default=False)
