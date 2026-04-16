"""
ForgePay Python SDK.

Quick start::

    import forgepay

    fp = forgepay.ForgePay(api_key="sk_live_...")

    # Create a payment
    payment = fp.payments.create(
        amount=4900,
        currency="USD",
        payment_method_data={"type": "card", "card": {...}},
    )

    # Verify a webhook
    event = forgepay.WebhookResource.construct_event(
        payload=raw_bytes,
        signature=request.headers["X-ForgePay-Signature"],
        secret="whsec_...",
    )

Async usage::

    async with forgepay.AsyncForgePay(api_key="sk_live_...") as fp:
        payment = await fp.payments.create(amount=4900, currency="USD", ...)
"""

from forgepay.client import ForgePay, AsyncForgePay
from forgepay.errors import (
    ForgePayError,
    AuthenticationError,
    InvalidRequestError,
    RateLimitError,
    ServiceUnavailableError,
)

__all__ = [
    "ForgePay",
    "AsyncForgePay",
    "ForgePayError",
    "AuthenticationError",
    "InvalidRequestError",
    "RateLimitError",
    "ServiceUnavailableError",
]

__version__ = "0.1.0"
