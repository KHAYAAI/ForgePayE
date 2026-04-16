from __future__ import annotations

from typing import Any

from forgepay._http import SyncTransport, AsyncTransport
from forgepay.types import Subscription, SubscriptionCreateParams, ListResponse


class SubscriptionsResource:
    def __init__(self, transport: SyncTransport) -> None:
        self._t = transport

    def create(self, **kwargs: Any) -> Subscription:
        params = SubscriptionCreateParams(**kwargs)
        body   = params.model_dump(exclude_none=True, exclude={"idempotency_key"})
        raw    = self._t.request(
            "POST", "/v1/subscriptions",
            json=body,
            idempotency_key=params.idempotency_key,
        )
        return Subscription.model_validate(raw)

    def retrieve(self, subscription_id: str) -> Subscription:
        return Subscription.model_validate(
            self._t.request("GET", f"/v1/subscriptions/{subscription_id}")
        )

    def cancel(self, subscription_id: str, *, at_period_end: bool = True) -> Subscription:
        raw = self._t.request(
            "DELETE",
            f"/v1/subscriptions/{subscription_id}",
            params={"at_period_end": "true" if at_period_end else "false"},
        )
        return Subscription.model_validate(raw)

    def list(self, **params: Any) -> ListResponse[Subscription]:  # type: ignore[type-arg]
        raw = self._t.request("GET", "/v1/subscriptions", params=params or None)
        return ListResponse[Subscription].model_validate(raw)


class AsyncSubscriptionsResource:
    def __init__(self, transport: AsyncTransport) -> None:
        self._t = transport

    async def create(self, **kwargs: Any) -> Subscription:
        params = SubscriptionCreateParams(**kwargs)
        body   = params.model_dump(exclude_none=True, exclude={"idempotency_key"})
        raw    = await self._t.request(
            "POST", "/v1/subscriptions",
            json=body,
            idempotency_key=params.idempotency_key,
        )
        return Subscription.model_validate(raw)

    async def retrieve(self, subscription_id: str) -> Subscription:
        return Subscription.model_validate(
            await self._t.request("GET", f"/v1/subscriptions/{subscription_id}")
        )

    async def cancel(self, subscription_id: str, *, at_period_end: bool = True) -> Subscription:
        raw = await self._t.request(
            "DELETE",
            f"/v1/subscriptions/{subscription_id}",
            params={"at_period_end": "true" if at_period_end else "false"},
        )
        return Subscription.model_validate(raw)

    async def list(self, **params: Any) -> ListResponse[Subscription]:  # type: ignore[type-arg]
        raw = await self._t.request("GET", "/v1/subscriptions", params=params or None)
        return ListResponse[Subscription].model_validate(raw)
