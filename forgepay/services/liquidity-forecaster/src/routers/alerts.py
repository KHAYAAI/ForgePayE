"""
Alerts router — liquidity alert management.

Endpoints
─────────
GET  /api/v1/alerts/{merchant_id}
     Returns all active (unresolved) alerts for a merchant.

PUT  /api/v1/alerts/{merchant_id}/thresholds
     Update per-merchant alert thresholds.
     Body: AlertThresholds JSON.

POST /api/v1/alerts/{merchant_id}/{alert_id}/resolve
     Mark a specific alert as resolved.
"""

from __future__ import annotations

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status

from src.alerts.engine import get_alert_engine
from src.auth import get_current_merchant, verify_merchant_access
from src.forecasting.engine import get_engine
from src.models import AlertThresholds, ForecastHorizon, LiquidityAlert
from src.rate_limiting import check_rate_limit

log = structlog.get_logger(__name__)

router = APIRouter(prefix="/api/v1/alerts", tags=["alerts"])


@router.get("/{merchant_id}", response_model=list[LiquidityAlert])
async def get_alerts(
    request: Request,
    merchant_id: str,
    current_balance: float = Query(
        default=0.0,
        description=(
            "Current cash balance in USD used to evaluate balance-based alerts. "
            "Pass the latest balance from your bank / settlement feed."
        ),
    ),
    run_evaluation: bool = Query(
        default=True,
        description="Re-evaluate alert conditions before returning results.",
    ),
    authenticated_merchant: str = Depends(get_current_merchant),
) -> list[LiquidityAlert]:
    """
    Return all active liquidity alerts for the merchant.

    When ``run_evaluation=true`` (default), the alert engine re-evaluates all
    conditions against the latest 30-day forecast and the supplied
    ``current_balance``.  Set to ``false`` to return cached alert state only.
    """
    # Rate limit: 60 alert retrievals per minute (read-heavy)
    check_rate_limit(request, "60/minute")

    verify_merchant_access(authenticated_merchant, merchant_id)
    alert_engine = get_alert_engine()

    if not run_evaluation:
        return alert_engine.get_active_alerts(merchant_id)

    # Fetch the latest 30-day forecast to power forecast-based alerts
    forecast_engine = get_engine()
    try:
        forecast = await forecast_engine.generate_forecast(
            merchant_id, ForecastHorizon.THIRTY_DAY
        )
    except Exception as exc:
        log.warning(
            "alert_forecast_fetch_failed",
            merchant_id=merchant_id,
            error=str(exc),
        )
        # Fall back to returning existing alerts without evaluation
        return alert_engine.get_active_alerts(merchant_id)

    try:
        return await alert_engine.evaluate_alerts(merchant_id, forecast, current_balance)
    except Exception as exc:
        log.error("alert_evaluation_error", merchant_id=merchant_id, error=str(exc))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Alert evaluation failed: {exc}",
        )


@router.put("/{merchant_id}/thresholds", response_model=AlertThresholds)
async def update_thresholds(
    merchant_id: str,
    thresholds: AlertThresholds,
    authenticated_merchant: str = Depends(get_current_merchant),
) -> AlertThresholds:
    """
    Update per-merchant alert thresholds.

    Changes take effect on the next alert evaluation call.  Defaults
    (from env config) are used when no per-merchant overrides are set.
    """
    verify_merchant_access(authenticated_merchant, merchant_id)
    alert_engine = get_alert_engine()
    alert_engine.update_thresholds(merchant_id, thresholds)
    return thresholds


@router.post(
    "/{merchant_id}/{alert_id}/resolve",
    status_code=status.HTTP_200_OK,
)
async def resolve_alert(
    merchant_id: str,
    alert_id: str,
    authenticated_merchant: str = Depends(get_current_merchant),
) -> dict[str, str]:
    """
    Mark an alert as resolved.

    Resolved alerts are retained in history but excluded from active alert
    lists.  Resolving a condition that has not been fixed will cause the
    alert to re-trigger on the next evaluation.
    """
    verify_merchant_access(authenticated_merchant, merchant_id)
    alert_engine = get_alert_engine()
    found = alert_engine.resolve_alert(merchant_id, alert_id)
    if not found:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Alert '{alert_id}' not found for merchant '{merchant_id}'",
        )
    return {"status": "resolved", "alert_id": alert_id}
