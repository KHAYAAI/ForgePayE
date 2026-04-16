from __future__ import annotations

from typing import Any

from forgepay._http import SyncTransport, AsyncTransport
from forgepay.types import UsageRecord, UsageReportParams


class UsageResource:
    def __init__(self, transport: SyncTransport) -> None:
        self._t = transport

    def report(self, **kwargs: Any) -> UsageRecord:
        params = UsageReportParams(**kwargs)
        body   = params.model_dump(exclude_none=True, exclude={"idempotency_key"})
        raw    = self._t.request(
            "POST",
            f"/v1/subscriptions/{params.subscription_id}/usage",
            json=body,
            idempotency_key=params.idempotency_key,
        )
        return UsageRecord.model_validate(raw)

    def list(self, subscription_id: str, **params: Any) -> list[UsageRecord]:
        raw = self._t.request(
            "GET", f"/v1/subscriptions/{subscription_id}/usage", params=params or None
        )
        return [UsageRecord.model_validate(r) for r in (raw or [])]


class AsyncUsageResource:
    def __init__(self, transport: AsyncTransport) -> None:
        self._t = transport

    async def report(self, **kwargs: Any) -> UsageRecord:
        params = UsageReportParams(**kwargs)
        body   = params.model_dump(exclude_none=True, exclude={"idempotency_key"})
        raw    = await self._t.request(
            "POST",
            f"/v1/subscriptions/{params.subscription_id}/usage",
            json=body,
            idempotency_key=params.idempotency_key,
        )
        return UsageRecord.model_validate(raw)

    async def list(self, subscription_id: str, **params: Any) -> list[UsageRecord]:
        raw = await self._t.request(
            "GET", f"/v1/subscriptions/{subscription_id}/usage", params=params or None
        )
        return [UsageRecord.model_validate(r) for r in (raw or [])]
