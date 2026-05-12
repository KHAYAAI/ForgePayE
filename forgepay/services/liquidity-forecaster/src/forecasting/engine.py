"""
Forecast Engine — orchestrates data fetch, model fitting, and result assembly.

The engine:
  1. Retrieves historical cash-flow via PaymentDataIngestor.
  2. Splits into train / validate sets (hold-out = last 30 days).
  3. Fits EnsembleForecaster independently on inflow and outflow series.
  4. Scores each on the validation set to compute blended MAPE.
  5. Refits on the full dataset and predicts ``horizon`` days forward.
  6. Combines inflow/outflow predictions into daily balance projections.
  7. Assembles and returns a ForecastResult, caching it in-memory.

Cache
─────
Results are keyed by ``{merchant_id}:{horizon}:{today_iso}`` and expire after
``FORECAST_CACHE_TTL_HOURS`` hours.  On a cache hit the previously computed
ForecastResult is returned immediately without re-fitting.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, date, datetime, timedelta
from typing import Any

import numpy as np
import pandas as pd
import structlog

from src.config import get_settings
from src.data.ingestor import get_ingestor
from src.forecasting.models import EnsembleForecaster, _mape
from src.models import (
    ConfidenceBand,
    ForecastDataPoint,
    ForecastHorizon,
    ForecastResult,
)

log = structlog.get_logger(__name__)

# ── In-memory cache ────────────────────────────────────────────────────────────
# { cache_key: (ForecastResult, expires_at_datetime) }
_cache: dict[str, tuple[ForecastResult, datetime]] = {}

_VALIDATION_DAYS = 30


def _cache_key(merchant_id: str, horizon: ForecastHorizon) -> str:
    today = date.today().isoformat()
    return f"{merchant_id}:{horizon.value}:{today}"


def _get_cached(merchant_id: str, horizon: ForecastHorizon) -> ForecastResult | None:
    key = _cache_key(merchant_id, horizon)
    entry = _cache.get(key)
    if entry is None:
        return None
    result, expires_at = entry
    if datetime.now(UTC) > expires_at:
        del _cache[key]
        return None
    return result


def _set_cache(merchant_id: str, horizon: ForecastHorizon, result: ForecastResult) -> None:
    cfg = get_settings()
    key = _cache_key(merchant_id, horizon)
    expires_at = datetime.now(UTC) + timedelta(hours=cfg.forecast_cache_ttl_hours)
    _cache[key] = (result, expires_at)


def _future_dates(horizon_days: int) -> list[str]:
    """Return ISO date strings for the next ``horizon_days`` calendar days."""
    today = date.today()
    return [(today + timedelta(days=i + 1)).isoformat() for i in range(horizon_days)]


def _build_forecast_points(
    dates: list[str],
    inflow: np.ndarray,
    outflow: np.ndarray,
    starting_balance: float,
) -> list[ForecastDataPoint]:
    """Zip date/inflow/outflow arrays into ForecastDataPoint objects."""
    points: list[ForecastDataPoint] = []
    running_balance = starting_balance
    for i, iso_date in enumerate(dates):
        day_inflow = float(inflow[i])
        day_outflow = float(outflow[i])
        day_net = day_inflow - day_outflow
        running_balance += day_net
        points.append(
            ForecastDataPoint(
                date=iso_date,
                predicted_inflow=round(day_inflow, 2),
                predicted_outflow=round(day_outflow, 2),
                predicted_net=round(day_net, 2),
                predicted_balance=round(running_balance, 2),
            )
        )
    return points


def _build_confidence_bands(
    dates: list[str],
    inflow_lo: np.ndarray,
    inflow_hi: np.ndarray,
    outflow_lo: np.ndarray,
    outflow_hi: np.ndarray,
) -> tuple[list[ConfidenceBand], list[ConfidenceBand]]:
    """
    Build 80 % and 95 % confidence bands for net cash flow.

    The net CI is computed by combining inflow and outflow bounds:
      net_lower = inflow_lower − outflow_upper  (worst case)
      net_upper = inflow_upper − outflow_lower  (best case)

    For the 95 % band we extrapolate from the 80 % width by scaling by
    the ratio of the standard-normal quantiles: z_95/z_80 ≈ 1.960/1.282.
    """
    ci_80: list[ConfidenceBand] = []
    ci_95: list[ConfidenceBand] = []
    scale_95 = 1.960 / 1.282

    for i, iso_date in enumerate(dates):
        net_lo_80 = float(inflow_lo[i]) - float(outflow_hi[i])
        net_hi_80 = float(inflow_hi[i]) - float(outflow_lo[i])
        half_width_80 = (net_hi_80 - net_lo_80) / 2.0
        midpoint = (net_hi_80 + net_lo_80) / 2.0

        half_width_95 = half_width_80 * scale_95
        ci_80.append(ConfidenceBand(
            date=iso_date,
            lower=round(net_lo_80, 2),
            upper=round(net_hi_80, 2),
        ))
        ci_95.append(ConfidenceBand(
            date=iso_date,
            lower=round(midpoint - half_width_95, 2),
            upper=round(midpoint + half_width_95, 2),
        ))
    return ci_80, ci_95


def _fit_and_score(
    train: pd.Series,
    val: pd.Series,
    horizon: int,
) -> tuple[EnsembleForecaster, float, np.ndarray, np.ndarray, np.ndarray]:
    """
    Fit an EnsembleForecaster on ``train``, score on ``val``, refit on the
    concatenated series, then predict ``horizon`` steps.

    Returns (forecaster, mape, forecast, lower_80, upper_80).
    This is a synchronous, CPU-bound function meant to run in an executor.
    """
    forecaster = EnsembleForecaster()

    # Phase 1 — fit on train only to get MAPE on validation
    forecaster.fit(train)
    val_pred, _, _ = forecaster.predict(len(val))
    val_mape = _mape(val.to_numpy(), val_pred[: len(val)])

    # Phase 2 — refit on full series
    full_series = pd.concat([train, val], ignore_index=True)
    forecaster.fit(full_series)
    forecast, lower_80, upper_80 = forecaster.predict(horizon)

    return forecaster, val_mape, forecast, lower_80, upper_80


class ForecastEngine:
    """
    Main entry point for generating liquidity forecasts.

    Usage:
        engine = ForecastEngine()
        result = await engine.generate_forecast("merchant_123", ForecastHorizon.THIRTY_DAY)
    """

    def __init__(self) -> None:
        self._ingestor = get_ingestor()
        self._executor = None  # use the default ThreadPoolExecutor

    async def generate_forecast(
        self,
        merchant_id: str,
        horizon: ForecastHorizon,
        currency: str = "USD",
        force_refresh: bool = False,
    ) -> ForecastResult:
        """
        Generate (or return cached) a ForecastResult for the given merchant
        and horizon.  Pass ``force_refresh=True`` to bypass the cache.
        """
        if not force_refresh:
            cached = _get_cached(merchant_id, horizon)
            if cached is not None:
                log.info("forecast_cache_hit", merchant_id=merchant_id, horizon=horizon.value)
                return cached

        log.info(
            "forecast_generating",
            merchant_id=merchant_id,
            horizon=horizon.value,
            force_refresh=force_refresh,
        )

        # Fetch enough history: at least horizon + 90 days for training
        days_back = max(365, horizon.to_days() + 90)
        df = await self._ingestor.get_historical_cashflow(merchant_id, days_back=days_back)

        result = await asyncio.get_event_loop().run_in_executor(
            None,
            self._compute_forecast,
            merchant_id,
            horizon,
            currency,
            df,
        )

        _set_cache(merchant_id, horizon, result)
        log.info(
            "forecast_complete",
            merchant_id=merchant_id,
            horizon=horizon.value,
            mape=round(result.mape, 2),
            model=result.model_used,
        )
        return result

    @staticmethod
    def _compute_forecast(
        merchant_id: str,
        horizon: ForecastHorizon,
        currency: str,
        df: pd.DataFrame,
    ) -> ForecastResult:
        """
        CPU-bound forecast computation — runs in the thread pool executor.
        """
        horizon_days = horizon.to_days()

        # Handle sparse / missing data
        if df.empty or len(df) < 14:
            return _zero_forecast(merchant_id, horizon, currency, horizon_days)

        # Ensure daily frequency — reindex to fill any missing calendar days
        df = df.copy()
        df["date"] = pd.to_datetime(df["date"], utc=True)
        df = df.set_index("date").sort_index()

        date_range = pd.date_range(df.index.min(), df.index.max(), freq="D", tz="UTC")
        df = df.reindex(date_range).fillna(0.0)

        inflow_series = df["inflow"]
        outflow_series = df["outflow"]

        # Train / validate split
        val_days = min(_VALIDATION_DAYS, len(df) // 4)
        val_days = max(val_days, 1)

        in_train = inflow_series.iloc[:-val_days]
        in_val = inflow_series.iloc[-val_days:]
        out_train = outflow_series.iloc[:-val_days]
        out_val = outflow_series.iloc[-val_days:]

        # Fit + predict inflow and outflow models
        in_fc, in_mape, in_f, in_lo, in_hi = _fit_and_score(in_train, in_val, horizon_days)
        out_fc, out_mape, out_f, out_lo, out_hi = _fit_and_score(out_train, out_val, horizon_days)

        # Blended MAPE
        blended_mape = (in_mape + out_mape) / 2.0

        # Current balance = last balance value in history
        starting_balance = float(df["balance"].iloc[-1]) if "balance" in df.columns else 0.0

        dates = _future_dates(horizon_days)
        forecast_points = _build_forecast_points(dates, in_f, out_f, starting_balance)
        ci_80, ci_95 = _build_confidence_bands(dates, in_lo, in_hi, out_lo, out_hi)

        total_inflow = float(np.sum(in_f))
        total_outflow = float(np.sum(out_f))
        ending_balance = forecast_points[-1].predicted_balance if forecast_points else starting_balance

        return ForecastResult(
            merchant_id=merchant_id,
            horizon=horizon,
            generated_at=datetime.now(UTC).isoformat(),
            currency=currency,
            forecast_points=forecast_points,
            confidence_interval_80=ci_80,
            confidence_interval_95=ci_95,
            total_projected_inflow=round(total_inflow, 2),
            total_projected_outflow=round(total_outflow, 2),
            projected_ending_balance=round(ending_balance, 2),
            model_used=in_fc.model_name,
            mape=round(blended_mape, 4),
        )

    async def get_forecast_history(self, merchant_id: str) -> list[dict[str, Any]]:
        """
        Return a list of previously generated forecast summaries for
        accuracy tracking.  Currently returns in-process cached results
        (production: persist to PostgreSQL).
        """
        history: list[dict[str, Any]] = []
        for key, (result, expires_at) in list(_cache.items()):
            if key.startswith(f"{merchant_id}:"):
                history.append({
                    "merchant_id": result.merchant_id,
                    "horizon": result.horizon.value,
                    "generated_at": result.generated_at,
                    "mape": result.mape,
                    "model_used": result.model_used,
                    "total_projected_inflow": result.total_projected_inflow,
                    "total_projected_outflow": result.total_projected_outflow,
                    "projected_ending_balance": result.projected_ending_balance,
                    "cache_expires_at": expires_at.isoformat(),
                })
        return sorted(history, key=lambda x: x["generated_at"], reverse=True)


def _zero_forecast(
    merchant_id: str,
    horizon: ForecastHorizon,
    currency: str,
    horizon_days: int,
) -> ForecastResult:
    """Return a zero-value ForecastResult when there is insufficient data."""
    dates = _future_dates(horizon_days)
    empty_points = [
        ForecastDataPoint(date=d, predicted_inflow=0, predicted_outflow=0,
                          predicted_net=0, predicted_balance=0)
        for d in dates
    ]
    empty_bands = [ConfidenceBand(date=d, lower=0, upper=0) for d in dates]
    return ForecastResult(
        merchant_id=merchant_id,
        horizon=horizon,
        generated_at=datetime.now(UTC).isoformat(),
        currency=currency,
        forecast_points=empty_points,
        confidence_interval_80=empty_bands,
        confidence_interval_95=empty_bands,
        total_projected_inflow=0.0,
        total_projected_outflow=0.0,
        projected_ending_balance=0.0,
        model_used="insufficient_data",
        mape=0.0,
    )


# Module-level singleton
_engine: ForecastEngine | None = None


def get_engine() -> ForecastEngine:
    global _engine
    if _engine is None:
        _engine = ForecastEngine()
    return _engine
