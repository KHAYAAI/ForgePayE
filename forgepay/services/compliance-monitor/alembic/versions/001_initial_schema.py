"""Initial schema: sars, ctrs, kyc_records, aml_alerts

This service has never had a database before -- there is no prior migration
history to chain onto. Columns use SQLAlchemy's generic JSON type (not
Postgres JSONB) so the same schema is portable to sqlite, which the test
suite uses (see tests/conftest.py).

Revision ID: 001_initial
Revises:
Create Date: 2026-09-23
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision:       str                     = "001_initial"
down_revision:  Union[str, None]        = None
branch_labels:  Union[str, Sequence[str], None] = None
depends_on:     Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "sars",
        sa.Column("id",                        sa.String(36),  primary_key=True),
        sa.Column("merchant_id",                sa.String(255), nullable=False),
        sa.Column("transaction_ids",            sa.JSON(),      nullable=False),
        sa.Column("filing_type",                sa.String(50),  nullable=False, server_default="initial"),
        sa.Column("status",                     sa.String(30),  nullable=False, server_default="draft"),
        sa.Column("activity_description",       sa.Text(),      nullable=False),
        sa.Column("suspicious_activity_type",   sa.JSON(),      nullable=False),
        sa.Column("total_amount",               sa.Float(),     nullable=False, server_default="0"),
        sa.Column("activity_start_date",        sa.String(32),  nullable=False),
        sa.Column("activity_end_date",          sa.String(32),  nullable=False),
        sa.Column("created_at",                 sa.String(64),  nullable=False),
        sa.Column("submitted_at",               sa.String(64),  nullable=True),
        sa.Column("fincen_acknowledgement_id",  sa.String(255), nullable=True),
    )
    op.create_index("ix_sars_merchant_id", "sars", ["merchant_id"])
    op.create_index("ix_sars_status",      "sars", ["status"])

    op.create_table(
        "ctrs",
        sa.Column("id",                sa.String(36),  primary_key=True),
        sa.Column("merchant_id",       sa.String(255), nullable=False),
        sa.Column("transaction_id",    sa.String(255), nullable=False),
        sa.Column("amount",            sa.Float(),     nullable=False),
        sa.Column("currency",          sa.String(10),  nullable=False),
        sa.Column("transaction_date",  sa.String(32),  nullable=False),
        sa.Column("filing_status",     sa.String(20),  nullable=False, server_default="pending"),
        sa.Column("created_at",        sa.String(64),  nullable=False),
    )
    op.create_index("ix_ctrs_merchant_id",    "ctrs", ["merchant_id"])
    op.create_index("ix_ctrs_transaction_id", "ctrs", ["transaction_id"])
    op.create_index("ix_ctrs_filing_status",  "ctrs", ["filing_status"])

    op.create_table(
        "kyc_records",
        sa.Column("entity_id",           sa.String(255), primary_key=True),
        sa.Column("entity_type",         sa.String(50),  nullable=False),
        sa.Column("status",              sa.String(30),  nullable=False),
        sa.Column("risk_level",          sa.String(20),  nullable=False),
        sa.Column("verified_at",         sa.String(64),  nullable=True),
        sa.Column("expires_at",          sa.String(64),  nullable=True),
        sa.Column("documents_provided",  sa.JSON(),      nullable=False),
        sa.Column("aml_risk_factors",    sa.JSON(),      nullable=False),
        sa.Column("last_reviewed_at",    sa.String(64),  nullable=False),
        sa.Column("reviewer_notes",      sa.Text(),      nullable=True),
    )
    op.create_index("ix_kyc_records_status",     "kyc_records", ["status"])
    op.create_index("ix_kyc_records_expires_at", "kyc_records", ["expires_at"])

    op.create_table(
        "aml_alerts",
        sa.Column("id",                sa.String(36),  primary_key=True),
        sa.Column("transaction_id",    sa.String(255), nullable=False),
        sa.Column("merchant_id",       sa.String(255), nullable=False),
        sa.Column("amount",            sa.Float(),     nullable=False),
        sa.Column("currency",          sa.String(10),  nullable=False),
        sa.Column("evaluated_at",      sa.String(64),  nullable=False),
        sa.Column("rules_triggered",   sa.JSON(),      nullable=False),
        sa.Column("risk_score",        sa.Integer(),   nullable=False),
        sa.Column("decision",          sa.String(20),  nullable=False),
        sa.Column("requires_sar",      sa.Boolean(),   nullable=False, server_default=sa.false()),
    )
    op.create_index("ix_aml_alerts_transaction_id", "aml_alerts", ["transaction_id"])
    op.create_index("ix_aml_alerts_merchant_id",    "aml_alerts", ["merchant_id"])
    op.create_index("ix_aml_alerts_evaluated_at",   "aml_alerts", ["evaluated_at"])


def downgrade() -> None:
    op.drop_table("aml_alerts")
    op.drop_table("kyc_records")
    op.drop_table("ctrs")
    op.drop_table("sars")
