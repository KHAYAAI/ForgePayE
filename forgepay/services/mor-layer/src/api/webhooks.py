"""
Hyperswitch → MoR Layer webhook handler.

Hyperswitch posts payment events here.
We verify the signature, map the event to MoR business logic,
then forward a canonical event to the unified-router.
"""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime
from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update

from src.bridges.hyperswitch import verify_hyperswitch_webhook
from src.config import Settings, get_settings
from src.db.models import CheckoutSession
from src.db.session import get_db

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/webhooks", tags=["webhooks"])

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
    cfg:     Annotated[Settings, Depends(get_settings)],
    db:      Annotated[AsyncSession, Depends(get_db)],
) -> dict:
    raw_body  = await request.body()
    signature = request.headers.get("x-webhook-signature-512", "")

    if not verify_hyperswitch_webhook(raw_body, signature, cfg.hyperswitch_webhook_secret):
        logger.warning("Invalid Hyperswitch webhook signature")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid webhook signature")

    try:
        event = json.loads(raw_body)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    event_type = event.get("event_type", "")
    logger.info("Received Hyperswitch event: %s", event_type)

    if event_type in _PAYMENT_SUCCESS_EVENTS:
        await _handle_payment_succeeded(event, cfg, db)
    elif event_type in _PAYMENT_FAILED_EVENTS:
        await _handle_payment_failed(event, cfg, db)

    await _forward_to_unified_router(raw_body, signature, cfg)

    return {"received": True}


async def _handle_payment_succeeded(event: dict, cfg: Settings, db: AsyncSession) -> None:
    payment_obj = event.get("content", {}).get("object", {})
    payment_id  = payment_obj.get("payment_id", "")
    metadata    = payment_obj.get("metadata", {})
    session_id  = metadata.get("forgepay_session_id", "")

    logger.info("Payment succeeded: payment_id=%s session_id=%s", payment_id, session_id)

    if session_id:
        await db.execute(
            update(CheckoutSession)
            .where(CheckoutSession.id == session_id)
            .values(status="completed", completed_at=datetime.now(UTC))
        )
        await db.commit()
        logger.info("Checkout session %s marked completed", session_id)

    # Fulfillment webhook to merchant will be dispatched by the unified-router
    # after it receives the forwarded event (see _forward_to_unified_router below).


async def _handle_payment_failed(event: dict, cfg: Settings, db: AsyncSession) -> None:
    payment_obj   = event.get("content", {}).get("object", {})
    payment_id    = payment_obj.get("payment_id", "")
    error_message = payment_obj.get("error_message", "unknown error")
    metadata      = payment_obj.get("metadata", {})
    session_id    = metadata.get("forgepay_session_id", "")

    logger.warning("Payment failed: payment_id=%s error=%s", payment_id, error_message)

    if session_id:
        await db.execute(
            update(CheckoutSession)
            .where(CheckoutSession.id == session_id)
            .values(status="failed", failure_reason=error_message)
        )
        await db.commit()
        logger.info("Checkout session %s marked failed", session_id)

    # Kill Bill dunning: if metadata["forgepay_subscription_id"] is set,
    # Kill Bill's own retry schedule (1, 1, 3 days — configured in catalog) handles
    # payment retries automatically via the billing-engine's payment plugin.


async def _forward_to_unified_router(raw_body: bytes, original_signature: str, cfg: Settings) -> None:
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            await client.post(
                f"{cfg.unified_router_url}/webhooks/hyperswitch",
                content=raw_body,
                headers={
                    "Content-Type":              "application/json",
                    "x-webhook-signature-512":   original_signature,
                    "x-forgepay-source":         "mor-layer",
                },
            )
    except Exception as exc:
        logger.error("Failed to forward event to unified-router: %s", exc)
