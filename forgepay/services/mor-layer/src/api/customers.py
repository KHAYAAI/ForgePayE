"""Customer management API — thin wrapper over Hyperswitch customers."""

from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr

from src.bridges.hyperswitch import (
    CustomerCreateRequest,
    CustomerResponse,
    HyperswitchClient,
    get_hyperswitch_client,
)

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
) -> CustomerResponse:
    """
    Create a customer in Hyperswitch.
    Replaces stripe.Customer.create().
    """
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
) -> CustomerResponse:
    try:
        return await hs.retrieve_customer(customer_id)
    except Exception as exc:
        raise HTTPException(status_code=404, detail="Customer not found") from exc


@router.get("/{customer_id}/payment_methods")
async def list_payment_methods(
    customer_id: str,
    hs: Annotated[HyperswitchClient, Depends(get_hyperswitch_client)],
) -> dict:
    methods = await hs.list_payment_methods(customer_id)
    return {"data": methods, "count": len(methods)}
