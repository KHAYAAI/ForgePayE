"""
Kill Bill API bridge for the MoR Layer.

Used after a successful Hyperswitch payment to create a Kill Bill subscription
for recurring billing products. Kill Bill then takes over the billing schedule
and calls Hyperswitch directly via its payment plugin for subsequent charges.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

from src.config import Settings, get_settings

logger = logging.getLogger(__name__)


class KillBillClient:
    """Thin HTTP client for Kill Bill API calls needed by the MoR Layer."""

    def __init__(self, settings: Settings) -> None:
        self._base_url = settings.killbill_base_url
        self._api_key  = settings.killbill_api_key
        self._api_secret = settings.killbill_api_secret
        self._timeout  = httpx.Timeout(10.0)

    def _headers(self, tenant_api_key: str) -> dict[str, str]:
        import base64
        creds = base64.b64encode(f"{self._api_key}:{self._api_secret}".encode()).decode()
        return {
            "Authorization":        f"Basic {creds}",
            "X-Killbill-ApiKey":    tenant_api_key,
            "X-Killbill-ApiSecret": self._api_secret,
            "Content-Type":         "application/json",
            "Accept":               "application/json",
            "X-Killbill-CreatedBy": "forgepay-mor-layer",
        }

    async def create_subscription(
        self,
        *,
        account_id: str,
        plan_name: str,
        merchant_id: str,
        payment_method_id: str | None = None,
    ) -> dict[str, Any]:
        """
        Create a Kill Bill subscription for a newly-paid checkout session.

        Kill Bill uses tenantId == merchant_id as the per-merchant API key.
        The subscription is created in ACTIVE state since the initial payment
        already succeeded via Hyperswitch checkout.
        """
        payload: dict[str, Any] = {
            "accountId":     account_id,
            "planName":      plan_name,
            "billingPeriod": "MONTHLY",
            "priceList":     "DEFAULT",
        }
        if payment_method_id:
            payload["paymentMethodId"] = payment_method_id

        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.post(
                f"{self._base_url}/1.0/kb/subscriptions",
                json=payload,
                headers=self._headers(merchant_id),
                # Skip first invoice since Hyperswitch already charged it
                params={"callCompletion": "true", "skipInvoiceGeneration": "true"},
            )
            resp.raise_for_status()
            # Kill Bill returns Location header with the new subscription URI
            location = resp.headers.get("Location", "")
            subscription_id = location.rstrip("/").split("/")[-1] if location else ""
            logger.info(
                "Kill Bill subscription created: subscription_id=%s plan=%s merchant=%s",
                subscription_id, plan_name, merchant_id,
            )
            return {"subscription_id": subscription_id, "status": "active"}

    async def cancel_subscription(
        self,
        subscription_id: str,
        merchant_id: str,
        *,
        policy: str = "END_OF_TERM",
    ) -> None:
        """Cancel a Kill Bill subscription (used for refunds / forced cancellations)."""
        async with httpx.AsyncClient(timeout=self._timeout) as client:
            resp = await client.delete(
                f"{self._base_url}/1.0/kb/subscriptions/{subscription_id}",
                headers=self._headers(merchant_id),
                params={"entitlementPolicy": policy, "billingPolicy": policy},
            )
            resp.raise_for_status()
            logger.info("Kill Bill subscription cancelled: %s", subscription_id)


_client: KillBillClient | None = None


def get_killbill_client() -> KillBillClient:
    global _client
    if _client is None:
        _client = KillBillClient(get_settings())
    return _client
