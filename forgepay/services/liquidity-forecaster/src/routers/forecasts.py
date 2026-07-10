"""
Forecast router — generate and serve liquidity forecasts.

Endpoints
─────────
GET  /api/v1/forecasts/{merchant_id}
     Query params: horizon (7d|30d|90d, default 30d), currency (default USD)
     Returns: ForecastResult JSON

GET  /api/v1/forecasts/{merchant_id}/history
     Returns: list of previously generated forecast summaries for accuracy
     tracking (keyed by date × horizon).

POST /api/v1/forecasts/{merchant_id}/refresh
     Force-regenerates the forecast for all three horizons, bypassing cache.
     Returns: {7d, 30d, 90d} forecast results.

GET  /api/v1/forecasts/{merchant_id}/chart
     Query params: horizon (7d|30d|90d, default 30d), currency (default USD)
     Returns chart-ready payload: dates[], inflow[], outflow[], balance[],
     ci_80_lower[], ci_80_upper[].
"""

from __future__ import annotations

from typing import Any

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status

from src.auth import get_current_merchant, verify_merchant_access
from src.forecasting.engine import get_engine
from src.models import ForecastHorizon, ForecastResult
from src.rate_limiting import check_rate_limit

log = structlog.get_logger(__name__)

router = APIRouter(prefix="/api/v1/forecasts", tags=["forecasts"])


def _parse_horizon(horizon: str) -> ForecastHorizon:
    try:
        return ForecastHorizon(horizon)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid horizon '{horizon}'. Must be one of: 7d, 30d, 90d",
        )


@router.get("/{merchant_id}", response_model=ForecastResult)
async def get_forecast(
    request: Request,
    merchant_id: str,
    horizon: str = Query(default="30d", description="Forecast horizon: 7d | 30d | 90d"),
    currency: str = Query(default="USD", max_length=3),
    authenticated_merchant: str = Depends(get_current_merchant),
) -> ForecastResult:
    """
    Return a liquidity forecast for the given merchant and horizon.

    Uses the in-process cache (TTL configured by FORECAST_CACHE_TTL_HOURS).
    To bypass the cache use POST /refresh.
    """
    # Rate limit: 60 forecast retrievals per minute (read-heavy)
    check_rate_limit(request, "60/minute")

    verify_merchant_access(authenticated_merchant, merchant_id)
    h = _parse_horizon(horizon)
    engine = get_engine()
    try:
        return await engine.generate_forecast(merchant_id, h, currency=currency)
    except Exception as exc:
        log.error("forecast_error", merchant_id=merchant_id, error=str(exc))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Forecast generation failed: {exc}",
        )


@router.get("/{merchant_id}/history")
async def get_forecast_history(
    request: Request,
    merchant_id: str,
    authenticated_merchant: str = Depends(get_current_merchant),
) -> list[dict[str, Any]]:
    """
    Return a list of previously generated forecasts for accuracy tracking.
    Each entry includes the MAPE on the validation set at generation time.
    """
    # Rate limit: 60 history retrievals per minute (read-only)
    check_rate_limit(request, "60/minute")

    verify_merchant_access(authenticated_merchant, merchant_id)
    engine = get_engine()
    return await engine.get_forecast_history(merchant_id)


@router.post("/{merchant_id}/refresh")
async def refresh_forecasts(
    request: Request,
    merchant_id: str,
    currency: str = Query(default="USD", max_length=3),
    authenticated_merchant: str = Depends(get_current_merchant),
) -> dict[str, ForecastResult]:
    """
    Force-refresh forecasts for all three horizons, bypassing the cache.
    Triggers a new data fetch from the payment engine for each horizon.
    """
    # Rate limit: 5 forecast refreshes per minute (write operation, stricter)
    check_rate_limit(request, "5/minute")

    verify_merchant_access(authenticated_merchant, merchant_id)
    engine = get_engine()
    results: dict[str, ForecastResult] = {}
    errors: dict[str, str] = {}

    for horizon in ForecastHorizon:
        try:
            result = await engine.generate_forecast(
                merchant_id, horizon, currency=currency, force_refresh=True
            )
            results[horizon.value] = result
        except Exception as exc:
            log.error(
                "refresh_error",
                merchant_id=merchant_id,
                horizon=horizon.value,
                error=str(exc),
            )
            errors[horizon.value] = str(exc)

    if errors and not results:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"message": "All horizon forecasts failed", "errors": errors},
        )

    return results


@router.get("/{merchant_id}/chart")
async def get_chart_data(
    merchant_id: str,
    horizon: str = Query(default="30d", description="Forecast horizon: 7d | 30d | 90d"),
    currency: str = Query(default="USD", max_length=3),
    authenticated_merchant: str = Depends(get_current_merchant),
) -> dict[str, Any]:
    """
    Return chart-ready arrays for the forecast dashboard.

    Response shape:
    {
      "dates": ["2026-05-13", ...],
      "inflow": [1234.56, ...],
      "outflow": [567.89, ...],
      "net": [666.67, ...],
      "balance": [12345.67, ...],
      "ci_80_lower": [...],
      "ci_80_upper": [...],
      "ci_95_lower": [...],
      "ci_95_upper": [...],
      "meta": { "horizon": "30d", "model_used": "...", "mape": 3.2 }
    }
    """
    verify_merchant_access(authenticated_merchant, merchant_id)
    h = _parse_horizon(horizon)
    engine = get_engine()

    try:
        forecast = await engine.generate_forecast(merchant_id, h, currency=currency)
    except Exception as exc:
        log.error("chart_forecast_error", merchant_id=merchant_id, error=str(exc))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Forecast generation failed: {exc}",
        )

    pts = forecast.forecast_points
    ci80 = forecast.confidence_interval_80
    ci95 = forecast.confidence_interval_95

    return {
        "dates":       [p.date for p in pts],
        "inflow":      [p.predicted_inflow for p in pts],
        "outflow":     [p.predicted_outflow for p in pts],
        "net":         [p.predicted_net for p in pts],
        "balance":     [p.predicted_balance for p in pts],
        "ci_80_lower": [b.lower for b in ci80],
        "ci_80_upper": [b.upper for b in ci80],
        "ci_95_lower": [b.lower for b in ci95],
        "ci_95_upper": [b.upper for b in ci95],
        "meta": {
            "merchant_id":              forecast.merchant_id,
            "horizon":                  forecast.horizon.value,
            "currency":                 forecast.currency,
            "generated_at":             forecast.generated_at,
            "model_used":               forecast.model_used,
            "mape":                     forecast.mape,
            "total_projected_inflow":   forecast.total_projected_inflow,
            "total_projected_outflow":  forecast.total_projected_outflow,
            "projected_ending_balance": forecast.projected_ending_balance,
        },
    }
