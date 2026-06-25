"""
Screening router — entity and crypto-address OFAC/sanctions screening.

Routes:
    POST /api/v1/screening/entity              → screen person/business by name
    POST /api/v1/screening/address             → screen crypto address
    POST /api/v1/screening/batch               → batch screen list of entities
    GET  /api/v1/screening/{entity_id}/history → screening history
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request, status

from src.auth import require_auth
from src.models import (
    BatchScreenRequest,
    ScreenAddressRequest,
    ScreenEntityRequest,
    ScreeningResult,
)
from src.rate_limiting import check_rate_limit

router = APIRouter(prefix="/api/v1/screening", tags=["Screening"])


def _engine(request: Request):
    return request.app.state.screening_engine


@router.post(
    "/entity",
    response_model=ScreeningResult,
    summary="Screen a person or business entity against all active sanctions lists",
)
async def screen_entity(
    body: ScreenEntityRequest,
    request: Request,
    caller: Annotated[dict, Depends(require_auth)],
) -> ScreeningResult:
    # Rate limit: 60 entity screenings per minute
    check_rate_limit(request, "60/minute")

    engine = _engine(request)
    return await engine.screen_entity(
        entity_id=body.entity_id,
        entity_type=body.entity_type,
        name=body.name,
        crypto_addresses=body.crypto_addresses or None,
        bank_accounts=body.bank_accounts or None,
    )


@router.post(
    "/address",
    response_model=ScreeningResult,
    summary="Screen a blockchain address against OFAC digital-currency-address entries",
)
async def screen_address(
    body: ScreenAddressRequest,
    request: Request,
    caller: Annotated[dict, Depends(require_auth)],
) -> ScreeningResult:
    # Rate limit: 120 address screenings per minute
    check_rate_limit(request, "120/minute")

    engine = _engine(request)
    return await engine.screen_crypto_address(address=body.address)


@router.post(
    "/batch",
    response_model=list[ScreeningResult],
    summary="Screen a batch of entities concurrently",
)
async def batch_screen(
    body: BatchScreenRequest,
    request: Request,
    caller: Annotated[dict, Depends(require_auth)],
) -> list[ScreeningResult]:
    # Rate limit: 10 batch screenings per minute (stricter due to bulk nature)
    check_rate_limit(request, "10/minute")

    if len(body.entities) > 200:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Batch size may not exceed 200 entities per request",
        )
    engine = _engine(request)
    entities = [e.model_dump() for e in body.entities]
    return await engine.batch_screen(entities)


@router.get(
    "/{entity_id}/history",
    response_model=list[ScreeningResult],
    summary="Retrieve the screening history for a given entity",
)
async def screening_history(
    entity_id: str,
    request: Request,
    caller: Annotated[dict, Depends(require_auth)],
) -> list[ScreeningResult]:
    # Rate limit: 120 history retrievals per minute (read-only, higher limit)
    check_rate_limit(request, "120/minute")

    engine = _engine(request)
    return engine.get_history(entity_id)
