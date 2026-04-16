from __future__ import annotations

from typing import Any

from forgepay._http import SyncTransport, AsyncTransport
from forgepay.types import CryptoPayment, CryptoCreateParams, ListResponse


class CryptoResource:
    def __init__(self, transport: SyncTransport) -> None:
        self._t = transport

    def create(self, **kwargs: Any) -> CryptoPayment:
        params = CryptoCreateParams(**kwargs)
        body   = params.model_dump(exclude_none=True, exclude={"idempotency_key"})
        raw    = self._t.request(
            "POST", "/v1/crypto",
            json=body,
            idempotency_key=params.idempotency_key,
        )
        return CryptoPayment.model_validate(raw)

    def retrieve(self, payment_id: str) -> CryptoPayment:
        return CryptoPayment.model_validate(
            self._t.request("GET", f"/v1/crypto/{payment_id}")
        )

    def list(self, **params: Any) -> ListResponse[CryptoPayment]:  # type: ignore[type-arg]
        raw = self._t.request("GET", "/v1/crypto", params=params or None)
        return ListResponse[CryptoPayment].model_validate(raw)


class AsyncCryptoResource:
    def __init__(self, transport: AsyncTransport) -> None:
        self._t = transport

    async def create(self, **kwargs: Any) -> CryptoPayment:
        params = CryptoCreateParams(**kwargs)
        body   = params.model_dump(exclude_none=True, exclude={"idempotency_key"})
        raw    = await self._t.request(
            "POST", "/v1/crypto",
            json=body,
            idempotency_key=params.idempotency_key,
        )
        return CryptoPayment.model_validate(raw)

    async def retrieve(self, payment_id: str) -> CryptoPayment:
        return CryptoPayment.model_validate(
            await self._t.request("GET", f"/v1/crypto/{payment_id}")
        )

    async def list(self, **params: Any) -> ListResponse[CryptoPayment]:  # type: ignore[type-arg]
        raw = await self._t.request("GET", "/v1/crypto", params=params or None)
        return ListResponse[CryptoPayment].model_validate(raw)
