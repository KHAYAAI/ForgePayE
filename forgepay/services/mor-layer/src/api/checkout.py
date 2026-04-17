"""
Checkout Session API

Creates Hyperswitch payment intents and returns a client_secret
for the frontend to complete checkout using Hyperswitch.js.

Session lifecycle:
  POST  /v1/checkout/sessions  → create session, store in Redis (TTL 1h) + Postgres
  GET   /v1/checkout/sessions/:id → look up Redis first, then Postgres, then Hyperswitch
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated

import redis.asyncio as aioredis
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from src.bridges.hyperswitch import (
    HyperswitchClient,
    PaymentCreateRequest,
    get_hyperswitch_client,
)
from src.config import Settings, get_settings
from src.db.models import CheckoutSession
from src.db.session import get_db
from src.models.checkout import (
    CheckoutLineItem,
    CheckoutSessionCreate,
    CheckoutSessionResponse,
    TaxBreakdown,
)
from src.tax.calculator import TaxCalculator

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/checkout", tags=["checkout"])

# Redis client singleton
_redis_client: aioredis.Redis | None = None


def get_redis() -> aioredis.Redis:
    global _redis_client
    if _redis_client is None:
        settings = get_settings()
        _redis_client = aioredis.from_url(settings.redis_url, decode_responses=True)
    return _redis_client


def _sum_line_items(items: list[CheckoutLineItem]) -> int:
    return sum(item.amount * item.quantity for item in items)


@router.post("/sessions", response_model=CheckoutSessionResponse, status_code=201)
async def create_checkout_session(
    body: CheckoutSessionCreate,
    hs:   Annotated[HyperswitchClient, Depends(get_hyperswitch_client)],
    cfg:  Annotated[Settings, Depends(get_settings)],
    db:   Annotated[AsyncSession, Depends(get_db)],
) -> CheckoutSessionResponse:
    """
    Create a checkout session.

    Flow:
      1. Sum line items → subtotal
      2. Calculate tax (internal engine or Avalara/TaxJar)
      3. Create a Hyperswitch PaymentIntent for (subtotal + tax)
      4. Store session in Redis (1h TTL) + Postgres
      5. Return client_secret so frontend can mount Hyperswitch.js
    """
    subtotal_cents = _sum_line_items(body.line_items)

    tax_cents  = 0
    tax_breakdown: list[TaxBreakdown] = []

    if body.collect_tax and body.customer_country:
        calc = TaxCalculator()
        tax_result = await calc.calculate(
            amount_cents=subtotal_cents,
            country=body.customer_country,
            state=body.customer_state,
            postal_code=body.customer_postal_code,
        )
        if tax_result:
            tax_cents = tax_result.amount_cents
            tax_breakdown = [
                TaxBreakdown(
                    jurisdiction=tax_result.jurisdiction,
                    tax_type=tax_result.tax_type,
                    rate=tax_result.rate,
                    amount=tax_result.amount_cents,
                    inclusive=tax_result.inclusive,
                )
            ]

    total_cents = subtotal_cents + tax_cents
    session_id  = f"cs_{uuid.uuid4().hex}"
    expires_at  = datetime.now(UTC) + timedelta(hours=1)

    metadata: dict[str, str] = {
        **body.metadata,
        "forgepay_session_id":  session_id,
        "forgepay_merchant_id": body.merchant_id,
        "tax_cents":            str(tax_cents),
        "subtotal_cents":       str(subtotal_cents),
    }

    payment_req = PaymentCreateRequest(
        amount=total_cents,
        currency=body.currency,
        confirm=False,
        customer_id=body.customer_id,
        description=", ".join(item.name for item in body.line_items),
        return_url=body.success_url,
        metadata=metadata,
        idempotency_key=body.idempotency_key or session_id,
    )

    try:
        payment = await hs.create_payment(payment_req)
    except Exception as exc:
        logger.error("Hyperswitch payment creation failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Payment engine unavailable.") from exc

    if not payment.client_secret:
        raise HTTPException(status_code=500, detail="Payment engine did not return a client_secret.")

    # Store in DB
    session_row = CheckoutSession(
        id=session_id,
        merchant_id=body.merchant_id,
        payment_id=payment.payment_id,
        status="pending",
        currency=body.currency,
        amount_subtotal=subtotal_cents,
        amount_tax=tax_cents,
        amount_total=total_cents,
        customer_id=body.customer_id,
        customer_email=body.customer_email,
        success_url=body.success_url,
        cancel_url=body.cancel_url,
        metadata_=metadata,
        tax_breakdown=[tb.model_dump() for tb in tax_breakdown] if tax_breakdown else None,
        expires_at=expires_at,
    )
    db.add(session_row)
    await db.commit()

    # Cache in Redis for fast retrieval (1h TTL)
    redis = get_redis()
    await redis.setex(
        f"session:{session_id}",
        3600,
        json.dumps({"payment_id": payment.payment_id, "status": "pending"}),
    )

    logger.info("Checkout session created: session_id=%s payment_id=%s total=%s %s",
                session_id, payment.payment_id, total_cents, body.currency)

    return CheckoutSessionResponse(
        session_id=session_id,
        status="pending",
        payment_id=payment.payment_id,
        client_secret=payment.client_secret,
        publishable_key=cfg.hyperswitch_publishable_key,
        amount_subtotal=subtotal_cents,
        amount_tax=tax_cents,
        amount_total=total_cents,
        currency=body.currency,
        tax_breakdown=tax_breakdown,
        expires_at=expires_at.isoformat(),
        success_url=body.success_url,
        cancel_url=body.cancel_url,
    )


@router.get("/sessions/{session_id}", response_model=CheckoutSessionResponse)
async def retrieve_checkout_session(
    session_id: str,
    hs:  Annotated[HyperswitchClient, Depends(get_hyperswitch_client)],
    cfg: Annotated[Settings, Depends(get_settings)],
    db:  Annotated[AsyncSession, Depends(get_db)],
) -> CheckoutSessionResponse:
    """
    Retrieve a checkout session by ID.
    Used by the success/cancel redirect pages to confirm payment status.

    Lookup order:
      1. Redis cache (fast path, 1h TTL)
      2. Postgres (source of truth)
      3. Hyperswitch payment status (to verify latest state)
    """
    # 1. Try Redis cache for payment_id
    redis = get_redis()
    cached_raw = await redis.get(f"session:{session_id}")
    cached: dict | None = json.loads(cached_raw) if cached_raw else None

    # 2. Load full record from Postgres
    result = await db.execute(select(CheckoutSession).where(CheckoutSession.id == session_id))
    session_row: CheckoutSession | None = result.scalar_one_or_none()

    if session_row is None and cached is None:
        raise HTTPException(status_code=404, detail="Session not found")

    payment_id = (session_row.payment_id if session_row else None) or (cached or {}).get("payment_id", "")
    status_val = (session_row.status if session_row else None) or "pending"

    # 3. If still pending, check live payment status from Hyperswitch
    if status_val == "pending" and payment_id:
        try:
            payment = await hs.retrieve_payment(payment_id)
            if payment.status in ("succeeded", "charged"):
                status_val = "completed"
            elif payment.status in ("failed", "cancelled"):
                status_val = "failed"
        except Exception:
            pass

    return CheckoutSessionResponse(
        session_id=session_id,
        status=status_val,
        payment_id=payment_id,
        client_secret=None,
        publishable_key=cfg.hyperswitch_publishable_key,
        amount_subtotal=session_row.amount_subtotal if session_row else 0,
        amount_tax=session_row.amount_tax if session_row else 0,
        amount_total=session_row.amount_total if session_row else 0,
        currency=session_row.currency if session_row else "USD",
        tax_breakdown=[],
        expires_at=session_row.expires_at.isoformat() if session_row else "",
        success_url=session_row.success_url if session_row else "",
        cancel_url=session_row.cancel_url if session_row else None,
    )
