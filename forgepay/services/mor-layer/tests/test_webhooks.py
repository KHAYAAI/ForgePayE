"""
Tests for the Hyperswitch webhook handler (POST /v1/webhooks/hyperswitch).

Verifies:
  1. Valid signatures are accepted
  2. Invalid signatures return 401
  3. payment.succeeded events are processed
  4. payment.failed events are handled
  5. Unknown event types return 200 (don't crash)
"""

import hashlib
import hmac
import json

import pytest
import respx
import httpx
from httpx import AsyncClient


def _make_signature(payload: bytes, secret: str) -> str:
    sig = hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()
    return f"sha256={sig}"


WEBHOOK_SECRET = "test_webhook_secret"


def _hs_event(event_type: str, payment_id: str = "pay_01TEST") -> dict:
    return {
        "event_id": "evt_01",
        "event_type": event_type,
        "merchant_id": "merch_test_01",
        "created": "2026-04-15T10:00:00Z",
        "content": {
            "object": {
                "payment_id": payment_id,
                "amount": 4900,
                "currency": "USD",
                "status": "succeeded",
                "metadata": {
                    "forgepay_session_id": "cs_abc123",
                    "forgepay_merchant_id": "merch_test_01",
                    "tax_cents": "0",
                },
            }
        },
    }


@respx.mock
@pytest.mark.asyncio
async def test_valid_webhook_accepted(client: AsyncClient):
    """Valid HMAC signature + known event type → 200 received."""
    # Mock unified-router forward
    respx.post("http://unified-router-test.local/webhooks/hyperswitch").mock(
        return_value=httpx.Response(200, json={"received": True})
    )

    payload = json.dumps(_hs_event("payment_intent.succeeded")).encode()
    sig = _make_signature(payload, WEBHOOK_SECRET)

    resp = await client.post(
        "/v1/webhooks/hyperswitch",
        content=payload,
        headers={"Content-Type": "application/json", "x-webhook-signature-512": sig},
    )

    assert resp.status_code == 200
    assert resp.json()["received"] is True


@pytest.mark.asyncio
async def test_invalid_signature_rejected(client: AsyncClient):
    """Tampered signature → 401."""
    payload = json.dumps(_hs_event("payment_intent.succeeded")).encode()

    resp = await client.post(
        "/v1/webhooks/hyperswitch",
        content=payload,
        headers={
            "Content-Type": "application/json",
            "x-webhook-signature-512": "sha256=deadbeef",
        },
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_missing_signature_rejected(client: AsyncClient):
    """No signature header → 401."""
    payload = json.dumps(_hs_event("payment_intent.succeeded")).encode()

    resp = await client.post(
        "/v1/webhooks/hyperswitch",
        content=payload,
        headers={"Content-Type": "application/json"},
    )
    assert resp.status_code in (400, 401)


@respx.mock
@pytest.mark.asyncio
async def test_unknown_event_type_accepted_gracefully(client: AsyncClient):
    """Unrecognised event types should be acked (200), not rejected."""
    respx.post("http://unified-router-test.local/webhooks/hyperswitch").mock(
        return_value=httpx.Response(200, json={"received": True})
    )
    payload = json.dumps(_hs_event("some_future_event_type")).encode()
    sig = _make_signature(payload, WEBHOOK_SECRET)

    resp = await client.post(
        "/v1/webhooks/hyperswitch",
        content=payload,
        headers={"Content-Type": "application/json", "x-webhook-signature-512": sig},
    )
    assert resp.status_code == 200


@respx.mock
@pytest.mark.asyncio
async def test_payment_failed_event_handled(client: AsyncClient):
    """payment.failed events should not crash the handler."""
    respx.post("http://unified-router-test.local/webhooks/hyperswitch").mock(
        return_value=httpx.Response(200, json={"received": True})
    )
    event = _hs_event("payment_intent.payment_failed")
    event["content"]["object"]["status"] = "failed"
    event["content"]["object"]["error_message"] = "Insufficient funds"

    payload = json.dumps(event).encode()
    sig = _make_signature(payload, WEBHOOK_SECRET)

    resp = await client.post(
        "/v1/webhooks/hyperswitch",
        content=payload,
        headers={"Content-Type": "application/json", "x-webhook-signature-512": sig},
    )
    assert resp.status_code == 200
