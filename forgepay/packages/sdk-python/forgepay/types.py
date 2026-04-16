"""Pydantic v2 models for all ForgePay API resources."""

from __future__ import annotations

from typing import Any, Generic, Literal, TypeVar

from pydantic import BaseModel, Field

# ── Shared ────────────────────────────────────────────────────────────────────

T = TypeVar("T")


class ListResponse(BaseModel, Generic[T]):
    data:   list[T]
    count:  int
    total:  int | None = None
    cursor: str | None = None


# ── Payments ──────────────────────────────────────────────────────────────────

PaymentStatus = Literal[
    "requires_payment_method",
    "requires_confirmation",
    "requires_action",
    "processing",
    "succeeded",
    "failed",
    "cancelled",
    "partially_captured",
    "partially_captured_and_capturable",
]


class CardDetails(BaseModel):
    last4:     str
    brand:     str
    exp_month: int
    exp_year:  int


class PaymentMethodData(BaseModel):
    type: str
    card: CardDetails | None = None


class Payment(BaseModel):
    payment_id:          str
    merchant_id:         str
    status:              PaymentStatus
    amount:              int
    currency:            str
    customer_id:         str | None         = None
    description:         str | None         = None
    payment_method:      str | None         = None
    payment_method_data: PaymentMethodData | None = None
    client_secret:       str | None         = None
    created:             str
    metadata:            dict[str, Any]     = Field(default_factory=dict)


class PaymentCreateParams(BaseModel):
    amount:              int
    currency:            str
    payment_method_data: dict[str, Any] | None = None
    customer_id:         str | None            = None
    description:         str | None            = None
    capture_method:      str | None            = None
    confirm:             bool                  = False
    return_url:          str | None            = None
    metadata:            dict[str, Any]        = Field(default_factory=dict)
    idempotency_key:     str | None            = None


# ── Refunds ───────────────────────────────────────────────────────────────────

class Refund(BaseModel):
    refund_id:  str
    payment_id: str
    amount:     int
    currency:   str
    status:     str
    created:    str
    reason:     str | None = None


# ── Customers ─────────────────────────────────────────────────────────────────

class Customer(BaseModel):
    customer_id: str
    email:       str | None = None
    name:        str | None = None
    phone:       str | None = None
    metadata:    dict[str, Any] = Field(default_factory=dict)
    created:     str


class CustomerCreateParams(BaseModel):
    customer_id: str | None = None
    email:       str | None = None
    name:        str | None = None
    phone:       str | None = None
    metadata:    dict[str, Any] = Field(default_factory=dict)


# ── Subscriptions ─────────────────────────────────────────────────────────────

class Subscription(BaseModel):
    subscription_id:    str
    customer_id:        str
    plan_id:            str
    status:             str
    current_period_end: str
    start_date:         str
    cancelled_date:     str | None = None
    metadata:           dict[str, Any] = Field(default_factory=dict)


class SubscriptionCreateParams(BaseModel):
    customer_id:     str
    plan_id:         str
    trial_days:      int | None = None
    metadata:        dict[str, Any] = Field(default_factory=dict)
    idempotency_key: str | None = None


# ── Plans ─────────────────────────────────────────────────────────────────────

class PlanAmount(BaseModel):
    amount:   int
    currency: str
    interval: str  # "month" | "year" | "week" | "day"


class Plan(BaseModel):
    plan_id:     str
    name:        str
    amount:      PlanAmount
    trial_days:  int     = 0
    active:      bool    = True
    metadata:    dict[str, Any] = Field(default_factory=dict)


# ── Usage Records ─────────────────────────────────────────────────────────────

class UsageRecord(BaseModel):
    record_id:       str
    subscription_id: str
    quantity:        int
    action:          str  # "set" | "increment"
    timestamp:       str


class UsageReportParams(BaseModel):
    subscription_id: str
    quantity:        int
    action:          Literal["set", "increment"] = "increment"
    timestamp:       str | None = None
    idempotency_key: str | None = None


# ── Stablecoin Payments ───────────────────────────────────────────────────────

StablecoinNetwork = Literal["ethereum", "solana", "polygon", "base", "arbitrum"]
StablecoinCoin    = Literal["USDC", "USDT"]


class StablecoinPayment(BaseModel):
    payment_id:    str
    coin:          StablecoinCoin
    network:       StablecoinNetwork
    amount:        str   # Decimal string, e.g. "49.00"
    address:       str   # Destination wallet address
    tx_hash:       str | None = None
    status:        str
    expires_at:    str
    created:       str


class StablecoinCreateParams(BaseModel):
    coin:            StablecoinCoin
    network:         StablecoinNetwork
    amount_usd:      str
    customer_id:     str | None = None
    expires_in:      int | None = None   # seconds, default 900
    metadata:        dict[str, Any] = Field(default_factory=dict)
    idempotency_key: str | None = None


# ── Crypto Payments ───────────────────────────────────────────────────────────

CryptoCoin = Literal["BTC", "ETH", "LTC", "XMR"]


class CryptoPayment(BaseModel):
    payment_id:   str
    coin:         CryptoCoin
    amount:       str   # In coin units, e.g. "0.00124"
    amount_usd:   str
    address:      str
    qr_code_url:  str | None = None
    tx_hash:      str | None = None
    confirmations: int       = 0
    status:       str
    expires_at:   str
    created:      str


class CryptoCreateParams(BaseModel):
    coin:            CryptoCoin
    amount_usd:      str
    customer_id:     str | None = None
    expires_in:      int | None = None
    metadata:        dict[str, Any] = Field(default_factory=dict)
    idempotency_key: str | None = None


# ── Webhooks ──────────────────────────────────────────────────────────────────

class ForgePayEvent(BaseModel):
    id:             str
    type:           str
    api_version:    str
    created:        str
    data:           dict[str, Any]
    merchant_id:    str
    livemode:       bool = False
