"""
Hyperswitch → MoR Layer webhook handler.

Hyperswitch posts payment events here.
We verify the signature, map the event to MoR business logic,
then forward a canonical event to the unified-router.

This replaces Polar's stripe webhook handler:
  @router.post("/webhooks/stripe")
  async def stripe_webhook(request: Request): ...
"""

from __future__ import annotations

import json
import logging
from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, status

from src.bridges.hyperswitch import verify_hyperswitch_webhook
from src.config import Settings, get_settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/webhooks", tags=["webhooks"])

# Maps Hyperswitch event types to MoR business actions
_PAYMENT_SUCCESS_EVENTS = frozenset({
    "payment_intent.succeeded",
    "payment.succeeded",
})
_PAYMENT_FAILED_EVENTS = frozenset({
    "payment_intent.payment_failed",
    "payment.failed",
})


@router.post("/hyperswitch")
async def handle_hyperswitch_webhook(
    request: Request,
    cfg: Annotated[Settings, Depends(get_settings)],
) -> dict:
    """
    Receive and process Hyperswitch payment webhooks.

    This is the entry point for all payment lifecycle events.
    Replaces the former stripe webhook handler in Polar.
    """
    raw_body  = await request.body()
    signature = request.headers.get("x-webhook-signature-512", "")

    # ── 1. Verify HMAC signature ──────────────────────────────────────────
    if not verify_hyperswitch_webhook(raw_body, signature, cfg.hyperswitch_webhook_secret):
        logger.warning("Invalid Hyperswitch webhook signature")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid webhook signature",
        )

    # ── 2. Parse event ────────────────────────────────────────────────────
    try:
        event = json.loads(raw_body)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    event_type = event.get("event_type", "")
    logger.info("Received Hyperswitch event: %s", event_type)

    # ── 3. Business logic per event type ──────────────────────────────────
    if event_type in _PAYMENT_SUCCESS_EVENTS:
        await _handle_payment_succeeded(event, cfg)
    elif event_type in _PAYMENT_FAILED_EVENTS:
        await _handle_payment_failed(event, cfg)

    # ── 4. Always forward to unified-router for canonical event log ───────
    await _forward_to_unified_router(raw_body, signature, cfg)

    return {"received": True}


async def _handle_payment_succeeded(event: dict, cfg: Settings) -> None:
    """
    Handle a successful payment.

    Actions:
    - Mark checkout session as complete
    - Trigger benefit fulfillment (e.g., license key delivery, SaaS provisioning)
    - Send receipt email
    - Update subscription status if applicable
    """
    payment_obj = event.get("content", {}).get("object", {})
    payment_id  = payment_obj.get("payment_id", "")
    metadata    = payment_obj.get("metadata", {})
    session_id  = metadata.get("forgepay_session_id", "")
    merchant_id = metadata.get("forgepay_merchant_id", "")

    logger.info(
        "Payment succeeded: payment_id=%s session_id=%s merchant_id=%s",
        payment_id, session_id, merchant_id,
    )
    # LAUNCH BLOCKER: no business logic runs on payment success. Merchants will
    # never receive fulfillment (SaaS provisioning, license keys, downloads, etc.)
    # and no receipts will be sent. Implement before accepting real payments:
    #
    # 1. UPDATE checkout_sessions SET status='completed', completed_at=now()
    #      WHERE id = session_id
    # 2. Look up the merchant's fulfillment_webhook_url and POST the order details
    #    (or directly provision via the merchant's fulfillment provider API).
    # 3. Enqueue a receipt email task (e.g., via a Celery/ARQ worker):
    #      await queue.enqueue('send_receipt', payment_id=payment_id, ...)


async def _handle_payment_failed(event: dict, cfg: Settings) -> None:
    """
    Handle a failed payment.
    - Update session status to "failed"
    - Log failure reason for merchant dashboard
    - If subscription payment: trigger dunning flow via billing-engine
    """
    payment_obj   = event.get("content", {}).get("object", {})
    payment_id    = payment_obj.get("payment_id", "")
    error_message = payment_obj.get("error_message", "")
    metadata      = payment_obj.get("metadata", {})

    logger.warning(
        "Payment failed: payment_id=%s error=%s session=%s",
        payment_id, error_message, metadata.get("forgepay_session_id", ""),
    )
    # LAUNCH BLOCKER: no action taken on payment failure. Without this:
    # - Merchants see successful payments in their dashboard but no failures logged.
    # - Subscription dunning never starts (Kill Bill won't know to retry).
    #
    # 1. UPDATE checkout_sessions SET status='failed', failure_reason=error_message
    #      WHERE id = session_id
    # 2. If metadata["forgepay_subscription_id"] is set, POST to Kill Bill:
    #      POST /1.0/kb/accounts/{account_id}/payments?externalKey=... (retry trigger)
    #    or let Kill Bill's org.killbill.payment.retry.days schedule handle it
    #    automatically once the payment plugin returns PAYMENT_FAILURE.


async def _forward_to_unified_router(
    raw_body: bytes,
    original_signature: str,
    cfg: Settings,
) -> None:
    """Forward the raw Hyperswitch webhook to the unified-router for canonical processing."""
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            await client.post(
                f"{cfg.unified_router_url}/webhooks/hyperswitch",
                content=raw_body,
                headers={
                    "Content-Type": "application/json",
                    "x-webhook-signature-512": original_signature,
                    "x-forgepay-source": "mor-layer",
                },
            )
    except Exception as exc:
        # Don't fail the webhook ack if forwarding fails — unified-router has its own retry
        logger.error("Failed to forward event to unified-router: %s", exc)
