"""
Checkout Session API

Creates Hyperswitch payment intents and returns a client_secret
for the frontend to complete checkout using Hyperswitch.js.

This replaces Polar's stripe.checkout.Session.create() calls.
"""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status

from src.bridges.hyperswitch import (
    HyperswitchClient,
    PaymentCreateRequest,
    get_hyperswitch_client,
)
from src.config import Settings, get_settings
from src.models.checkout import (
    CheckoutLineItem,
    CheckoutSessionCreate,
    CheckoutSessionResponse,
    TaxBreakdown,
)
from src.tax.calculator import TaxCalculator

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/checkout", tags=["checkout"])


def _sum_line_items(items: list[CheckoutLineItem]) -> int:
    return sum(item.amount * item.quantity for item in items)


@router.post("/sessions", response_model=CheckoutSessionResponse, status_code=201)
async def create_checkout_session(
    body: CheckoutSessionCreate,
    hs:   Annotated[HyperswitchClient, Depends(get_hyperswitch_client)],
    cfg:  Annotated[Settings, Depends(get_settings)],
) -> CheckoutSessionResponse:
    """
    Create a checkout session.

    Flow:
      1. Sum line items → subtotal
      2. Calculate tax (internal engine or Avalara/TaxJar)
      3. Create a Hyperswitch PaymentIntent for (subtotal + tax)
      4. Return client_secret so frontend can mount Hyperswitch.js

    Replaces:
      stripe.checkout.Session.create(...)
    """
    # ── 1. Calculate subtotal ─────────────────────────────────────────────
    subtotal_cents = _sum_line_items(body.line_items)

    # ── 2. Calculate tax ──────────────────────────────────────────────────
    tax_result = None
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

    # ── 3. Build metadata ─────────────────────────────────────────────────
    session_id = f"cs_{uuid.uuid4().hex}"
    metadata: dict[str, str] = {
        **body.metadata,
        "forgepay_session_id": session_id,
        "forgepay_merchant_id": body.merchant_id,
        "tax_cents": str(tax_cents),
        "subtotal_cents": str(subtotal_cents),
    }
    if tax_result:
        metadata["tax_jurisdiction"]  = tax_result.jurisdiction
        metadata["tax_type"]          = tax_result.tax_type
        metadata["tax_rate"]          = str(tax_result.rate)

    # ── 4. Create Hyperswitch PaymentIntent ───────────────────────────────
    payment_req = PaymentCreateRequest(
        amount=total_cents,
        currency=body.currency,
        confirm=False,          # frontend confirms with payment method
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
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Payment engine unavailable. Please retry.",
        ) from exc

    if not payment.client_secret:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Payment engine did not return a client_secret.",
        )

    expires_at = (datetime.now(UTC) + timedelta(hours=1)).isoformat()

    logger.info(
        "Checkout session created: session_id=%s payment_id=%s total=%s %s",
        session_id, payment.payment_id, total_cents, body.currency,
    )

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
        expires_at=expires_at,
        success_url=body.success_url,
        cancel_url=body.cancel_url,
    )


@router.get("/sessions/{session_id}", response_model=CheckoutSessionResponse)
async def retrieve_checkout_session(
    session_id: str,
    hs: Annotated[HyperswitchClient, Depends(get_hyperswitch_client)],
    cfg: Annotated[Settings, Depends(get_settings)],
) -> CheckoutSessionResponse:
    """
    Retrieve a checkout session by ID.
    Used by the success/cancel redirect pages to confirm payment status.
    """
    # TODO: look up session→payment_id mapping in Redis/DB
    # For now, return a stub
    raise HTTPException(status_code=404, detail="Session not found")
