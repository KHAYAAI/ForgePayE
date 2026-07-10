"""
Unit tests for the Hyperswitch bridge (src/bridges/hyperswitch.py).

Uses respx to mock Hyperswitch HTTP responses without real network calls.
Tests cover the critical Polar → Hyperswitch migration paths.
"""

import hashlib
import hmac
import json

import httpx
import pytest
import respx

from src.bridges.hyperswitch import (
    CustomerCreateRequest,
    HyperswitchClient,
    PaymentCreateRequest,
    RefundCreateRequest,
    verify_hyperswitch_webhook,
)


# ── Fixtures ──────────────────────────────────────────────────────────────────

MOCK_BASE = "http://hyperswitch-test.local"

PAYMENT_RESPONSE = {
    "payment_id": "pay_01HZTEST",
    "status": "requires_confirmation",
    "amount": 4900,
    "currency": "USD",
    "client_secret": "pay_01HZTEST_secret_abc123",
    "customer_id": "cus_01",
}

CUSTOMER_RESPONSE = {
    "customer_id": "cus_hs_01",
    "merchant_reference_id": "cus_forgepay_01",
    "email": "alice@example.com",
    "name": "Alice Smith",
    "created_at": "2026-04-15T10:00:00Z",
}


@pytest.fixture
def hs_client() -> HyperswitchClient:
    return HyperswitchClient(api_key="test_api_key")


# NOTE: these tests use bare `@respx.mock` (no `base_url=` kwarg). Passing
# `base_url=` to the decorator makes respx branch out to a fresh, isolated
# MockRouter instance for the decorated test (see respx.router.MockRouter.__call__),
# while the routes below are registered on the *global* `respx` router via the
# module-level `respx.post(...)` helper. Combining the two meant the route was
# never seen by the router that was actually active during the request, so
# every request came back "not mocked" regardless of what was registered.
# Each test already pins `hs_client._client.base_url` explicitly, so the
# global router doesn't need `base_url=` to resolve requests correctly.


# ── Payment creation ──────────────────────────────────────────────────────────

@respx.mock
@pytest.mark.asyncio
async def test_create_payment_success(hs_client: HyperswitchClient):
    """
    Critical path: creating a payment in Hyperswitch (replaces stripe.PaymentIntent.create).
    Verifies correct payload mapping and response parsing.
    """
    route = respx.post("/payments").mock(
        return_value=httpx.Response(200, json=PAYMENT_RESPONSE)
    )

    req = PaymentCreateRequest(
        amount=4900,
        currency="USD",
        confirm=False,
        customer_id="cus_01",
        idempotency_key="order_test_001",
    )
    hs_client._client.base_url = httpx.URL(MOCK_BASE)  # type: ignore[assignment]
    result = await hs_client.create_payment(req)

    assert route.called
    assert result.payment_id == "pay_01HZTEST"
    assert result.client_secret == "pay_01HZTEST_secret_abc123"
    assert result.amount == 4900
    assert result.currency == "USD"

    # Verify idempotency key was sent
    sent_request = route.calls[0].request
    assert sent_request.headers.get("x-idempotency-key") == "order_test_001"


@respx.mock
@pytest.mark.asyncio
async def test_create_payment_currency_uppercased(hs_client: HyperswitchClient):
    """Currency must always be uppercase when sent to Hyperswitch."""
    respx.post("/payments").mock(return_value=httpx.Response(200, json=PAYMENT_RESPONSE))

    req = PaymentCreateRequest(amount=1000, currency="usd")  # lowercase input
    hs_client._client.base_url = httpx.URL(MOCK_BASE)  # type: ignore[assignment]
    await hs_client.create_payment(req)

    sent = json.loads(respx.calls[0].request.content)
    assert sent["currency"] == "USD"


@respx.mock
@pytest.mark.asyncio
async def test_create_payment_propagates_http_error(hs_client: HyperswitchClient):
    """A 4xx from Hyperswitch should raise an exception (not silently fail)."""
    respx.post("/payments").mock(
        return_value=httpx.Response(400, json={"error": {"message": "Invalid amount"}})
    )
    hs_client._client.base_url = httpx.URL(MOCK_BASE)  # type: ignore[assignment]

    with pytest.raises(httpx.HTTPStatusError):
        await hs_client.create_payment(PaymentCreateRequest(amount=-1, currency="USD"))


# ── Payment retrieval ─────────────────────────────────────────────────────────

@respx.mock
@pytest.mark.asyncio
async def test_retrieve_payment(hs_client: HyperswitchClient):
    respx.get("/payments/pay_01HZTEST").mock(
        return_value=httpx.Response(200, json=PAYMENT_RESPONSE)
    )
    hs_client._client.base_url = httpx.URL(MOCK_BASE)  # type: ignore[assignment]

    result = await hs_client.retrieve_payment("pay_01HZTEST")
    assert result.payment_id == "pay_01HZTEST"


# ── Refund ────────────────────────────────────────────────────────────────────

@respx.mock
@pytest.mark.asyncio
async def test_create_full_refund(hs_client: HyperswitchClient):
    refund_response = {
        "refund_id": "ref_01",
        "payment_id": "pay_01HZTEST",
        "amount": 4900,
        "status": "succeeded",
    }
    respx.post("/refunds").mock(return_value=httpx.Response(200, json=refund_response))
    hs_client._client.base_url = httpx.URL(MOCK_BASE)  # type: ignore[assignment]

    result = await hs_client.create_refund(
        RefundCreateRequest(payment_id="pay_01HZTEST")  # No amount = full refund
    )
    assert result["refund_id"] == "ref_01"
    sent = json.loads(respx.calls[0].request.content)
    # Amount should NOT be sent for full refund
    assert "amount" not in sent


# ── Customer creation ─────────────────────────────────────────────────────────

@respx.mock
@pytest.mark.asyncio
async def test_create_customer(hs_client: HyperswitchClient):
    """
    Critical path: creates a Hyperswitch customer (replaces stripe.Customer.create).
    """
    respx.post("/customers").mock(
        return_value=httpx.Response(200, json=CUSTOMER_RESPONSE)
    )
    hs_client._client.base_url = httpx.URL(MOCK_BASE)  # type: ignore[assignment]

    result = await hs_client.create_customer(
        CustomerCreateRequest(
            merchant_reference_id="cus_forgepay_01",
            email="alice@example.com",
            name="Alice Smith",
        )
    )
    assert result.customer_id == "cus_hs_01"
    assert result.email == "alice@example.com"


# ── Webhook verification ──────────────────────────────────────────────────────

def test_verify_webhook_valid():
    """HMAC-SHA256 signature verification must pass for valid payloads."""
    secret = "webhook_secret_test"
    payload = b'{"event_type":"payment_intent.succeeded"}'
    signature = hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()

    assert verify_hyperswitch_webhook(payload, f"sha256={signature}", secret) is True


def test_verify_webhook_invalid_signature():
    """Tampered payload must fail signature verification."""
    secret = "webhook_secret_test"
    payload = b'{"event_type":"payment_intent.succeeded"}'
    tampered_payload = b'{"event_type":"payment_intent.succeeded","extra":"injected"}'

    real_sig = hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()
    assert verify_hyperswitch_webhook(tampered_payload, f"sha256={real_sig}", secret) is False


def test_verify_webhook_empty_secret_returns_false():
    """No secret configured → always reject (fail-secure)."""
    assert verify_hyperswitch_webhook(b"payload", "sha256=anything", "") is False


def test_verify_webhook_bare_hex_format():
    """Should accept bare hex format (without 'sha256=' prefix)."""
    secret = "s3cret"
    payload = b"test_payload"
    signature = hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()

    assert verify_hyperswitch_webhook(payload, signature, secret) is True
