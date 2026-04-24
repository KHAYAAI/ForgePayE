"""Pydantic models for checkout sessions."""

from __future__ import annotations
from decimal import Decimal
from enum import StrEnum
from pydantic import BaseModel, Field, field_validator


class PaymentMethodType(StrEnum):
    CARD        = "card"
    BANK        = "bank_transfer"
    USDC        = "usdc"
    USDT        = "usdt"
    CRYPTO      = "crypto"


class CheckoutLineItem(BaseModel):
    name:        str
    description: str | None = None
    amount:      int                 # in cents
    currency:    str = "USD"
    quantity:    int = 1
    tax_code:    str | None = None   # e.g. "txcd_10000000" (digital services)
    metadata:    dict[str, str] = {}


class CheckoutSessionCreate(BaseModel):
    """
    Create a hosted or embedded checkout session.
    The MoR layer will create a Hyperswitch payment and return a client_secret
    for the frontend to complete using Hyperswitch.js.
    """
    merchant_id:          str
    customer_id:          str | None = None
    customer_email:       str | None = None
    line_items:           list[CheckoutLineItem] = Field(min_length=1)
    currency:             str = "USD"
    payment_methods:      list[PaymentMethodType] = [PaymentMethodType.CARD]
    success_url:          str
    cancel_url:           str
    idempotency_key:      str | None = None
    metadata:             dict[str, str] = {}
    # Tax
    collect_tax:          bool = True
    customer_country:     str | None = None    # ISO 3166-1 alpha-2
    customer_state:       str | None = None    # for US sales tax
    customer_postal_code: str | None = None

    @field_validator("currency")
    @classmethod
    def uppercase_currency(cls, v: str) -> str:
        return v.upper()


class TaxBreakdown(BaseModel):
    jurisdiction:  str          # e.g. "DE", "CA-BC"
    tax_type:      str          # "VAT", "GST", "SALES_TAX"
    rate:          Decimal
    amount:        int          # cents
    inclusive:     bool = False


class CheckoutSessionResponse(BaseModel):
    """Returned to the frontend to mount Hyperswitch.js checkout."""
    session_id:           str
    status:               str = "pending"   # pending | completed | expired | cancelled
    payment_id:           str
    client_secret:        str | None = None  # present on create, absent on retrieve
    publishable_key:      str
    amount_subtotal:      int
    amount_tax:           int
    amount_total:         int
    currency:             str
    tax_breakdown:        list[TaxBreakdown] = []
    expires_at:           str
    success_url:          str
    cancel_url:           str | None = None


class CheckoutSessionRetrieve(BaseModel):
    session_id:  str
    status:      str
    payment_id:  str
    amount_paid: int | None = None
    currency:    str
    metadata:    dict[str, str] = {}


class ShieldedCheckoutSessionCreate(BaseModel):
    """
    Create a shielded (privacy-preserving) checkout session.

    Instead of plain line items, the client sends an encrypted memo and optional ZK proof.
    The auditor decrypts the memo to compute taxes without revealing the plaintext to the merchant.

    Flow:
      1. Verify JWT (same as regular checkout)
      2. Verify ZK proof (Groth16 on BN254)
      3. Decrypt memo via AuditorClient (only auditor can do this)
      4. Check nullifier not in frozen set
      5. Compute tax on decrypted amount
      6. Create Hyperswitch payment intent with decrypted amount + tax
      7. Store session with nullifier + proof for compliance audit
    """
    merchant_id:          str
    customer_id:          str | None = None
    customer_email:       str | None = None
    encrypted_memo:       str                 # base64-encoded encrypted transaction data
    audit_proof:          str | None = None   # base64-encoded Groth16 proof (optional for phase 2)
    currency:             str = "USD"
    payment_methods:      list[PaymentMethodType] = [PaymentMethodType.CARD]
    success_url:          str
    cancel_url:           str
    idempotency_key:      str | None = None
    metadata:             dict[str, str] = {}
    # Tax jurisdiction (decryption reveals amount, but jurisdiction tells tax calculator)
    customer_country:     str | None = None    # ISO 3166-1 alpha-2
    customer_state:       str | None = None    # for US sales tax
    customer_postal_code: str | None = None

    @field_validator("currency")
    @classmethod
    def uppercase_currency(cls, v: str) -> str:
        return v.upper()
