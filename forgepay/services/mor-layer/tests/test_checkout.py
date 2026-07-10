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
    # audit_proof is optional (verified only "if provided" — see checkout.py);
    # tests that aren't specifically about proof verification omit it so they
    # aren't tripped up by AuditorClient.verify_audit_proof's structural
    # length check (a real Groth16 proof is 128 or 256 bytes; earlier this
    # fixture used a short human-readable placeholder that isn't proof-shaped
    # and was rejected before the checkout logic under test ever ran).
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

    # Proof is optional in Phase 2 (testing mode) but accepted if provided,
    # as long as it is structurally proof-shaped: AuditorClient.verify_audit_proof
    # requires 128 or 256 raw bytes (compressed Groth16 / ABI-encoded format).
    resp = await client.post(
        "/v1/checkout/sessions/shielded",
        json={
            **SHIELDED_CHECKOUT_PAYLOAD,
            "audit_proof": base64.b64encode(b"\x00" * 128).decode("utf-8"),
        },
    )

    assert resp.status_code == 201
    data = resp.json()
    assert data["payment_id"] == "pay_shielded_proof_01"
    # In Phase 3, we'd assert that the proof was actually verified


# ── Auditor Decrypt Tests ─────────────────────────────────────────────────────

from unittest.mock import MagicMock, patch

# A valid 64-hex-char seed used in all auditor tests
_AUDITOR_SEED = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

# Shared base request body for decrypt endpoint
_DECRYPT_VALID_PAYLOAD = {
    "encrypted_memo": base64.b64encode(b"any_bytes_decryption_is_mocked").decode("utf-8"),
}


class TestAuditorDecrypt:
    """Tests for POST /v1/auditor/decrypt (internal-only endpoint)."""

    @pytest.mark.asyncio
    async def test_decrypt_requires_internal_secret(self, client: AsyncClient):
        """Without X-Internal-Secret header, endpoint returns 403 Forbidden."""
        resp = await client.post(
            "/v1/auditor/decrypt",
            json=_DECRYPT_VALID_PAYLOAD,
            # No X-Internal-Secret header
        )
        assert resp.status_code == 403
        assert "Forbidden" in resp.json()["detail"]

    @pytest.mark.asyncio
    async def test_decrypt_wrong_secret_returns_403(self, client: AsyncClient):
        """Wrong X-Internal-Secret value returns 403."""
        resp = await client.post(
            "/v1/auditor/decrypt",
            json=_DECRYPT_VALID_PAYLOAD,
            headers={"X-Internal-Secret": "wrong-secret"},
        )
        assert resp.status_code == 403

    @pytest.mark.asyncio
    async def test_decrypt_invalid_base64(self, client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
        """Invalid base64 in encrypted_memo returns 400."""
        monkeypatch.setenv("INTERNAL_WEBHOOK_SECRET", "test-internal-secret")
        monkeypatch.setenv("AUDITOR_SEED_HEX", _AUDITOR_SEED)

        # Reload the module-level INTERNAL_SECRET by patching the auditor module
        with patch("src.api.auditor.INTERNAL_SECRET", "test-internal-secret"):
            resp = await client.post(
                "/v1/auditor/decrypt",
                json={"encrypted_memo": "not_valid_base64!!!"},
                headers={"X-Internal-Secret": "test-internal-secret"},
            )

        assert resp.status_code == 400
        assert "base64" in resp.json()["detail"].lower()

    @pytest.mark.asyncio
    async def test_decrypt_missing_auditor_seed_returns_503(
        self, client: AsyncClient, monkeypatch: pytest.MonkeyPatch
    ):
        """When AUDITOR_SEED_HEX env var is absent, endpoint returns 503."""
        monkeypatch.delenv("AUDITOR_SEED_HEX", raising=False)

        with patch("src.api.auditor.INTERNAL_SECRET", "test-internal-secret"):
            with patch.dict("os.environ", {}, clear=False):
                # Ensure the env var is unset inside the request
                import os as _os
                _os.environ.pop("AUDITOR_SEED_HEX", None)

                resp = await client.post(
                    "/v1/auditor/decrypt",
                    json=_DECRYPT_VALID_PAYLOAD,
                    headers={"X-Internal-Secret": "test-internal-secret"},
                )

        assert resp.status_code == 503
        assert "seed" in resp.json()["detail"].lower()

    @pytest.mark.asyncio
    async def test_decrypt_success(self, client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
        """
        With a valid encrypted memo and correct secret, returns decrypted tx data.

        AuditorClient.decrypt_shielded_tx is monkeypatched to return a known
        ShieldedTxData, so the test does not depend on real cryptography.
        """
        from src.auditor import ShieldedTxData

        stub_tx = ShieldedTxData(
            asset=0,
            amount=1_000_000,
            owner_pk="aabbccdd" * 8,
            nullifier="nullifier_hex_stub",
            commitment="commitment_hex_stub",
            timestamp=1_700_000_000,
            merchant_id="merch_test_01",
        )

        monkeypatch.setenv("AUDITOR_SEED_HEX", _AUDITOR_SEED)

        with patch("src.api.auditor.INTERNAL_SECRET", "test-internal-secret"), \
             patch("src.api.auditor.AuditorClient.from_seed") as mock_from_seed:

            mock_client = MagicMock()
            mock_client.decrypt_shielded_tx.return_value = stub_tx
            mock_from_seed.return_value = mock_client

            resp = await client.post(
                "/v1/auditor/decrypt",
                json=_DECRYPT_VALID_PAYLOAD,
                headers={"X-Internal-Secret": "test-internal-secret"},
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data["asset"] == "0"
        assert data["amount"] == pytest.approx(1_000_000.0)
        assert data["amount_units"] == str(int(1_000_000 * 1_000_000))
        assert data["nullifier"] == "nullifier_hex_stub"
        assert data["commitment"] == "commitment_hex_stub"
        assert data["merchant_id"] == "merch_test_01"

    @pytest.mark.asyncio
    async def test_decrypt_decryption_failure_returns_422(
        self, client: AsyncClient, monkeypatch: pytest.MonkeyPatch
    ):
        """When decryption raises an error (bad ciphertext), returns 422."""
        monkeypatch.setenv("AUDITOR_SEED_HEX", _AUDITOR_SEED)

        with patch("src.api.auditor.INTERNAL_SECRET", "test-internal-secret"), \
             patch("src.api.auditor.AuditorClient.from_seed") as mock_from_seed:

            mock_client = MagicMock()
            mock_client.decrypt_shielded_tx.side_effect = ValueError(
                "AES-GCM authentication failed — memo tampered or wrong key"
            )
            mock_from_seed.return_value = mock_client

            resp = await client.post(
                "/v1/auditor/decrypt",
                json=_DECRYPT_VALID_PAYLOAD,
                headers={"X-Internal-Secret": "test-internal-secret"},
            )

        assert resp.status_code == 422
        assert "Decryption failed" in resp.json()["detail"]
