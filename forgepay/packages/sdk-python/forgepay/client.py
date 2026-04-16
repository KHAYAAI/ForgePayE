"""
Top-level ForgePay SDK clients — sync and async.

    # Sync
    fp = ForgePay(api_key="sk_live_...")
    payment = fp.payments.create(amount=4900, currency="USD", ...)

    # Async
    async with AsyncForgePay(api_key="sk_live_...") as fp:
        payment = await fp.payments.create(amount=4900, currency="USD", ...)
"""

from __future__ import annotations

from forgepay._http import (
    AsyncTransport,
    DEFAULT_BASE_URL,
    DEFAULT_TIMEOUT,
    SyncTransport,
)
from forgepay.resources.crypto        import AsyncCryptoResource, CryptoResource
from forgepay.resources.customers     import AsyncCustomersResource, CustomersResource
from forgepay.resources.payments      import AsyncPaymentsResource, PaymentsResource
from forgepay.resources.plans         import AsyncPlansResource, PlansResource
from forgepay.resources.stablecoins   import AsyncStablecoinsResource, StablecoinsResource
from forgepay.resources.subscriptions import AsyncSubscriptionsResource, SubscriptionsResource
from forgepay.resources.usage         import AsyncUsageResource, UsageResource
from forgepay.resources.webhooks      import WebhookResource


class ForgePay:
    """Synchronous ForgePay client."""

    webhooks: type[WebhookResource] = WebhookResource  # static helper — no transport needed

    def __init__(
        self,
        api_key:  str,
        *,
        base_url: str   = DEFAULT_BASE_URL,
        timeout:  float = DEFAULT_TIMEOUT,
    ) -> None:
        if not api_key:
            raise ValueError("api_key must be provided")

        self._transport   = SyncTransport(api_key=api_key, base_url=base_url, timeout=timeout)
        self.payments      = PaymentsResource(self._transport)
        self.customers     = CustomersResource(self._transport)
        self.subscriptions = SubscriptionsResource(self._transport)
        self.plans         = PlansResource(self._transport)
        self.usage         = UsageResource(self._transport)
        self.stablecoins   = StablecoinsResource(self._transport)
        self.crypto        = CryptoResource(self._transport)

    def close(self) -> None:
        self._transport.close()

    def __enter__(self) -> "ForgePay":
        return self

    def __exit__(self, *_: object) -> None:
        self.close()


class AsyncForgePay:
    """Asynchronous ForgePay client — use as an async context manager."""

    webhooks: type[WebhookResource] = WebhookResource

    def __init__(
        self,
        api_key:  str,
        *,
        base_url: str   = DEFAULT_BASE_URL,
        timeout:  float = DEFAULT_TIMEOUT,
    ) -> None:
        if not api_key:
            raise ValueError("api_key must be provided")

        self._transport   = AsyncTransport(api_key=api_key, base_url=base_url, timeout=timeout)
        self.payments      = AsyncPaymentsResource(self._transport)
        self.customers     = AsyncCustomersResource(self._transport)
        self.subscriptions = AsyncSubscriptionsResource(self._transport)
        self.plans         = AsyncPlansResource(self._transport)
        self.usage         = AsyncUsageResource(self._transport)
        self.stablecoins   = AsyncStablecoinsResource(self._transport)
        self.crypto        = AsyncCryptoResource(self._transport)

    async def aclose(self) -> None:
        await self._transport.aclose()

    async def __aenter__(self) -> "AsyncForgePay":
        return self

    async def __aexit__(self, *_: object) -> None:
        await self.aclose()
