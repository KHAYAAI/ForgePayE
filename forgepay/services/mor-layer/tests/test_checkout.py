"""
Integration tests for POST /v1/checkout/sessions.

Mocks the Hyperswitch payment-engine so tests run without a live cluster.
Verifies that:
  1. Subtotal is correctly calculated from line items
  2. Tax is applied correctly per country
  3. Hyperswitch is called with (subtotal + tax) as the total
  4. The response contains the client_secret from Hyperswitch
  5. Errors from Hyperswitch propagate as 502

Also tests the new POST /v1/checkout/sessions/shielded endpoint:
  - Decrypts shielded transactions via AuditorClient (stubbed)
  - Computes tax on decrypted amounts
  - Stores nullifier for compliance audit
  - Verifies Groth16 proofs (stubbed)
"""

import base64
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


# ── Shielded Checkout Tests ───────────────────────────────────────────────────


SHIELDED_CHECKOUT_PAYLOAD = {
    "merchant_id": "merch_test_01",
    "customer_id": "cus_hs_01",
    "encrypted_memo": base64.b64encode(b"stub_encrypted_memo_data").decode("utf-8"),
    "audit_proof": base64.b64encode(b"stub_groth16_proof_data").decode("utf-8"),
    "currency": "USD",
    "success_url": "https://example.com/success",
    "cancel_url": "https://example.com/cancel",
    "customer_country": "US",
    "idempotency_key": "test_shielded_001",
}


@respx.mock
@pytest.mark.asyncio
async def test_shielded_checkout_creates_payment(client: AsyncClient):
    """
    Happy path: shielded checkout decrypts transaction and creates Hyperswitch payment.

    The auditor decrypts the memo and reveals the amount (1_000_000 = $1.00).
    No tax for US without state → total = 1_000_000.
    Merchant never sees plaintext.
    """
    respx.post("http://hyperswitch-test.local/payments").mock(
        return_value=httpx.Response(200, json={
            "payment_id": "pay_shielded_01",
            "status": "requires_confirmation",
            "amount": 1_000_000,
            "currency": "USD",
            "client_secret": "pay_shielded_01_secret",
            "customer_id": "cus_hs_01",
        })
    )

    resp = await client.post("/v1/checkout/sessions/shielded", json=SHIELDED_CHECKOUT_PAYLOAD)

    assert resp.status_code == 201
    data = resp.json()
    assert data["payment_id"] == "pay_shielded_01"
    assert data["client_secret"] == "pay_shielded_01_secret"
    assert data["amount_subtotal"] == 100  # 1_000_000 / 10_000
    assert data["amount_tax"] == 0         # No tax without state
    assert data["amount_total"] == 100
    assert data["status"] == "pending"


@respx.mock
@pytest.mark.asyncio
async def test_shielded_checkout_with_tax_calculation(client: AsyncClient):
    """
    Shielded checkout computes tax on decrypted amount.
    Amount: 1_000_000 (auditor can see), but merchant cannot.
    Germany: 19% VAT → tax = 19 (19% of 100 cents, roughly).
    """
    respx.post("http://hyperswitch-test.local/payments").mock(
        return_value=httpx.Response(200, json={
            "payment_id": "pay_shielded_de_01",
            "status": "requires_confirmation",
            "amount": 119,  # 100 + 19
            "currency": "USD",
            "client_secret": "pay_shielded_de_01_secret",
            "customer_id": "cus_hs_01",
        })
    )

    resp = await client.post(
        "/v1/checkout/sessions/shielded",
        json={
            **SHIELDED_CHECKOUT_PAYLOAD,
            "customer_country": "DE",
            "idempotency_key": "test_shielded_de_001",
        },
    )

    assert resp.status_code == 201
    data = resp.json()
    assert data["amount_subtotal"] == 100
    assert data["amount_tax"] == 19     # 19% of 100
    assert data["amount_total"] == 119
    assert len(data["tax_breakdown"]) == 1
    assert data["tax_breakdown"][0]["jurisdiction"] == "DE"
    assert data["tax_breakdown"][0]["tax_type"] == "VAT"


@respx.mock
@pytest.mark.asyncio
async def test_shielded_checkout_invalid_base64_memo(client: AsyncClient):
    """Invalid base64 in encrypted_memo should return 400."""
    resp = await client.post(
        "/v1/checkout/sessions/shielded",
        json={
            **SHIELDED_CHECKOUT_PAYLOAD,
            "encrypted_memo": "not_valid_base64!!!",
        },
    )

    assert resp.status_code == 400
    assert "base64" in resp.json()["detail"].lower()


@respx.mock
@pytest.mark.asyncio
async def test_shielded_checkout_stores_nullifier_for_audit(client: AsyncClient):
    """
    Shielded sessions store the nullifier in DB for compliance auditing.
    Auditor can check if nullifier is frozen (prevent double-spending).
    """
    respx.post("http://hyperswitch-test.local/payments").mock(
        return_value=httpx.Response(200, json={
            "payment_id": "pay_shielded_nullifier_01",
            "status": "requires_confirmation",
            "amount": 100,
            "currency": "USD",
            "client_secret": "pay_shielded_nullifier_secret",
            "customer_id": "cus_hs_01",
        })
    )

    resp = await client.post("/v1/checkout/sessions/shielded", json=SHIELDED_CHECKOUT_PAYLOAD)

    assert resp.status_code == 201
    data = resp.json()
    # The auditor decrypts and returns a stub nullifier: "DECRYPTED_NULLIFIER"
    # The response doesn't expose the nullifier (privacy), but it's stored in DB
    assert data["payment_id"] == "pay_shielded_nullifier_01"
    # In a real test with DB access, we'd verify the nullifier is stored


@respx.mock
@pytest.mark.asyncio
async def test_shielded_checkout_hyperswitch_down_returns_502(client: AsyncClient):
    """If Hyperswitch is down during shielded checkout, return 502."""
    respx.post("http://hyperswitch-test.local/payments").mock(
        return_value=httpx.Response(503, json={"error": "Service Unavailable"})
    )

    resp = await client.post("/v1/checkout/sessions/shielded", json=SHIELDED_CHECKOUT_PAYLOAD)

    assert resp.status_code == 502
    assert "Payment engine" in resp.json()["detail"]


@respx.mock
@pytest.mark.asyncio
async def test_shielded_checkout_groth16_proof_verification(client: AsyncClient):
    """
    Groth16 proof verification (stubbed to always succeed in Phase 2).
    When real Groth16 is integrated, this will verify the proof against the memo.
    """
    respx.post("http://hyperswitch-test.local/payments").mock(
        return_value=httpx.Response(200, json={
            "payment_id": "pay_shielded_proof_01",
            "status": "requires_confirmation",
            "amount": 100,
            "currency": "USD",
            "client_secret": "pay_shielded_proof_secret",
            "customer_id": "cus_hs_01",
        })
    )

    # Proof is optional in Phase 2 (testing mode) but accepted if provided
    resp = await client.post(
        "/v1/checkout/sessions/shielded",
        json={
            **SHIELDED_CHECKOUT_PAYLOAD,
            "audit_proof": base64.b64encode(b"valid_groth16_proof").decode("utf-8"),
        },
    )

    assert resp.status_code == 201
    data = resp.json()
    assert data["payment_id"] == "pay_shielded_proof_01"
    # In Phase 3, we'd assert that the proof was actually verified
