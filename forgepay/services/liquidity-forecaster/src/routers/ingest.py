"""
Ingest router — manually trigger or query data refresh status.

Endpoints
─────────
POST /api/v1/ingest/{merchant_id}
     Trigger an immediate data refresh from the payment engine.
     Returns the updated IngestStatus.

GET  /api/v1/ingest/{merchant_id}/status
     Return the last ingest timestamp and row count without triggering a
     new fetch.
"""

from __future__ import annotations

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, status

from src.auth import get_current_merchant, verify_merchant_access
from src.data.ingestor import get_ingestor
from src.models import IngestStatus

log = structlog.get_logger(__name__)

router = APIRouter(prefix="/api/v1/ingest", tags=["ingest"])


@router.post("/{merchant_id}", response_model=IngestStatus, status_code=status.HTTP_200_OK)
async def trigger_ingest(
    merchant_id: str,
    days_back: int = Query(
        default=365,
        description="Number of historical days to fetch",
        ge=7,
        le=730,
    ),
    authenticated_merchant: str = Depends(get_current_merchant),
) -> IngestStatus:
    """
    Manually trigger a data refresh for the merchant.

    Fetches up to ``days_back`` days of payment history from the payment
    engine, normalises it into a daily cash-flow DataFrame, and updates the
    in-process cache used by the forecasting engine.

    This call is blocking — it completes the fetch before returning.
    For large datasets (days_back > 180) this may take several seconds.
    """
    verify_merchant_access(authenticated_merchant, merchant_id)
    ingestor = get_ingestor()
    try:
        status_obj = await ingestor.refresh_merchant(merchant_id, days_back=days_back)
        log.info(
            "manual_ingest_complete",
            merchant_id=merchant_id,
            rows=status_obj.row_count,
            days_back=days_back,
        )
        return status_obj
    except Exception as exc:
        log.error("ingest_error", merchant_id=merchant_id, error=str(exc))
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Data ingestion failed: {exc}",
        )


@router.get("/{merchant_id}/status", response_model=IngestStatus)
async def get_ingest_status(
    merchant_id: str,
    authenticated_merchant: str = Depends(get_current_merchant),
) -> IngestStatus:
    """
    Return the last ingest metadata for the merchant without triggering a
    new fetch.

    ``last_ingested_at`` is null if the merchant has never been ingested in
    the current process run (i.e. no background poll has fired yet and no
    manual trigger has been called).
    """
    verify_merchant_access(authenticated_merchant, merchant_id)
    ingestor = get_ingestor()
    return ingestor.get_ingest_status(merchant_id)
