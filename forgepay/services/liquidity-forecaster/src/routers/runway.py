"""
Runway router — cash runway calculation and scenario comparison.

Endpoints
─────────
GET /api/v1/runway/{merchant_id}
    Query params: current_balance (required, float)
    Returns: RunwayResult with three built-in scenarios.

GET /api/v1/runway/{merchant_id}/scenarios
    Returns the three scenarios as a table-friendly list, including
    comparative columns (delta_days vs base, days_to_safe).
"""

from __future__ import annotations

from typing import Any

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status

from src.auth import get_current_merchant, verify_merchant_access
from src.forecasting.runway import calculate_runway
from src.models import RunwayResult
from src.rate_limiting import check_rate_limit

log = structlog.get_logger(__name__)

router = APIRouter(prefix="/api/v1/runway", tags=["runway"])


@router.get("/{merchant_id}", response_model=RunwayResult)
async def get_runway(
    request: Request,
    merchant_id: str,
    current_balance: float = Query(
        ...,
        description="Current cash balance in USD",
        gt=-1_000_000_000,
    ),
    lookback_days: int = Query(
        default=90,
        description="Days of historical outflow to use for burn-rate calculation",
        ge=7,
        le=365,
    ),
    authenticated_merchant: str = Depends(get_current_merchant),
) -> RunwayResult:
    """
    Calculate how many days the merchant can operate at their current burn rate.

    The burn rate is derived from the last ``lookback_days`` of outflow data
    from the payment engine.  Three scenarios are always returned:
      - conservative: +20 % burn (e.g. revenue drops 20 %)
      - base:         current burn rate unchanged
      - optimistic:   -20 % burn (e.g. revenue grows 20 %)
    """
    # Rate limit: 60 runway calculations per minute
    check_rate_limit(request, "60/minute")

    verify_merchant_access(authenticated_merchant, merchant_id)
    try:
        return await calculate_runway(
            merchant_id=merchant_id,
            current_balance=current_balance,
            lookback_days=lookback_days,
        )
    except Exception as exc:
        log.error("runway_error", merchant_id=merchant_id, error=str(exc))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Runway calculation failed: {exc}",
        )


@router.get("/{merchant_id}/scenarios")
async def get_scenarios(
    request: Request,
    merchant_id: str,
    current_balance: float = Query(
        ...,
        description="Current cash balance in USD",
        gt=-1_000_000_000,
    ),
    lookback_days: int = Query(default=90, ge=7, le=365),
    authenticated_merchant: str = Depends(get_current_merchant),
) -> dict[str, Any]:
    """
    Return the three runway scenarios in a table-friendly format with
    delta_days (compared to base) and a safe/warning/critical status flag.

    Response shape:
    {
      "merchant_id": "...",
      "current_balance_usd": 50000.0,
      "monthly_burn_rate": 15000.0,
      "base_runway_days": 100,
      "scenarios": [
        {
          "label": "conservative",
          "monthly_burn_rate": 18000.0,
          "runway_days": 83,
          "zero_date": "2026-08-03",
          "delta_days_vs_base": -17,
          "status": "warning"
        },
        ...
      ]
    }
    """
    # Rate limit: 60 scenario retrievals per minute (read-only)
    check_rate_limit(request, "60/minute")

    verify_merchant_access(authenticated_merchant, merchant_id)
    try:
        result = await calculate_runway(
            merchant_id=merchant_id,
            current_balance=current_balance,
            lookback_days=lookback_days,
        )
    except Exception as exc:
        log.error("scenarios_error", merchant_id=merchant_id, error=str(exc))
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Scenario calculation failed: {exc}",
        )

    base_days = result.scenario_base.runway_days

    def _status(days: int) -> str:
        if days < 30:
            return "critical"
        if days < 90:
            return "warning"
        return "safe"

    scenarios = []
    for scenario in (
        result.scenario_conservative,
        result.scenario_base,
        result.scenario_optimistic,
    ):
        scenarios.append({
            "label":               scenario.label,
            "monthly_burn_rate":   scenario.monthly_burn_rate,
            "runway_days":         scenario.runway_days,
            "zero_date":           scenario.zero_date,
            "delta_days_vs_base":  scenario.runway_days - base_days,
            "status":              _status(scenario.runway_days),
        })

    return {
        "merchant_id":       result.merchant_id,
        "current_balance_usd": result.current_balance_usd,
        "monthly_burn_rate": result.monthly_burn_rate,
        "base_runway_days":  base_days,
        "runway_months":     result.runway_months,
        "zero_date":         result.zero_date,
        "scenarios":         scenarios,
    }
