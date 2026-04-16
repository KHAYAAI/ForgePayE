from __future__ import annotations

from typing import Any

from forgepay._http import SyncTransport, AsyncTransport
from forgepay.types import StablecoinPayment, StablecoinCreateParams, ListResponse


class StablecoinsResource:
    def __init__(self, transport: SyncTransport) -> None:
        self._t = transport

    def create(self, **kwargs: Any) -> StablecoinPayment:
        params = StablecoinCreateParams(**kwargs)
        body   = params.model_dump(exclude_none=True, exclude={"idempotency_key"})
        raw    = self._t.request(
            "POST", "/v1/stablecoins",
            json=body,
            idempotency_key=params.idempotency_key,
        )
        return StablecoinPayment.model_validate(raw)

    def retrieve(self, payment_id: str) -> StablecoinPayment:
        return StablecoinPayment.model_validate(
            self._t.request("GET", f"/v1/stablecoins/{payment_id}")
        )

    def list(self, **params: Any) -> ListResponse[StablecoinPayment]:  # type: ignore[type-arg]
        raw = self._t.request("GET", "/v1/stablecoins", params=params or None)
        return ListResponse[StablecoinPayment].model_validate(raw)


class AsyncStablecoinsResource:
    def __init__(self, transport: AsyncTransport) -> None:
        self._t = transport

    async def create(self, **kwargs: Any) -> StablecoinPayment:
        params = StablecoinCreateParams(**kwargs)
        body   = params.model_dump(exclude_none=True, exclude={"idempotency_key"})
        raw    = await self._t.request(
            "POST", "/v1/stablecoins",
            json=body,
            idempotency_key=params.idempotency_key,
        )
        return StablecoinPayment.model_validate(raw)

    async def retrieve(self, payment_id: str) -> StablecoinPayment:
        return StablecoinPayment.model_validate(
            await self._t.request("GET", f"/v1/stablecoins/{payment_id}")
        )

    async def list(self, **params: Any) -> ListResponse[StablecoinPayment]:  # type: ignore[type-arg]
        raw = await self._t.request("GET", "/v1/stablecoins", params=params or None)
        return ListResponse[StablecoinPayment].model_validate(raw)
