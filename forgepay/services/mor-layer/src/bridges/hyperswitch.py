"""
Hyperswitch API bridge.

This module is the CORE of the Polar → Hyperswitch migration.
Every payment call that Polar originally made to Stripe now routes here.

Polar's original pattern:
    stripe.PaymentIntent.create(amount=..., currency=..., customer=...)

ForgePay replacement:
    await hyperswitch.create_payment(amount=..., currency=..., customer_id=...)

The Hyperswitch REST API is intentionally Stripe-compatible in many places,
so the mapping is clean.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
from typing import Any

import httpx
from pydantic import BaseModel

from src.config import get_settings

logger = logging.getLogger(__name__)


# ── Request / Response models ─────────────────────────────────────────────────

class PaymentCreateRequest(BaseModel):
    """Maps to Hyperswitch POST /payments."""
    amount:               int                           # in smallest currency unit (cents)
    currency:             str                           # ISO 4217
    confirm:              bool        = False           # confirm immediately?
    capture_method:       str         = "automatic"    # automatic | manual
    customer_id:          str | None  = None
    description:          str | None  = None
    return_url:           str | None  = None
    metadata:             dict[str, str] = {}
    statement_descriptor: str | None  = None
    payment_method_type:  str | None  = None           # card | bank_transfer | etc.
    idempotency_key:      str | None  = None


class PaymentResponse(BaseModel):
    payment_id:    str
    status:        str
    amount:        int
    currency:      str
    client_secret: str | None = None
    customer_id:   str | None = None
    next_action:   dict[str, Any] | None = None
    error_code:    str | None = None
    error_message: str | None = None


class RefundCreateRequest(BaseModel):
    payment_id: str
    amount:     int | None = None    # None = full refund
    reason:     str | None = None
    metadata:   dict[str, str] = {}


class CustomerCreateRequest(BaseModel):
    """Maps to Hyperswitch POST /customers."""
    merchant_reference_id: str          # ForgePay merchant's customer ID
    email:                 str | None = None
    name:                  str | None = None
    phone:                 str | None = None
    description:           str | None = None
    metadata:              dict[str, str] = {}


class CustomerResponse(BaseModel):
    customer_id:           str
    merchant_reference_id: str | None = None
    email:                 str | None = None
    name:                  str | None = None
    created_at:            str | None = None


# ── Client ────────────────────────────────────────────────────────────────────

class HyperswitchClient:
    """
    Async HTTP client for the Hyperswitch payment engine.
    One instance per tenant (scoped to a merchant's API key).
    """

    def __init__(self, api_key: str | None = None) -> None:
        settings = get_settings()
        self._base_url = settings.hyperswitch_base_url.rstrip("/")
        self._api_key  = api_key or settings.hyperswitch_api_key
        self._client   = httpx.AsyncClient(
            base_url=self._base_url,
            timeout=httpx.Timeout(30.0),
            headers={
                "api-key":    self._api_key,
                "Content-Type": "application/json",
                "User-Agent": "ForgePay-MoR/2026-04",
            },
        )

    # ── Payments ──────────────────────────────────────────────────────────

    async def create_payment(self, req: PaymentCreateRequest) -> PaymentResponse:
        """
        Create a payment intent.
        This directly replaces stripe.PaymentIntent.create().
        """
        payload: dict[str, Any] = {
            "amount":         req.amount,
            "currency":       req.currency.upper(),
            "confirm":        req.confirm,
            "capture_method": req.capture_method,
            "metadata":       req.metadata,
        }
        if req.customer_id:
            payload["customer_id"] = req.customer_id
        if req.description:
            payload["description"] = req.description
        if req.return_url:
            payload["return_url"] = req.return_url
        if req.statement_descriptor:
            payload["statement_descriptor"] = req.statement_descriptor
        if req.payment_method_type:
            payload["payment_method_type"] = req.payment_method_type

        headers: dict[str, str] = {}
        if req.idempotency_key:
            headers["x-idempotency-key"] = req.idempotency_key

        response = await self._client.post("/payments", json=payload, headers=headers)
        response.raise_for_status()
        return PaymentResponse.model_validate(response.json())

    async def retrieve_payment(self, payment_id: str) -> PaymentResponse:
        response = await self._client.get(f"/payments/{payment_id}")
        response.raise_for_status()
        return PaymentResponse.model_validate(response.json())

    async def confirm_payment(
        self,
        payment_id: str,
        payment_method_data: dict[str, Any],
        return_url: str | None = None,
    ) -> PaymentResponse:
        """Confirm a payment with payment method data (from Hyperswitch.js SDK)."""
        payload: dict[str, Any] = {"payment_method_data": payment_method_data}
        if return_url:
            payload["return_url"] = return_url

        response = await self._client.post(f"/payments/{payment_id}/confirm", json=payload)
        response.raise_for_status()
        return PaymentResponse.model_validate(response.json())

    async def cancel_payment(self, payment_id: str, reason: str | None = None) -> PaymentResponse:
        payload: dict[str, Any] = {}
        if reason:
            payload["cancellation_reason"] = reason
        response = await self._client.post(f"/payments/{payment_id}/cancel", json=payload)
        response.raise_for_status()
        return PaymentResponse.model_validate(response.json())

    async def create_refund(self, req: RefundCreateRequest) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "payment_id": req.payment_id,
            "metadata":   req.metadata,
        }
        if req.amount is not None:
            payload["amount"] = req.amount
        if req.reason:
            payload["reason"] = req.reason
        response = await self._client.post("/refunds", json=payload)
        response.raise_for_status()
        return dict(response.json())

    # ── Customers ─────────────────────────────────────────────────────────

    async def create_customer(self, req: CustomerCreateRequest) -> CustomerResponse:
        """
        Create a Hyperswitch customer.
        This replaces stripe.Customer.create().
        """
        payload: dict[str, Any] = {
            "merchant_reference_id": req.merchant_reference_id,
            "metadata": req.metadata,
        }
        if req.email:       payload["email"]       = req.email
        if req.name:        payload["name"]         = req.name
        if req.phone:       payload["phone"]        = req.phone
        if req.description: payload["description"]  = req.description

        response = await self._client.post("/customers", json=payload)
        response.raise_for_status()
        return CustomerResponse.model_validate(response.json())

    async def retrieve_customer(self, customer_id: str) -> CustomerResponse:
        response = await self._client.get(f"/customers/{customer_id}")
        response.raise_for_status()
        return CustomerResponse.model_validate(response.json())

    async def list_payment_methods(self, customer_id: str) -> list[dict[str, Any]]:
        response = await self._client.get(f"/customers/{customer_id}/payment_methods")
        response.raise_for_status()
        data: dict[str, Any] = response.json()
        return list(data.get("customer_payment_methods", []))

    # ── Cleanup ───────────────────────────────────────────────────────────

    async def close(self) -> None:
        await self._client.aclose()


# ── Webhook verification ──────────────────────────────────────────────────────

def verify_hyperswitch_webhook(
    payload_bytes: bytes,
    signature_header: str,
    secret: str,
) -> bool:
    """
    Verify a Hyperswitch webhook signature (HMAC-SHA256).
    Replaces stripe.Webhook.construct_event().
    """
    if not secret:
        logger.warning("Hyperswitch webhook secret not configured — skipping verification")
        return False

    expected = hmac.new(
        secret.encode(),
        payload_bytes,
        hashlib.sha256,
    ).hexdigest()

    # Hyperswitch sends "sha256=<hex>" format
    actual = signature_header.removeprefix("sha256=")

    return hmac.compare_digest(expected, actual)


# ── Singleton factory (dependency injection) ──────────────────────────────────

_default_client: HyperswitchClient | None = None


def get_hyperswitch_client() -> HyperswitchClient:
    """FastAPI dependency — returns a shared async client."""
    global _default_client
    if _default_client is None:
        _default_client = HyperswitchClient()
    return _default_client
