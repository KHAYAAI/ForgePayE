"""
Bridge: MoR Layer → Hyperswitch payment engine.

The mor-layer (Polar fork) previously used its own Stripe integration.
This module replaces that with calls to Hyperswitch so all card payments
flow through our self-hosted payment router.

Note: settings are loaded from src.config (the canonical config module for
this service). The MOR_HYPERSWITCH_BASE_URL and MOR_HYPERSWITCH_API_KEY
environment variables control the connection.
"""

import httpx
from dataclasses import dataclass
from typing import Optional
from src.config import get_settings


@dataclass
class PaymentRequest:
    amount: int              # in smallest currency unit (cents)
    currency: str            # ISO 4217 e.g. "USD"
    customer_id: str
    payment_method_data: dict
    idempotency_key: str
    metadata: Optional[dict] = None
    description: Optional[str] = None
    return_url: Optional[str] = None


@dataclass
class PaymentResponse:
    payment_id: str
    client_secret: str
    status: str              # created | processing | succeeded | failed
    amount: int
    currency: str
    next_action: Optional[dict] = None


class HyperswitchBridge:
    """
    Async client for the Hyperswitch payment engine API.

    This is a thin gateway adapter used by the checkout flow.
    For the full-featured client (customer management, webhooks, etc.)
    see src/bridges/hyperswitch.py (HyperswitchClient).

    Usage:
        bridge = HyperswitchBridge()
        resp = await bridge.create_payment(req)
    """

    def __init__(self) -> None:
        settings = get_settings()
        self._base_url = settings.hyperswitch_base_url.rstrip("/")
        self._api_key  = settings.hyperswitch_api_key

    async def create_payment(self, req: PaymentRequest) -> PaymentResponse:
        async with httpx.AsyncClient(base_url=self._base_url, timeout=30.0) as client:
            payload = {
                "amount":                req.amount,
                "currency":              req.currency.upper(),
                "customer_id":           req.customer_id,
                "payment_method":        "card",
                "payment_method_data":   req.payment_method_data,
                "description":           req.description,
                "return_url":            req.return_url,
                "metadata":              req.metadata or {},
                "confirm":               True,
            }
            r = await client.post(
                "/payments",
                json=payload,
                headers={
                    "api-key":         self._api_key,
                    "Idempotency-Key": req.idempotency_key,
                    "Content-Type":    "application/json",
                },
            )
            r.raise_for_status()
            data = r.json()

            return PaymentResponse(
                payment_id=    data.get("payment_id", ""),
                client_secret= data.get("client_secret", ""),
                status=        data.get("status", "created"),
                amount=        data.get("amount", req.amount),
                currency=      data.get("currency", req.currency),
                next_action=   data.get("next_action"),
            )

    async def retrieve_payment(self, payment_id: str) -> PaymentResponse:
        async with httpx.AsyncClient(base_url=self._base_url, timeout=30.0) as client:
            r = await client.get(
                f"/payments/{payment_id}",
                headers={"api-key": self._api_key},
            )
            r.raise_for_status()
            data = r.json()
            return PaymentResponse(
                payment_id=    data.get("payment_id", payment_id),
                client_secret= data.get("client_secret", ""),
                status=        data.get("status", "created"),
                amount=        data.get("amount", 0),
                currency=      data.get("currency", "USD"),
                next_action=   data.get("next_action"),
            )

    async def refund_payment(self, payment_id: str, amount: int, reason: Optional[str] = None) -> dict:
        async with httpx.AsyncClient(base_url=self._base_url, timeout=30.0) as client:
            r = await client.post(
                "/refunds",
                json={
                    "payment_id": payment_id,
                    "amount":     amount,
                    "reason":     reason or "requested_by_customer",
                },
                headers={"api-key": self._api_key, "Content-Type": "application/json"},
            )
            r.raise_for_status()
            return r.json()
