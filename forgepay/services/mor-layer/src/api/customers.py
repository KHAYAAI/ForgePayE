"""Customer management API — thin wrapper over Hyperswitch customers."""

from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr

from src.auth.dependencies import get_current_merchant
from src.bridges.hyperswitch import (
    CustomerCreateRequest,
    CustomerResponse,
    HyperswitchClient,
    get_hyperswitch_client,
)
from src.db.models import Merchant

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/customers", tags=["customers"])


class CustomerCreate(BaseModel):
    merchant_id: str
    reference_id: str          # merchant's own customer ID
    email: EmailStr | None = None
    name: str | None  = None
    phone: str | None = None
    metadata: dict[str, str] = {}


@router.post("/", response_model=CustomerResponse, status_code=201)
async def create_customer(
    body: CustomerCreate,
    hs: Annotated[HyperswitchClient, Depends(get_hyperswitch_client)],
    current_merchant: Annotated[Merchant, Depends(get_current_merchant)],
) -> CustomerResponse:
    """
    Create a customer in Hyperswitch.
    Replaces stripe.Customer.create().
    """
    # The merchant a customer record is created for must be the authenticated
    # caller — never trust body.merchant_id on its own, or any bearer token
    # could create customer records tagged to an arbitrary merchant_id.
    if body.merchant_id != current_merchant.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="merchant_id does not match the authenticated merchant",
        )

    req = CustomerCreateRequest(
        merchant_reference_id=body.reference_id,
        email=body.email,
        name=body.name,
        phone=body.phone,
        metadata={**body.metadata, "forgepay_merchant_id": body.merchant_id},
    )
    try:
        return await hs.create_customer(req)
    except Exception as exc:
        logger.error("Customer creation failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=502, detail="Payment engine unavailable") from exc


@router.get("/{customer_id}", response_model=CustomerResponse)
async def retrieve_customer(
    customer_id: str,
    hs: Annotated[HyperswitchClient, Depends(get_hyperswitch_client)],
    current_merchant: Annotated[Merchant, Depends(get_current_merchant)],
) -> CustomerResponse:
    # NOTE: Hyperswitch customers aren't mirrored in a local table here, so we
    # cannot verify current_merchant actually owns customer_id — the auth
    # dependency at least ensures only an authenticated merchant can query
    # customer PII, closing off anonymous enumeration.
    try:
        return await hs.retrieve_customer(customer_id)
    except Exception as exc:
        raise HTTPException(status_code=404, detail="Customer not found") from exc


@router.get("/{customer_id}/payment_methods")
async def list_payment_methods(
    customer_id: str,
    hs: Annotated[HyperswitchClient, Depends(get_hyperswitch_client)],
    current_merchant: Annotated[Merchant, Depends(get_current_merchant)],
) -> dict:
    methods = await hs.list_payment_methods(customer_id)
    return {"data": methods, "count": len(methods)}
