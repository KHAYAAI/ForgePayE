"""Initial schema: merchants and checkout_sessions

Revision ID: 001_initial
Revises:
Create Date: 2026-04-17
"""
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID
from alembic import op

revision:       str                     = "001_initial"
down_revision:  Union[str, None]        = None
branch_labels:  Union[str, Sequence[str], None] = None
depends_on:     Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "merchants",
        sa.Column("id",              UUID(as_uuid=False), primary_key=True),
        sa.Column("email",           sa.String(255),      nullable=False, unique=True),
        sa.Column("name",            sa.String(255),      nullable=False),
        sa.Column("password_hash",   sa.String(255),      nullable=False),
        sa.Column("api_key",         sa.String(255),      nullable=False, unique=True),
        sa.Column("hs_merchant_id",  sa.String(255),      nullable=True),
        sa.Column("created_at",      sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at",      sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()),
    )
    op.create_index("ix_merchants_email",   "merchants", ["email"],   unique=True)
    op.create_index("ix_merchants_api_key", "merchants", ["api_key"], unique=True)

    op.create_table(
        "checkout_sessions",
        sa.Column("id",              sa.String(255),      primary_key=True),
        sa.Column("merchant_id",     UUID(as_uuid=False), sa.ForeignKey("merchants.id"), nullable=False),
        sa.Column("payment_id",      sa.String(255),      nullable=True),
        sa.Column("status",          sa.String(50),       nullable=False, server_default="pending"),
        sa.Column("currency",        sa.String(10),       nullable=False, server_default="USD"),
        sa.Column("amount_subtotal", sa.Integer(),        nullable=False),
        sa.Column("amount_tax",      sa.Integer(),        nullable=False, server_default="0"),
        sa.Column("amount_total",    sa.Integer(),        nullable=False),
        sa.Column("customer_id",     sa.String(255),      nullable=True),
        sa.Column("customer_email",  sa.String(255),      nullable=True),
        sa.Column("success_url",     sa.Text(),           nullable=False),
        sa.Column("cancel_url",      sa.Text(),           nullable=True),
        sa.Column("metadata",        JSONB(),             nullable=True),
        sa.Column("tax_breakdown",   JSONB(),             nullable=True),
        sa.Column("failure_reason",  sa.Text(),           nullable=True),
        sa.Column("completed_at",    sa.DateTime(timezone=True), nullable=True),
        sa.Column("expires_at",      sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at",      sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at",      sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_checkout_sessions_merchant_id", "checkout_sessions", ["merchant_id"])
    op.create_index("ix_checkout_sessions_payment_id",  "checkout_sessions", ["payment_id"])
    op.create_index("ix_checkout_sessions_status",      "checkout_sessions", ["status"])


def downgrade() -> None:
    op.drop_table("checkout_sessions")
    op.drop_table("merchants")
