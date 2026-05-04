"""Add shielded_checkout_mapping for MoR compliance audit trail

Revision ID: 004_shielded_checkout_mapping
Revises: 003_auditor_compliance
Create Date: 2026-05-04 10:00:00.000000

This migration adds:
- shielded_checkout_mapping: Links nullifiers to Polar checkout sessions for compliance auditors
  Allows tax authorities to trace shielded transactions back to merchant sessions
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '004_shielded_checkout_mapping'
down_revision = '003_auditor_compliance'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create shielded_checkout_mapping table
    # Links nullifier (ZK proof identifier) to Polar session ID (merchant's checkout reference)
    op.create_table(
        'shielded_checkout_mapping',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.func.gen_random_uuid(), nullable=False),
        sa.Column('nullifier', sa.String(66), nullable=False, unique=True, index=True),
        sa.Column('polar_session_id', sa.String(255), nullable=False, index=True),
        sa.Column('merchant_id', sa.String(255), nullable=False, index=True),
        sa.Column('amount_decrypted_cents', sa.Integer(), nullable=False),
        sa.Column('jurisdiction', sa.String(10), nullable=False),  # e.g., 'US_CA', 'GB', 'DE'
        sa.Column('tax_amount_cents', sa.Integer(), nullable=False),
        sa.Column('audit_timestamp', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()),
        sa.PrimaryKeyConstraint('id'),
        sa.Index('ix_shielded_mapping_nullifier', 'nullifier'),
        sa.Index('ix_shielded_mapping_polar_session', 'polar_session_id'),
        sa.Index('ix_shielded_mapping_merchant', 'merchant_id'),
        sa.Index('ix_shielded_mapping_audit_timestamp', 'audit_timestamp'),
    )


def downgrade() -> None:
    op.drop_table('shielded_checkout_mapping')
