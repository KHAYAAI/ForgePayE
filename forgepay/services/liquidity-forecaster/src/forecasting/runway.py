"""
Runway Calculator — answers "how long until we run out of money?"

Algorithm
─────────
1. Fetch last 90 days of outflow data from the ingestor.
2. Aggregate to monthly totals and compute the mean monthly outflow
   (``monthly_burn_rate``).
3. Divide the current balance by the daily burn rate to get ``runway_days``.
4. Project ``zero_date`` = today + runway_days.
5. Build three scenarios:
     conservative  — burn rate increased by 20 % (revenue decline)
     base          — burn rate unchanged
     optimistic    — burn rate decreased by 20 % (revenue growth)

Notes
─────
* "Burn rate" here represents net outflow (cash leaving the account), not
  gross expenses.  It is computed from the outflow column of the cashflow
  DataFrame rather than from P&L data.
* When fewer than 30 days of data are available, the available data is used
  with a warning logged.
* ``runway_days`` is capped at 9999 to avoid integer overflow in edge cases
  (e.g. zero burn).
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pandas as pd
import structlog

from src.data.ingestor import get_ingestor
from src.models import RunwayResult, RunwayScenario

log = structlog.get_logger(__name__)

_MAX_RUNWAY_DAYS = 9_999
_DAYS_PER_MONTH = 30.44  # average month length


def _scenario(
    label: str,
    current_balance: float,
    burn_factor: float,
    base_monthly_burn: float,
) -> RunwayScenario:
    """
    Build a RunwayScenario given a burn-rate multiplier.

    Parameters
    ----------
    label:
        Human-readable scenario name.
    current_balance:
        Starting cash balance in USD.
    burn_factor:
        Multiplier applied to ``base_monthly_burn``.
        1.2 → conservative (20 % higher burn), 0.8 → optimistic.
    base_monthly_burn:
        Baseline monthly outflow in USD.
    """
    adjusted_burn = base_monthly_burn * burn_factor
    daily_burn = adjusted_burn / _DAYS_PER_MONTH

    if daily_burn <= 0:
        runway_days = _MAX_RUNWAY_DAYS
    else:
        runway_days = min(int(current_balance / daily_burn), _MAX_RUNWAY_DAYS)

    zero_date = (date.today() + timedelta(days=runway_days)).isoformat()

    return RunwayScenario(
        label=label,
        monthly_burn_rate=round(adjusted_burn, 2),
        runway_days=runway_days,
        zero_date=zero_date,
    )


async def calculate_runway(
    merchant_id: str,
    current_balance: float,
    lookback_days: int = 90,
) -> RunwayResult:
    """
    Compute the runway for a merchant given their current cash balance.

    Parameters
    ----------
    merchant_id:
        The merchant whose historical outflow is used.
    current_balance:
        Current cash balance in USD (supplied by the caller from their
        bank/settlement feed; not stored internally).
    lookback_days:
        Number of historical days to include when computing the burn rate.
        Defaults to 90 (three months).
    """
    ingestor = get_ingestor()
    df = await ingestor.get_historical_cashflow(merchant_id, days_back=lookback_days)

    if df.empty or len(df) < 7:
        log.warning(
            "runway_insufficient_data",
            merchant_id=merchant_id,
            rows=len(df),
        )
        # Return a safe zero-burn result rather than crashing
        return _zero_runway(merchant_id, current_balance)

    # Aggregate outflow by calendar month
    df_copy = df.copy()
    df_copy["month"] = df_copy["date"].dt.to_period("M")
    monthly = df_copy.groupby("month")["outflow"].sum()

    monthly_burn_rate = float(monthly.mean())
    log.info(
        "runway_burn_rate",
        merchant_id=merchant_id,
        monthly_burn_usd=round(monthly_burn_rate, 2),
        months_of_data=len(monthly),
    )

    daily_burn = monthly_burn_rate / _DAYS_PER_MONTH
    if daily_burn <= 0:
        runway_days = _MAX_RUNWAY_DAYS
    else:
        runway_days = min(int(current_balance / daily_burn), _MAX_RUNWAY_DAYS)

    runway_months = round(runway_days / _DAYS_PER_MONTH, 2)
    zero_date = (date.today() + timedelta(days=runway_days)).isoformat()

    return RunwayResult(
        merchant_id=merchant_id,
        current_balance_usd=round(current_balance, 2),
        monthly_burn_rate=round(monthly_burn_rate, 2),
        runway_days=runway_days,
        runway_months=runway_months,
        zero_date=zero_date,
        scenario_conservative=_scenario(
            "conservative", current_balance, 1.20, monthly_burn_rate
        ),
        scenario_base=_scenario(
            "base", current_balance, 1.00, monthly_burn_rate
        ),
        scenario_optimistic=_scenario(
            "optimistic", current_balance, 0.80, monthly_burn_rate
        ),
    )


def _zero_runway(merchant_id: str, current_balance: float) -> RunwayResult:
    """Fallback RunwayResult when there is insufficient historical data."""
    empty_scenario = RunwayScenario(
        label="insufficient_data",
        monthly_burn_rate=0.0,
        runway_days=_MAX_RUNWAY_DAYS,
        zero_date=(date.today() + timedelta(days=_MAX_RUNWAY_DAYS)).isoformat(),
    )
    return RunwayResult(
        merchant_id=merchant_id,
        current_balance_usd=round(current_balance, 2),
        monthly_burn_rate=0.0,
        runway_days=_MAX_RUNWAY_DAYS,
        runway_months=round(_MAX_RUNWAY_DAYS / _DAYS_PER_MONTH, 2),
        zero_date=(date.today() + timedelta(days=_MAX_RUNWAY_DAYS)).isoformat(),
        scenario_conservative=empty_scenario,
        scenario_base=empty_scenario,
        scenario_optimistic=empty_scenario,
    )
