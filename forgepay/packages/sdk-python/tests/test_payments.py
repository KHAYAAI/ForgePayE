"""Tests for sync and async payments resource."""

import pytest
import respx
import httpx

from forgepay import ForgePay, AsyncForgePay
from forgepay.errors import AuthenticationError, ServiceUnavailableError, RateLimitError

BASE = "https://api.forgepay.io"

PAYMENT_FIXTURE = {
    "payment_id": "pay_abc123",
    "merchant_id": "mer_001",
    "status": "succeeded",
    "amount": 4900,
    "currency": "USD",
    "customer_id": "cus_xyz",
    "description": "Order #42",
    "payment_method": "card",
    "client_secret": None,
    "created": "2026-04-16T12:00:00Z",
    "metadata": {},
}

REFUND_FIXTURE = {
    "refund_id": "ref_001",
    "payment_id": "pay_abc123",
    "amount": 4900,
    "currency": "USD",
    "status": "succeeded",
    "created": "2026-04-16T13:00:00Z",
}


# ── Sync ──────────────────────────────────────────────────────────────────────

class TestPaymentsSync:
    def setup_method(self) -> None:
        self.client = ForgePay(api_key="sk_test_123", base_url=BASE)

    def teardown_method(self) -> None:
        self.client.close()

    @respx.mock
    def test_create_payment(self) -> None:
        respx.post(f"{BASE}/v1/payments").mock(return_value=httpx.Response(200, json=PAYMENT_FIXTURE))
        payment = self.client.payments.create(amount=4900, currency="USD")
        assert payment.payment_id == "pay_abc123"
        assert payment.amount == 4900
        assert payment.status == "succeeded"

    @respx.mock
    def test_create_sends_idempotency_header(self) -> None:
        route = respx.post(f"{BASE}/v1/payments").mock(
            return_value=httpx.Response(200, json=PAYMENT_FIXTURE)
        )
        self.client.payments.create(
            amount=4900, currency="USD", idempotency_key="idem-001"
        )
        assert route.calls[0].request.headers.get("idempotency-key") == "idem-001"

    @respx.mock
    def test_retrieve_payment(self) -> None:
        respx.get(f"{BASE}/v1/payments/pay_abc123").mock(
            return_value=httpx.Response(200, json=PAYMENT_FIXTURE)
        )
        payment = self.client.payments.retrieve("pay_abc123")
        assert payment.payment_id == "pay_abc123"

    @respx.mock
    def test_full_refund(self) -> None:
        respx.post(f"{BASE}/v1/refunds").mock(
            return_value=httpx.Response(200, json=REFUND_FIXTURE)
        )
        refund = self.client.payments.refund("pay_abc123")
        assert refund.refund_id == "ref_001"
        # Full refund — no amount in body
        body = respx.calls.last.request.content
        assert b'"amount"' not in body

    @respx.mock
    def test_partial_refund(self) -> None:
        respx.post(f"{BASE}/v1/refunds").mock(
            return_value=httpx.Response(200, json={**REFUND_FIXTURE, "amount": 2500})
        )
        refund = self.client.payments.refund("pay_abc123", amount=2500)
        assert refund.amount == 2500

    @respx.mock
    def test_auth_error_raises(self) -> None:
        respx.get(f"{BASE}/v1/payments/pay_bad").mock(
            return_value=httpx.Response(401, json={"error": {"message": "Invalid API key"}})
        )
        with pytest.raises(AuthenticationError):
            self.client.payments.retrieve("pay_bad")

    @respx.mock
    def test_rate_limit_raises(self) -> None:
        # Mock all retries to return 429
        respx.post(f"{BASE}/v1/payments").mock(return_value=httpx.Response(429, json={}))
        with pytest.raises(RateLimitError):
            self.client.payments.create(amount=100, currency="USD")


# ── Async ─────────────────────────────────────────────────────────────────────

class TestPaymentsAsync:
    @respx.mock
    async def test_create_payment_async(self) -> None:
        respx.post(f"{BASE}/v1/payments").mock(return_value=httpx.Response(200, json=PAYMENT_FIXTURE))
        async with AsyncForgePay(api_key="sk_test_123", base_url=BASE) as fp:
            payment = await fp.payments.create(amount=4900, currency="USD")
        assert payment.payment_id == "pay_abc123"

    @respx.mock
    async def test_retrieve_payment_async(self) -> None:
        respx.get(f"{BASE}/v1/payments/pay_abc123").mock(
            return_value=httpx.Response(200, json=PAYMENT_FIXTURE)
        )
        async with AsyncForgePay(api_key="sk_test_123", base_url=BASE) as fp:
            payment = await fp.payments.retrieve("pay_abc123")
        assert payment.currency == "USD"

    @respx.mock
    async def test_service_unavailable_raises_async(self) -> None:
        respx.post(f"{BASE}/v1/payments").mock(return_value=httpx.Response(503, json={}))
        with pytest.raises(ServiceUnavailableError):
            async with AsyncForgePay(api_key="sk_test_123", base_url=BASE) as fp:
                await fp.payments.create(amount=100, currency="USD")
