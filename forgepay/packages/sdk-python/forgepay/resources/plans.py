from __future__ import annotations

from typing import Any

from forgepay._http import AsyncTransport, SyncTransport
from forgepay.types import ListResponse, Plan


class PlansResource:
    def __init__(self, transport: SyncTransport) -> None:
        self._t = transport

    def retrieve(self, plan_id: str) -> Plan:
        return Plan.model_validate(self._t.request("GET", f"/v1/plans/{plan_id}"))

    def list(self, **params: Any) -> ListResponse[Plan]:
        raw = self._t.request("GET", "/v1/plans", params=params or None)
        return ListResponse[Plan].model_validate(raw)


class AsyncPlansResource:
    def __init__(self, transport: AsyncTransport) -> None:
        self._t = transport

    async def retrieve(self, plan_id: str) -> Plan:
        return Plan.model_validate(await self._t.request("GET", f"/v1/plans/{plan_id}"))

    async def list(self, **params: Any) -> ListResponse[Plan]:
        raw = await self._t.request("GET", "/v1/plans", params=params or None)
        return ListResponse[Plan].model_validate(raw)
