"""
SQLAlchemy ORM models for the ForgePay MoR layer.
"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def _now() -> datetime:
    return datetime.now(UTC)


class Base(DeclarativeBase):
    pass


class Merchant(Base):
    __tablename__ = "merchants"

    id:           Mapped[str]  = mapped_column(UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid4()))
    email:        Mapped[str]  = mapped_column(String(255), unique=True, nullable=False)
    name:         Mapped[str]  = mapped_column(String(255), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    api_key:      Mapped[str]  = mapped_column(String(255), unique=True, nullable=False)
    hs_merchant_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at:   Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at:   Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    checkout_sessions: Mapped[list["CheckoutSession"]] = relationship(back_populates="merchant")


class CheckoutSession(Base):
    __tablename__ = "checkout_sessions"

    id:            Mapped[str]  = mapped_column(String(255), primary_key=True)
    merchant_id:   Mapped[str]  = mapped_column(UUID(as_uuid=False), ForeignKey("merchants.id"), nullable=False)
    payment_id:    Mapped[str | None] = mapped_column(String(255), nullable=True)
    status:        Mapped[str]  = mapped_column(String(50), nullable=False, default="pending")
    currency:      Mapped[str]  = mapped_column(String(10), nullable=False, default="USD")
    amount_subtotal: Mapped[int] = mapped_column(Integer, nullable=False)
    amount_tax:    Mapped[int]  = mapped_column(Integer, nullable=False, default=0)
    amount_total:  Mapped[int]  = mapped_column(Integer, nullable=False)
    customer_id:   Mapped[str | None] = mapped_column(String(255), nullable=True)
    customer_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    success_url:   Mapped[str]  = mapped_column(Text, nullable=False)
    cancel_url:    Mapped[str | None] = mapped_column(Text, nullable=True)
    metadata_:     Mapped[dict | None] = mapped_column("metadata", JSONB, nullable=True)
    tax_breakdown: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    failure_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    completed_at:  Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    expires_at:    Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at:    Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    updated_at:    Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, onupdate=_now)

    merchant: Mapped["Merchant"] = relationship(back_populates="checkout_sessions")
