from __future__ import annotations

from typing import Any

from forgepay._http import AsyncTransport, SyncTransport
from forgepay.types import Customer, CustomerCreateParams, ListResponse


class CustomersResource:
    def __init__(self, transport: SyncTransport) -> None:
        self._t = transport

    def create(self, **kwargs: Any) -> Customer:
        params = CustomerCreateParams(**kwargs)
        raw    = self._t.request("POST", "/v1/customers", json=params.model_dump(exclude_none=True))
        return Customer.model_validate(raw)

    def retrieve(self, customer_id: str) -> Customer:
        return Customer.model_validate(self._t.request("GET", f"/v1/customers/{customer_id}"))

    def update(self, customer_id: str, **kwargs: Any) -> Customer:
        raw = self._t.request("POST", f"/v1/customers/{customer_id}", json=kwargs)
        return Customer.model_validate(raw)

    def list(self, **params: Any) -> ListResponse[Customer]:
        raw = self._t.request("GET", "/v1/customers", params=params or None)
        return ListResponse[Customer].model_validate(raw)

    def delete(self, customer_id: str) -> dict[str, Any]:
        result: dict[str, Any] = self._t.request("DELETE", f"/v1/customers/{customer_id}")
        return result


class AsyncCustomersResource:
    def __init__(self, transport: AsyncTransport) -> None:
        self._t = transport

    async def create(self, **kwargs: Any) -> Customer:
        params = CustomerCreateParams(**kwargs)
        raw    = await self._t.request(
            "POST", "/v1/customers", json=params.model_dump(exclude_none=True)
        )
        return Customer.model_validate(raw)

    async def retrieve(self, customer_id: str) -> Customer:
        return Customer.model_validate(
            await self._t.request("GET", f"/v1/customers/{customer_id}")
        )

    async def update(self, customer_id: str, **kwargs: Any) -> Customer:
        raw = await self._t.request("POST", f"/v1/customers/{customer_id}", json=kwargs)
        return Customer.model_validate(raw)

    async def list(self, **params: Any) -> ListResponse[Customer]:
        raw = await self._t.request("GET", "/v1/customers", params=params or None)
        return ListResponse[Customer].model_validate(raw)

    async def delete(self, customer_id: str) -> dict[str, Any]:
        result: dict[str, Any] = await self._t.request("DELETE", f"/v1/customers/{customer_id}")
        return result
