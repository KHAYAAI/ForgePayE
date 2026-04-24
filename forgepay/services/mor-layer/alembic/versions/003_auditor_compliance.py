"""Add auditor compliance and key rotation tracking

Revision ID: 003_auditor_compliance
Revises: 002_add_shielded_transactions
Create Date: 2026-04-24 14:00:00.000000

This migration adds:
- frozen_nullifiers: Track which UTXOs are frozen by auditor (compliance holds, sanctions)
- auditor_keys: Track auditor keypair rotation history for audit trails
- auditor_key_rotation_log: Immutable log of all key rotations
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '003_auditor_compliance'
down_revision = '002_add_shielded_transactions'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create frozen_nullifiers table
    # This table tracks which nullifiers have been frozen by the auditor
    # (e.g., for sanctions, fraud, or compliance reasons)
    op.create_table(
        'frozen_nullifiers',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('nullifier', sa.String(256), nullable=False, unique=True, index=True),
        sa.Column('reason', sa.String(256), nullable=False),
        sa.Column('reason_code', sa.Enum(
            'SANCTIONS', 'FRAUD', 'AML_VIOLATION', 'TAX_EVASION', 'CUSTOMER_REQUEST', 'OTHER',
            name='freeze_reason_enum'
        ), nullable=False),
        sa.Column('frozen_by', sa.String(256), nullable=False),  # Auditor public key or admin ID
        sa.Column('frozen_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),  # Optional: auto-unfreeze
        sa.Column('metadata', postgresql.JSONB(), nullable=True),  # Additional context
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()),
        sa.PrimaryKeyConstraint('id'),
        sa.Index('ix_frozen_nullifiers_nullifier', 'nullifier'),
        sa.Index('ix_frozen_nullifiers_reason_code', 'reason_code'),
        sa.Index('ix_frozen_nullifiers_frozen_at', 'frozen_at'),
    )

    # Create auditor_keys table
    # Tracks current and historical auditor keypairs
    op.create_table(
        'auditor_keys',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('key_version', sa.Integer(), nullable=False, unique=True, index=True),
        sa.Column('public_key', sa.String(256), nullable=False, unique=True, index=True),
        sa.Column('secret_key_vault_path', sa.String(512), nullable=False),  # Path in Vault
        sa.Column('status', sa.Enum('ACTIVE', 'ROTATING', 'INACTIVE', name='key_status_enum'),
                  server_default='ACTIVE', nullable=False),
        sa.Column('rotation_reason', sa.String(256), nullable=True),
        sa.Column('rotated_by', sa.String(256), nullable=True),
        sa.Column('activated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('deactivated_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()),
        sa.PrimaryKeyConstraint('id'),
        sa.Index('ix_auditor_keys_status', 'status'),
        sa.Index('ix_auditor_keys_key_version', 'key_version'),
    )

    # Create auditor_key_rotation_log table
    # Immutable append-only log of all key rotation events (compliance audit trail)
    op.create_table(
        'auditor_key_rotation_log',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('event_id', postgresql.UUID(as_uuid=True), server_default=sa.func.gen_random_uuid(), unique=True),
        sa.Column('old_key_version', sa.Integer(), nullable=False),
        sa.Column('new_key_version', sa.Integer(), nullable=False),
        sa.Column('rotation_reason', sa.String(512), nullable=False),
        sa.Column('initiated_by', sa.String(256), nullable=False),  # User/system that triggered rotation
        sa.Column('approved_by', sa.String(256), nullable=True),  # Approval chain
        sa.Column('effective_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('metadata', postgresql.JSONB(), nullable=True),  # Rotation details, timing, etc.
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.Index('ix_audit_key_rotation_event_id', 'event_id'),
        sa.Index('ix_audit_key_rotation_effective_at', 'effective_at'),
        sa.Index('ix_audit_key_rotation_initiated_by', 'initiated_by'),
    )

    # Add index to checkout_sessions for faster frozen nullifier lookups
    op.execute("""
        CREATE INDEX ix_checkout_sessions_is_frozen
        ON checkout_sessions(is_shielded, nullifier)
        WHERE is_shielded = true AND nullifier IS NOT NULL
    """)


def downgrade() -> None:
    # Drop tables in reverse order (respecting foreign keys)
    op.execute("DROP INDEX IF EXISTS ix_checkout_sessions_is_frozen")
    op.drop_table('auditor_key_rotation_log')
    op.drop_table('auditor_keys')
    op.drop_table('frozen_nullifiers')
    op.execute("DROP TYPE IF EXISTS freeze_reason_enum")
    op.execute("DROP TYPE IF EXISTS key_status_enum")
