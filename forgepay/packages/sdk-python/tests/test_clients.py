"""Tests for ForgePay and AsyncForgePay top-level clients."""

import pytest
import respx
import httpx

from forgepay import ForgePay, AsyncForgePay
from forgepay.resources.payments      import PaymentsResource, AsyncPaymentsResource
from forgepay.resources.customers     import CustomersResource, AsyncCustomersResource
from forgepay.resources.subscriptions import SubscriptionsResource, AsyncSubscriptionsResource
from forgepay.resources.stablecoins   import StablecoinsResource, AsyncStablecoinsResource
from forgepay.resources.crypto        import CryptoResource, AsyncCryptoResource
from forgepay.resources.webhooks      import WebhookResource

BASE = "https://api.forgepay.io"


class TestForgePay:
    def test_all_resources_present(self) -> None:
        with ForgePay(api_key="sk_test_x", base_url=BASE) as fp:
            assert isinstance(fp.payments,      PaymentsResource)
            assert isinstance(fp.customers,     CustomersResource)
            assert isinstance(fp.subscriptions, SubscriptionsResource)
            assert isinstance(fp.stablecoins,   StablecoinsResource)
            assert isinstance(fp.crypto,        CryptoResource)
            assert fp.webhooks is WebhookResource

    def test_empty_api_key_raises(self) -> None:
        with pytest.raises(ValueError, match="api_key"):
            ForgePay(api_key="")

    @respx.mock
    def test_authorization_header_sent(self) -> None:
        route = respx.get(f"{BASE}/v1/payments/pay_x").mock(
            return_value=httpx.Response(200, json={
                "payment_id": "pay_x", "merchant_id": "mer_1", "status": "succeeded",
                "amount": 100, "currency": "USD", "created": "2026-04-16T00:00:00Z",
                "metadata": {},
            })
        )
        with ForgePay(api_key="sk_test_live", base_url=BASE) as fp:
            fp.payments.retrieve("pay_x")
        assert route.calls[0].request.headers["authorization"] == "Bearer sk_test_live"

    @respx.mock
    def test_user_agent_header_sent(self) -> None:
        route = respx.get(f"{BASE}/v1/payments/pay_x").mock(
            return_value=httpx.Response(200, json={
                "payment_id": "pay_x", "merchant_id": "mer_1", "status": "succeeded",
                "amount": 100, "currency": "USD", "created": "2026-04-16T00:00:00Z",
                "metadata": {},
            })
        )
        with ForgePay(api_key="sk_test_live", base_url=BASE) as fp:
            fp.payments.retrieve("pay_x")
        assert "forgepay-python" in route.calls[0].request.headers["user-agent"]


class TestAsyncForgePay:
    async def test_all_async_resources_present(self) -> None:
        async with AsyncForgePay(api_key="sk_test_x", base_url=BASE) as fp:
            assert isinstance(fp.payments,      AsyncPaymentsResource)
            assert isinstance(fp.customers,     AsyncCustomersResource)
            assert isinstance(fp.subscriptions, AsyncSubscriptionsResource)
            assert isinstance(fp.stablecoins,   AsyncStablecoinsResource)
            assert isinstance(fp.crypto,        AsyncCryptoResource)
            assert fp.webhooks is WebhookResource

    async def test_empty_api_key_raises_async(self) -> None:
        with pytest.raises(ValueError):
            AsyncForgePay(api_key="")

    @respx.mock
    async def test_stablecoin_create_async(self) -> None:
        respx.post(f"{BASE}/v1/stablecoins").mock(return_value=httpx.Response(200, json={
            "payment_id": "sp_001",
            "coin": "USDC",
            "network": "ethereum",
            "amount": "49.00",
            "address": "0xABCDEF",
            "status": "pending",
            "expires_at": "2026-04-16T12:15:00Z",
            "created": "2026-04-16T12:00:00Z",
        }))
        async with AsyncForgePay(api_key="sk_test_x", base_url=BASE) as fp:
            sp = await fp.stablecoins.create(coin="USDC", network="ethereum", amount_usd="49.00")
        assert sp.payment_id == "sp_001"
        assert sp.coin == "USDC"

    @respx.mock
    async def test_crypto_create_async(self) -> None:
        respx.post(f"{BASE}/v1/crypto").mock(return_value=httpx.Response(200, json={
            "payment_id": "cp_001",
            "coin": "BTC",
            "amount": "0.00124",
            "amount_usd": "49.00",
            "address": "bc1qxyz",
            "confirmations": 0,
            "status": "pending",
            "expires_at": "2026-04-16T12:15:00Z",
            "created": "2026-04-16T12:00:00Z",
        }))
        async with AsyncForgePay(api_key="sk_test_x", base_url=BASE) as fp:
            cp = await fp.crypto.create(coin="BTC", amount_usd="49.00")
        assert cp.coin == "BTC"
        assert cp.amount == "0.00124"
