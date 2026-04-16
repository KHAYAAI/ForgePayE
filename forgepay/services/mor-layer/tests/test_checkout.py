"""
Integration tests for POST /v1/checkout/sessions.

Mocks the Hyperswitch payment-engine so tests run without a live cluster.
Verifies that:
  1. Subtotal is correctly calculated from line items
  2. Tax is applied correctly per country
  3. Hyperswitch is called with (subtotal + tax) as the total
  4. The response contains the client_secret from Hyperswitch
  5. Errors from Hyperswitch propagate as 502
"""

import json
import pytest
import respx
import httpx
from httpx import AsyncClient


CHECKOUT_PAYLOAD = {
    "merchant_id": "merch_test_01",
    "customer_id": "cus_hs_01",
    "line_items": [
        {"name": "Pro Plan", "amount": 4900, "currency": "USD", "quantity": 1},
    ],
    "currency": "USD",
    "success_url": "https://example.com/success",
    "cancel_url": "https://example.com/cancel",
    "collect_tax": False,   # Disable tax for basic tests
    "idempotency_key": "test_session_001",
}

HS_PAYMENT_RESPONSE = {
    "payment_id": "pay_01TEST",
    "status": "requires_confirmation",
    "amount": 4900,
    "currency": "USD",
    "client_secret": "pay_01TEST_secret_xyz",
    "customer_id": "cus_hs_01",
}


@respx.mock
@pytest.mark.asyncio
async def test_checkout_creates_hyperswitch_payment(client: AsyncClient):
    """
    Happy path: checkout session creates a Hyperswitch PaymentIntent and
    returns client_secret for frontend to complete payment.
    """
    respx.post("http://hyperswitch-test.local/payments").mock(
        return_value=httpx.Response(200, json=HS_PAYMENT_RESPONSE)
    )

    resp = await client.post("/v1/checkout/sessions", json=CHECKOUT_PAYLOAD)

    assert resp.status_code == 201
    data = resp.json()
    assert data["payment_id"] == "pay_01TEST"
    assert data["client_secret"] == "pay_01TEST_secret_xyz"
    assert data["amount_subtotal"] == 4900
    assert data["amount_tax"] == 0
    assert data["amount_total"] == 4900
    assert data["status"] == "pending"


@respx.mock
@pytest.mark.asyncio
async def test_checkout_calculates_tax_for_germany(client: AsyncClient):
    """
    MoR critical path: 19% German VAT must be added on top of subtotal.
    Total = 4900 + round(4900 * 0.19) = 4900 + 931 = 5831
    """
    # Capture what amount Hyperswitch is called with
    hs_route = respx.post("http://hyperswitch-test.local/payments").mock(
        return_value=httpx.Response(200, json={**HS_PAYMENT_RESPONSE, "amount": 5831})
    )

    resp = await client.post(
        "/v1/checkout/sessions",
        json={
            **CHECKOUT_PAYLOAD,
            "collect_tax": True,
            "customer_country": "DE",
            "idempotency_key": "test_tax_de_001",
        },
    )

    assert resp.status_code == 201
    data = resp.json()
    assert data["amount_subtotal"] == 4900
    assert data["amount_tax"] == 931        # 19% of 4900
    assert data["amount_total"] == 5831
    assert len(data["tax_breakdown"]) == 1
    assert data["tax_breakdown"][0]["tax_type"] == "VAT"
    assert data["tax_breakdown"][0]["jurisdiction"] == "DE"

    # Verify the correct total was sent to Hyperswitch
    sent = json.loads(hs_route.calls[0].request.content)
    assert sent["amount"] == 5831


@respx.mock
@pytest.mark.asyncio
async def test_checkout_calculates_tax_for_uk(client: AsyncClient):
    """UK VAT is 20%."""
    respx.post("http://hyperswitch-test.local/payments").mock(
        return_value=httpx.Response(200, json={**HS_PAYMENT_RESPONSE, "amount": 5880})
    )

    resp = await client.post(
        "/v1/checkout/sessions",
        json={**CHECKOUT_PAYLOAD, "collect_tax": True, "customer_country": "GB",
              "idempotency_key": "test_tax_gb"},
    )

    data = resp.json()
    assert data["amount_tax"] == 980        # 20% of 4900
    assert data["amount_total"] == 5880


@respx.mock
@pytest.mark.asyncio
async def test_checkout_no_tax_for_us_without_state(client: AsyncClient):
    """US sales tax requires a state — no state → no tax collected."""
    respx.post("http://hyperswitch-test.local/payments").mock(
        return_value=httpx.Response(200, json=HS_PAYMENT_RESPONSE)
    )

    resp = await client.post(
        "/v1/checkout/sessions",
        json={**CHECKOUT_PAYLOAD, "collect_tax": True, "customer_country": "US",
              "idempotency_key": "test_us_no_state"},
    )
    data = resp.json()
    assert data["amount_tax"] == 0


@respx.mock
@pytest.mark.asyncio
async def test_checkout_multi_item_subtotal(client: AsyncClient):
    """Multiple line items: subtotal = sum(amount * quantity)."""
    respx.post("http://hyperswitch-test.local/payments").mock(
        return_value=httpx.Response(200, json={**HS_PAYMENT_RESPONSE, "amount": 14700})
    )

    resp = await client.post(
        "/v1/checkout/sessions",
        json={
            **CHECKOUT_PAYLOAD,
            "line_items": [
                {"name": "Pro Plan",   "amount": 4900, "quantity": 1},
                {"name": "Extra Seat", "amount": 2450, "quantity": 2},
                {"name": "Add-on",     "amount": 2000, "quantity": 2},
            ],
            "idempotency_key": "test_multi_001",
        },
    )
    data = resp.json()
    expected = 4900 + (2450 * 2) + (2000 * 2)  # = 14800... wait: 4900+4900+4000 = 13800
    # 4900 + 4900 + 4000 = 13800
    assert data["amount_subtotal"] == 4900 + 4900 + 4000


@respx.mock
@pytest.mark.asyncio
async def test_checkout_hyperswitch_502_returns_502(client: AsyncClient):
    """If Hyperswitch is down, checkout should return 502 (not 500)."""
    respx.post("http://hyperswitch-test.local/payments").mock(
        return_value=httpx.Response(503, json={"error": "Service Unavailable"})
    )

    resp = await client.post("/v1/checkout/sessions", json=CHECKOUT_PAYLOAD)
    assert resp.status_code == 502
    assert "Payment engine" in resp.json()["detail"]
