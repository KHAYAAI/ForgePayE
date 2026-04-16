"""Webhook signature verification — mirrors WebhookResource in the JS SDK."""

from __future__ import annotations

import hashlib
import hmac

from forgepay.errors import WebhookSignatureError
from forgepay.types import ForgePayEvent


class WebhookResource:
    """
    Verify and parse incoming ForgePay webhook payloads.

    Usage::

        event = WebhookResource.construct_event(
            payload=request.body,
            signature=request.headers["X-ForgePay-Signature"],
            secret="whsec_...",
        )
        if event.type == "payment.succeeded":
            fulfill_order(event.data["payment_id"])
    """

    @staticmethod
    def construct_event(
        payload:   bytes,
        signature: str,
        secret:    str,
    ) -> ForgePayEvent:
        """
        Verify the HMAC-SHA256 signature and return a parsed `ForgePayEvent`.

        The signature may be bare hex or prefixed with ``sha256=``.
        Raises `WebhookSignatureError` if verification fails.
        """
        if not secret:
            raise WebhookSignatureError("Webhook secret must not be empty")

        actual_hex = signature.removeprefix("sha256=")
        expected   = hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()

        try:
            actual_bytes   = bytes.fromhex(actual_hex)
            expected_bytes = bytes.fromhex(expected)
        except ValueError:
            raise WebhookSignatureError("Malformed signature — expected hex string")

        if len(actual_bytes) != len(expected_bytes):
            raise WebhookSignatureError("Signature length mismatch")

        if not hmac.compare_digest(actual_bytes, expected_bytes):
            raise WebhookSignatureError("Signature verification failed")

        import json

        try:
            data = json.loads(payload)
        except json.JSONDecodeError as exc:
            raise WebhookSignatureError(f"Invalid JSON payload: {exc}") from exc

        return ForgePayEvent.model_validate(data)
