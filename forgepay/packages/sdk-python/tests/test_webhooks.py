"""Tests for WebhookResource — HMAC-SHA256 signature verification."""

import hashlib
import hmac
import json

import pytest

from forgepay.resources.webhooks import WebhookResource
from forgepay.errors import WebhookSignatureError

SECRET  = "whsec_test_secret"
PAYLOAD = json.dumps({
    "id": "evt_001",
    "type": "payment.succeeded",
    "api_version": "2026-04",
    "created": "2026-04-16T12:00:00Z",
    "merchant_id": "mer_001",
    "livemode": False,
    "data": {"payment_id": "pay_abc123"},
}).encode()


def sign(payload: bytes, secret: str) -> str:
    return hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()


class TestWebhookResource:
    def test_valid_signature_with_prefix(self) -> None:
        sig   = f"sha256={sign(PAYLOAD, SECRET)}"
        event = WebhookResource.construct_event(PAYLOAD, sig, SECRET)
        assert event.type == "payment.succeeded"
        assert event.data["payment_id"] == "pay_abc123"

    def test_valid_bare_hex_signature(self) -> None:
        sig   = sign(PAYLOAD, SECRET)
        event = WebhookResource.construct_event(PAYLOAD, sig, SECRET)
        assert event.id == "evt_001"

    def test_tampered_payload_rejected(self) -> None:
        sig      = f"sha256={sign(PAYLOAD, SECRET)}"
        tampered = PAYLOAD.replace(b"payment.succeeded", b"payment.failed")
        with pytest.raises(WebhookSignatureError, match="verification failed"):
            WebhookResource.construct_event(tampered, sig, SECRET)

    def test_wrong_secret_rejected(self) -> None:
        sig = f"sha256={sign(PAYLOAD, 'wrong_secret')}"
        with pytest.raises(WebhookSignatureError):
            WebhookResource.construct_event(PAYLOAD, sig, SECRET)

    def test_empty_secret_rejected(self) -> None:
        sig = f"sha256={sign(PAYLOAD, '')}"
        with pytest.raises(WebhookSignatureError, match="must not be empty"):
            WebhookResource.construct_event(PAYLOAD, sig, secret="")

    def test_malformed_signature_rejected(self) -> None:
        with pytest.raises(WebhookSignatureError):
            WebhookResource.construct_event(PAYLOAD, "sha256=notvalidhex!!", SECRET)

    def test_empty_signature_rejected(self) -> None:
        with pytest.raises(WebhookSignatureError):
            WebhookResource.construct_event(PAYLOAD, "", SECRET)

    def test_truncated_signature_rejected(self) -> None:
        sig = f"sha256={sign(PAYLOAD, SECRET)[:20]}"
        with pytest.raises(WebhookSignatureError):
            WebhookResource.construct_event(PAYLOAD, sig, SECRET)

    def test_invalid_json_payload_rejected(self) -> None:
        bad_payload = b"not json"
        sig = f"sha256={sign(bad_payload, SECRET)}"
        with pytest.raises(WebhookSignatureError, match="Invalid JSON"):
            WebhookResource.construct_event(bad_payload, sig, SECRET)
