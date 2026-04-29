"""
Unit tests for app/gateways/hyperswitch.py — the HyperswitchBridge thin adapter.

Uses respx to mock httpx calls so no real network traffic is made.
Covers create_payment, retrieve_payment, and refund_payment, verifying:
  - correct HTTP endpoint and method
  - correct headers (api-key, Idempotency-Key, Content-Type)
  - successful response mapping to PaymentResponse / dict
  - HTTP error propagation
"""

import json
from unittest.mock import patch

import httpx
import pytest
import respx

from app.gateways.hyperswitch import HyperswitchBridge, PaymentRequest, PaymentResponse

# ── Constants ─────────────────────────────────────────────────────────────────

MOCK_BASE_URL = "http://hyperswitch-test.local"
MOCK_API_KEY  = "test_sk_gateway"

PAYMENT_RESPONSE_BODY = {
    "payment_id":    "pay_gw_001",
    "client_secret": "pay_gw_001_secret_xyz",
    "status":        "processing",
    "amount":        4900,
    "currency":      "USD",
    "next_action":   None,
}

REFUND_RESPONSE_BODY = {
    "refund_id":  "ref_gw_001",
    "payment_id": "pay_gw_001",
    "amount":     4900,
    "status":     "succeeded",
}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _make_bridge() -> HyperswitchBridge:
    """Return a HyperswitchBridge wired to the mock base URL and key."""
    bridge = HyperswitchBridge.__new__(HyperswitchBridge)
    bridge._base_url = MOCK_BASE_URL
    bridge._api_key  = MOCK_API_KEY
    return bridge


def _make_payment_request(**overrides) -> PaymentRequest:
    defaults = dict(
        amount=4900,
        currency="USD",
        customer_id="cus_test_01",
        payment_method_data={"card": {"number": "4242424242424242", "exp_month": "12", "exp_year": "2030", "cvc": "123"}},
        idempotency_key="idem_test_001",
        metadata={"order_id": "ord_42"},
        description="Test product",
        return_url="https://forgepay.io/return",
    )
    defaults.update(overrides)
    return PaymentRequest(**defaults)


# ── create_payment ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
@respx.mock
async def test_create_payment_hits_correct_endpoint():
    """POST /payments must be called on create_payment."""
    route = respx.post(f"{MOCK_BASE_URL}/payments").mock(
        return_value=httpx.Response(200, json=PAYMENT_RESPONSE_BODY)
    )

    bridge = _make_bridge()
    await bridge.create_payment(_make_payment_request())

    assert route.called, "Expected POST /payments to be called"


@pytest.mark.asyncio
@respx.mock
async def test_create_payment_sends_api_key_header():
    """api-key header must be sent with the configured key."""
    route = respx.post(f"{MOCK_BASE_URL}/payments").mock(
        return_value=httpx.Response(200, json=PAYMENT_RESPONSE_BODY)
    )

    bridge = _make_bridge()
    await bridge.create_payment(_make_payment_request())

    assert route.called
    sent_headers = route.calls[0].request.headers
    assert sent_headers.get("api-key") == MOCK_API_KEY


@pytest.mark.asyncio
@respx.mock
async def test_create_payment_sends_idempotency_key_header():
    """Idempotency-Key header must match the request's idempotency_key."""
    route = respx.post(f"{MOCK_BASE_URL}/payments").mock(
        return_value=httpx.Response(200, json=PAYMENT_RESPONSE_BODY)
    )

    bridge = _make_bridge()
    req = _make_payment_request(idempotency_key="unique_idem_key_007")
    await bridge.create_payment(req)

    sent_headers = route.calls[0].request.headers
    assert sent_headers.get("idempotency-key") == "unique_idem_key_007"


@pytest.mark.asyncio
@respx.mock
async def test_create_payment_currency_uppercased():
    """Currency must always be sent uppercase to the payment engine."""
    route = respx.post(f"{MOCK_BASE_URL}/payments").mock(
        return_value=httpx.Response(200, json=PAYMENT_RESPONSE_BODY)
    )

    bridge = _make_bridge()
    await bridge.create_payment(_make_payment_request(currency="usd"))

    sent_body = json.loads(route.calls[0].request.content)
    assert sent_body["currency"] == "USD"


@pytest.mark.asyncio
@respx.mock
async def test_create_payment_payload_includes_required_fields():
    """Payload must include amount, currency, customer_id, payment_method, confirm."""
    route = respx.post(f"{MOCK_BASE_URL}/payments").mock(
        return_value=httpx.Response(200, json=PAYMENT_RESPONSE_BODY)
    )

    bridge = _make_bridge()
    req = _make_payment_request()
    await bridge.create_payment(req)

    body = json.loads(route.calls[0].request.content)
    assert body["amount"] == req.amount
    assert body["currency"] == req.currency.upper()
    assert body["customer_id"] == req.customer_id
    assert body["payment_method"] == "card"
    assert body["confirm"] is True


@pytest.mark.asyncio
@respx.mock
async def test_create_payment_returns_payment_response():
    """create_payment must map the JSON body to a PaymentResponse dataclass."""
    respx.post(f"{MOCK_BASE_URL}/payments").mock(
        return_value=httpx.Response(200, json=PAYMENT_RESPONSE_BODY)
    )

    bridge = _make_bridge()
    result = await bridge.create_payment(_make_payment_request())

    assert isinstance(result, PaymentResponse)
    assert result.payment_id    == "pay_gw_001"
    assert result.client_secret == "pay_gw_001_secret_xyz"
    assert result.status        == "processing"
    assert result.amount        == 4900
    assert result.currency      == "USD"
    assert result.next_action   is None


@pytest.mark.asyncio
@respx.mock
async def test_create_payment_propagates_http_error():
    """4xx/5xx from Hyperswitch must raise httpx.HTTPStatusError."""
    respx.post(f"{MOCK_BASE_URL}/payments").mock(
        return_value=httpx.Response(400, json={"error": {"message": "Invalid amount"}})
    )

    bridge = _make_bridge()
    with pytest.raises(httpx.HTTPStatusError):
        await bridge.create_payment(_make_payment_request(amount=-1))


# ── retrieve_payment ──────────────────────────────────────────────────────────

@pytest.mark.asyncio
@respx.mock
async def test_retrieve_payment_hits_correct_endpoint():
    """GET /payments/{payment_id} must be called on retrieve_payment."""
    route = respx.get(f"{MOCK_BASE_URL}/payments/pay_gw_001").mock(
        return_value=httpx.Response(200, json=PAYMENT_RESPONSE_BODY)
    )

    bridge = _make_bridge()
    await bridge.retrieve_payment("pay_gw_001")

    assert route.called


@pytest.mark.asyncio
@respx.mock
async def test_retrieve_payment_sends_api_key_header():
    """api-key header must be present on retrieve_payment requests."""
    route = respx.get(f"{MOCK_BASE_URL}/payments/pay_gw_001").mock(
        return_value=httpx.Response(200, json=PAYMENT_RESPONSE_BODY)
    )

    bridge = _make_bridge()
    await bridge.retrieve_payment("pay_gw_001")

    sent_headers = route.calls[0].request.headers
    assert sent_headers.get("api-key") == MOCK_API_KEY


@pytest.mark.asyncio
@respx.mock
async def test_retrieve_payment_returns_payment_response():
    """retrieve_payment must map the JSON body to a PaymentResponse dataclass."""
    respx.get(f"{MOCK_BASE_URL}/payments/pay_gw_001").mock(
        return_value=httpx.Response(200, json=PAYMENT_RESPONSE_BODY)
    )

    bridge = _make_bridge()
    result = await bridge.retrieve_payment("pay_gw_001")

    assert isinstance(result, PaymentResponse)
    assert result.payment_id == "pay_gw_001"
    assert result.status     == "processing"
    assert result.amount     == 4900


@pytest.mark.asyncio
@respx.mock
async def test_retrieve_payment_falls_back_to_payment_id_arg():
    """If payment_id is missing from response, the argument value is used."""
    body_without_id = {**PAYMENT_RESPONSE_BODY}
    body_without_id.pop("payment_id")

    respx.get(f"{MOCK_BASE_URL}/payments/pay_fallback").mock(
        return_value=httpx.Response(200, json=body_without_id)
    )

    bridge = _make_bridge()
    result = await bridge.retrieve_payment("pay_fallback")

    assert result.payment_id == "pay_fallback"


@pytest.mark.asyncio
@respx.mock
async def test_retrieve_payment_propagates_http_error():
    """404 from Hyperswitch must raise httpx.HTTPStatusError."""
    respx.get(f"{MOCK_BASE_URL}/payments/pay_missing").mock(
        return_value=httpx.Response(404, json={"error": "not found"})
    )

    bridge = _make_bridge()
    with pytest.raises(httpx.HTTPStatusError):
        await bridge.retrieve_payment("pay_missing")


# ── refund_payment ────────────────────────────────────────────────────────────

@pytest.mark.asyncio
@respx.mock
async def test_refund_payment_hits_correct_endpoint():
    """POST /refunds must be called on refund_payment."""
    route = respx.post(f"{MOCK_BASE_URL}/refunds").mock(
        return_value=httpx.Response(200, json=REFUND_RESPONSE_BODY)
    )

    bridge = _make_bridge()
    await bridge.refund_payment("pay_gw_001", 4900)

    assert route.called


@pytest.mark.asyncio
@respx.mock
async def test_refund_payment_sends_api_key_header():
    """api-key header must be present on refund requests."""
    route = respx.post(f"{MOCK_BASE_URL}/refunds").mock(
        return_value=httpx.Response(200, json=REFUND_RESPONSE_BODY)
    )

    bridge = _make_bridge()
    await bridge.refund_payment("pay_gw_001", 4900)

    sent_headers = route.calls[0].request.headers
    assert sent_headers.get("api-key") == MOCK_API_KEY


@pytest.mark.asyncio
@respx.mock
async def test_refund_payment_payload_fields():
    """Refund payload must include payment_id, amount, and reason."""
    route = respx.post(f"{MOCK_BASE_URL}/refunds").mock(
        return_value=httpx.Response(200, json=REFUND_RESPONSE_BODY)
    )

    bridge = _make_bridge()
    await bridge.refund_payment("pay_gw_001", 2500, reason="fraudulent")

    body = json.loads(route.calls[0].request.content)
    assert body["payment_id"] == "pay_gw_001"
    assert body["amount"]     == 2500
    assert body["reason"]     == "fraudulent"


@pytest.mark.asyncio
@respx.mock
async def test_refund_payment_default_reason():
    """When no reason is supplied, 'requested_by_customer' must be sent."""
    route = respx.post(f"{MOCK_BASE_URL}/refunds").mock(
        return_value=httpx.Response(200, json=REFUND_RESPONSE_BODY)
    )

    bridge = _make_bridge()
    await bridge.refund_payment("pay_gw_001", 4900)

    body = json.loads(route.calls[0].request.content)
    assert body["reason"] == "requested_by_customer"


@pytest.mark.asyncio
@respx.mock
async def test_refund_payment_returns_dict():
    """refund_payment must return the raw response JSON as a dict."""
    respx.post(f"{MOCK_BASE_URL}/refunds").mock(
        return_value=httpx.Response(200, json=REFUND_RESPONSE_BODY)
    )

    bridge = _make_bridge()
    result = await bridge.refund_payment("pay_gw_001", 4900)

    assert isinstance(result, dict)
    assert result["refund_id"]  == "ref_gw_001"
    assert result["payment_id"] == "pay_gw_001"
    assert result["status"]     == "succeeded"


@pytest.mark.asyncio
@respx.mock
async def test_refund_payment_propagates_http_error():
    """5xx from Hyperswitch on refund must raise httpx.HTTPStatusError."""
    respx.post(f"{MOCK_BASE_URL}/refunds").mock(
        return_value=httpx.Response(500, json={"error": "internal error"})
    )

    bridge = _make_bridge()
    with pytest.raises(httpx.HTTPStatusError):
        await bridge.refund_payment("pay_gw_001", 4900)
