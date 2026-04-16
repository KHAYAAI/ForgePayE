from __future__ import annotations

from typing import Any

from forgepay._http import SyncTransport, AsyncTransport
from forgepay.types import Payment, PaymentCreateParams, Refund, ListResponse


class PaymentsResource:
    def __init__(self, transport: SyncTransport) -> None:
        self._t = transport

    def create(self, **kwargs: Any) -> Payment:
        params = PaymentCreateParams(**kwargs)
        body   = params.model_dump(exclude_none=True, exclude={"idempotency_key"})
        raw    = self._t.request(
            "POST", "/v1/payments",
            json=body,
            idempotency_key=params.idempotency_key,
        )
        return Payment.model_validate(raw)

    def retrieve(self, payment_id: str) -> Payment:
        return Payment.model_validate(self._t.request("GET", f"/v1/payments/{payment_id}"))

    def list(self, **params: Any) -> ListResponse[Payment]:  # type: ignore[type-arg]
        raw = self._t.request("GET", "/v1/payments", params=params or None)
        return ListResponse[Payment].model_validate(raw)

    def confirm(self, payment_id: str, **kwargs: Any) -> Payment:
        raw = self._t.request("POST", f"/v1/payments/{payment_id}/confirm", json=kwargs or None)
        return Payment.model_validate(raw)

    def cancel(self, payment_id: str) -> Payment:
        raw = self._t.request("POST", f"/v1/payments/{payment_id}/cancel")
        return Payment.model_validate(raw)

    def refund(self, payment_id: str, *, amount: int | None = None) -> Refund:
        body: dict[str, Any] = {"payment_id": payment_id}
        if amount is not None:
            body["amount"] = amount
        raw = self._t.request("POST", "/v1/refunds", json=body)
        return Refund.model_validate(raw)


class AsyncPaymentsResource:
    def __init__(self, transport: AsyncTransport) -> None:
        self._t = transport

    async def create(self, **kwargs: Any) -> Payment:
        params = PaymentCreateParams(**kwargs)
        body   = params.model_dump(exclude_none=True, exclude={"idempotency_key"})
        raw    = await self._t.request(
            "POST", "/v1/payments",
            json=body,
            idempotency_key=params.idempotency_key,
        )
        return Payment.model_validate(raw)

    async def retrieve(self, payment_id: str) -> Payment:
        return Payment.model_validate(await self._t.request("GET", f"/v1/payments/{payment_id}"))

    async def list(self, **params: Any) -> ListResponse[Payment]:  # type: ignore[type-arg]
        raw = await self._t.request("GET", "/v1/payments", params=params or None)
        return ListResponse[Payment].model_validate(raw)

    async def confirm(self, payment_id: str, **kwargs: Any) -> Payment:
        raw = await self._t.request(
            "POST", f"/v1/payments/{payment_id}/confirm", json=kwargs or None
        )
        return Payment.model_validate(raw)

    async def cancel(self, payment_id: str) -> Payment:
        raw = await self._t.request("POST", f"/v1/payments/{payment_id}/cancel")
        return Payment.model_validate(raw)

    async def refund(self, payment_id: str, *, amount: int | None = None) -> Refund:
        body: dict[str, Any] = {"payment_id": payment_id}
        if amount is not None:
            body["amount"] = amount
        raw = await self._t.request("POST", "/v1/refunds", json=body)
        return Refund.model_validate(raw)
