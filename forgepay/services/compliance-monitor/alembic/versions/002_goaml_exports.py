"""goAML export log: officer-approved FIC report drafts (never filings).

Revision ID: 002_goaml_exports
Revises: 001_initial
"""
from typing import Union

import sqlalchemy as sa
from alembic import op

revision: str = "002_goaml_exports"
down_revision: Union[str, None] = "001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "goaml_exports",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("report_code", sa.String(10), nullable=False),
        sa.Column("source_id", sa.String(36), nullable=False),
        sa.Column("xml", sa.Text(), nullable=False),
        sa.Column("approved_by", sa.String(255), nullable=False),
        sa.Column("approved_by_principal", sa.String(255), nullable=False),
        sa.Column("created_at", sa.String(64), nullable=False),
    )
    op.create_index("ix_goaml_exports_source_id", "goaml_exports", ["source_id"])


def downgrade() -> None:
    op.drop_index("ix_goaml_exports_source_id", table_name="goaml_exports")
    op.drop_table("goaml_exports")
