"""Add shielded transaction support to checkout_sessions

Revision ID: 002_shielded
Revises: 001_initial
Create Date: 2026-04-24
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision:       str                     = "002_shielded"
down_revision:  Union[str, None]        = "001_initial"
branch_labels:  Union[str, Sequence[str], None] = None
depends_on:     Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add shielded transaction columns to checkout_sessions table."""
    op.add_column(
        "checkout_sessions",
        sa.Column("is_shielded", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "checkout_sessions",
        sa.Column("nullifier", sa.String(255), nullable=True),
    )
    op.add_column(
        "checkout_sessions",
        sa.Column("audit_proof", sa.Text(), nullable=True),
    )
    op.add_column(
        "checkout_sessions",
        sa.Column("audit_timestamp", sa.DateTime(timezone=True), nullable=True),
    )

    # Create index on nullifier for fast compliance lookups
    op.create_index("ix_checkout_sessions_nullifier", "checkout_sessions", ["nullifier"])


def downgrade() -> None:
    """Remove shielded transaction columns from checkout_sessions table."""
    op.drop_index("ix_checkout_sessions_nullifier", "checkout_sessions")
    op.drop_column("checkout_sessions", "audit_timestamp")
    op.drop_column("checkout_sessions", "audit_proof")
    op.drop_column("checkout_sessions", "nullifier")
    op.drop_column("checkout_sessions", "is_shielded")
