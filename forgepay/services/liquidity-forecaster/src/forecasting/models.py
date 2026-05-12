"""
Time-series forecasting models for the Liquidity Forecaster.

Three model classes are provided:

  ARIMAForecaster
    ─ Wraps SARIMAX from statsmodels.
    ─ Auto-selects (p, d, q) by minimising AIC over a constrained grid:
        p ∈ {0,1,2,3}, d ∈ {0,1,2}, q ∈ {0,1,2,3}
    ─ Returns point forecast + 80 % prediction interval.

  ExponentialSmoothingForecaster
    ─ Wraps Holt-Winters ExponentialSmoothing (additive trend + additive
      weekly seasonality).
    ─ Estimates 80 % prediction intervals from in-sample residuals (Holt-
      Winters does not natively produce parametric CIs).

  EnsembleForecaster
    ─ Fits both models; weights each by its inverse-MAPE on the last 30-day
      validation split; returns the weighted average of their predictions.

All ``predict`` methods return three arrays of equal length:
  (forecast, lower_80, upper_80)
"""

from __future__ import annotations

import warnings
from concurrent.futures import ThreadPoolExecutor
from itertools import product
from typing import TYPE_CHECKING

import numpy as np
import pandas as pd
import structlog

if TYPE_CHECKING:
    pass

log = structlog.get_logger(__name__)

# Suppress noisy convergence warnings from statsmodels during grid search
warnings.filterwarnings("ignore", category=UserWarning)
warnings.filterwarnings("ignore", category=FutureWarning)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _mape(actual: np.ndarray, predicted: np.ndarray) -> float:
    """
    Mean Absolute Percentage Error.
    Returns 0.0 when all actuals are zero to avoid division-by-zero.
    Clips individual errors at 500 % to prevent outlier domination.
    """
    actual = np.asarray(actual, dtype=float)
    predicted = np.asarray(predicted, dtype=float)
    nonzero = actual != 0
    if not nonzero.any():
        return 0.0
    pct_errors = np.abs((actual[nonzero] - predicted[nonzero]) / actual[nonzero])
    pct_errors = np.clip(pct_errors, 0.0, 5.0)  # cap at 500 %
    return float(np.mean(pct_errors) * 100)


def _ensure_positive(arr: np.ndarray) -> np.ndarray:
    """Clip negative forecasted values to zero (cash flows can't be negative)."""
    return np.maximum(arr, 0.0)


def _fill_series(series: pd.Series) -> pd.Series:
    """
    Fill gaps in a daily time-series with zeros and handle NaN/inf values.
    Statsmodels requires a complete, finite series.
    """
    series = series.astype(float)
    series = series.replace([np.inf, -np.inf], np.nan)
    series = series.fillna(0.0)
    return series


# ── ARIMA Forecaster ──────────────────────────────────────────────────────────

class ARIMAForecaster:
    """
    Automatically selects ARIMA(p,d,q) order by minimising AIC on a grid.
    Uses SARIMAX under the hood for a unified API.
    """

    _P_RANGE = range(0, 4)   # 0–3 inclusive
    _D_RANGE = range(0, 3)   # 0–2
    _Q_RANGE = range(0, 4)   # 0–3

    def __init__(self) -> None:
        self._result = None          # fitted SARIMAXResults
        self._best_order: tuple[int, int, int] = (1, 1, 1)
        self._series: pd.Series | None = None
        self._fitted = False

    def fit(self, series: pd.Series) -> "ARIMAForecaster":
        """
        Grid-search ARIMA orders and fit the best model.
        ``series`` should be a pd.Series of daily float values with a
        DatetimeIndex (or a default integer index — both are accepted).
        """
        from statsmodels.tsa.statespace.sarimax import SARIMAX

        series = _fill_series(series)
        self._series = series

        # Guard: need at least a few observations to fit
        if len(series) < 10:
            log.warning("arima_too_few_observations", n=len(series))
            self._best_order = (0, 1, 0)
            model = SARIMAX(series, order=self._best_order, trend="n")
            self._result = model.fit(disp=False)
            self._fitted = True
            return self

        best_aic = np.inf
        best_order = (1, 1, 1)
        best_result = None

        for p, d, q in product(self._P_RANGE, self._D_RANGE, self._Q_RANGE):
            if p == 0 and d == 0 and q == 0:
                continue
            try:
                model = SARIMAX(series, order=(p, d, q), trend="n", enforce_stationarity=False)
                result = model.fit(disp=False, method="lbfgs", maxiter=200)
                aic = result.aic
                if np.isfinite(aic) and aic < best_aic:
                    best_aic = aic
                    best_order = (p, d, q)
                    best_result = result
            except Exception:
                # Many (p,d,q) combinations fail to converge — skip silently
                continue

        if best_result is None:
            # Fallback: simple ARIMA(1,1,0)
            best_order = (1, 1, 0)
            model = SARIMAX(series, order=best_order, trend="n", enforce_stationarity=False)
            best_result = model.fit(disp=False)

        self._best_order = best_order
        self._result = best_result
        self._fitted = True
        log.info("arima_best_order", order=best_order, aic=round(best_aic, 2))
        return self

    def predict(
        self, horizon_days: int
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """
        Produce ``horizon_days`` daily forecasts.

        Returns:
            forecast   — point forecast array  (shape: horizon_days,)
            lower_80   — lower bound of 80 % prediction interval
            upper_80   — upper bound of 80 % prediction interval
        """
        if not self._fitted or self._result is None:
            raise RuntimeError("Call fit() before predict()")

        forecast_obj = self._result.get_forecast(steps=horizon_days)
        summary = forecast_obj.summary_frame(alpha=0.20)  # 80 % CI → alpha=0.20

        forecast = _ensure_positive(summary["mean"].to_numpy())
        lower_80 = _ensure_positive(summary["mean_ci_lower"].to_numpy())
        upper_80 = _ensure_positive(summary["mean_ci_upper"].to_numpy())
        return forecast, lower_80, upper_80

    def mape(self, actual: np.ndarray, predicted: np.ndarray) -> float:
        return _mape(actual, predicted)

    @property
    def order(self) -> tuple[int, int, int]:
        return self._best_order


# ── Exponential Smoothing Forecaster ─────────────────────────────────────────

class ExponentialSmoothingForecaster:
    """
    Holt-Winters Exponential Smoothing with additive trend and additive weekly
    seasonality (period = 7).  Prediction intervals are estimated from the
    root-mean-square of in-sample one-step-ahead residuals.
    """

    _SEASONAL_PERIOD = 7  # weekly pattern

    def __init__(self) -> None:
        self._result = None
        self._rmse: float = 0.0
        self._fitted = False

    def fit(self, series: pd.Series) -> "ExponentialSmoothingForecaster":
        """
        Fit the Holt-Winters model.
        Falls back to simple additive trend (no seasonality) when the series
        is shorter than two full seasonal cycles.
        """
        from statsmodels.tsa.holtwinters import ExponentialSmoothing

        series = _fill_series(series)
        min_seasonal_len = 2 * self._SEASONAL_PERIOD

        if len(series) >= min_seasonal_len:
            model = ExponentialSmoothing(
                series,
                trend="add",
                seasonal="add",
                seasonal_periods=self._SEASONAL_PERIOD,
                initialization_method="estimated",
            )
        else:
            model = ExponentialSmoothing(
                series,
                trend="add",
                seasonal=None,
                initialization_method="estimated",
            )

        self._result = model.fit(optimized=True)
        residuals = series.values - self._result.fittedvalues.values
        self._rmse = float(np.sqrt(np.mean(residuals ** 2)))
        self._fitted = True
        return self

    def predict(
        self, horizon_days: int
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """
        Produce ``horizon_days`` daily forecasts.

        Confidence interval uses a normal approximation:
          CI_80 = forecast ± 1.282 * RMSE * sqrt(h)
        where h is the forecast step (1-indexed), mimicking the ARIMA-style
        interval widening with horizon.
        """
        if not self._fitted or self._result is None:
            raise RuntimeError("Call fit() before predict()")

        raw_forecast = self._result.forecast(horizon_days)
        forecast = _ensure_positive(raw_forecast.to_numpy())

        # Steps 1..horizon_days
        steps = np.arange(1, horizon_days + 1)
        margin = 1.282 * self._rmse * np.sqrt(steps)

        lower_80 = _ensure_positive(forecast - margin)
        upper_80 = forecast + margin
        return forecast, lower_80, upper_80

    def mape(self, actual: np.ndarray, predicted: np.ndarray) -> float:
        return _mape(actual, predicted)


# ── Ensemble Forecaster ───────────────────────────────────────────────────────

class EnsembleForecaster:
    """
    Runs ARIMAForecaster and ExponentialSmoothingForecaster in parallel
    (using a thread pool so statsmodels' GIL-releasing C code can overlap).
    Weights each model's prediction by its inverse-MAPE on the last 30 days
    of the training series (hold-out validation).

    If one model fails to fit, the other is used exclusively (weight = 1.0).
    """

    _VAL_DAYS = 30

    def __init__(self) -> None:
        self._arima = ARIMAForecaster()
        self._es = ExponentialSmoothingForecaster()
        self._arima_weight: float = 0.5
        self._es_weight: float = 0.5
        self._arima_mape: float = 0.0
        self._es_mape: float = 0.0
        self._fitted = False
        self._model_name: str = "ensemble"

    def fit(self, series: pd.Series) -> "EnsembleForecaster":
        """
        Fit both models and compute inverse-MAPE weights on the validation set.
        """
        series = _fill_series(series)
        val_days = min(self._VAL_DAYS, len(series) // 4)
        val_days = max(val_days, 1)

        train = series.iloc[:-val_days]
        val = series.iloc[-val_days:]

        arima_ok = True
        es_ok = True

        with ThreadPoolExecutor(max_workers=2) as pool:
            arima_future = pool.submit(self._fit_arima, train)
            es_future = pool.submit(self._fit_es, train)
            arima_exc = arima_future.exception()
            es_exc = es_future.exception()

        if arima_exc:
            log.warning("arima_fit_failed", error=str(arima_exc))
            arima_ok = False
        if es_exc:
            log.warning("es_fit_failed", error=str(es_exc))
            es_ok = False

        # Score on validation set
        val_arr = val.to_numpy()
        arima_mape = 0.0
        es_mape = 0.0

        if arima_ok:
            try:
                arima_pred, _, _ = self._arima.predict(val_days)
                arima_mape = _mape(val_arr, arima_pred[:len(val_arr)])
            except Exception as exc:
                log.warning("arima_predict_failed_in_ensemble", error=str(exc))
                arima_ok = False

        if es_ok:
            try:
                es_pred, _, _ = self._es.predict(val_days)
                es_mape = _mape(val_arr, es_pred[:len(val_arr)])
            except Exception as exc:
                log.warning("es_predict_failed_in_ensemble", error=str(exc))
                es_ok = False

        self._arima_mape = arima_mape
        self._es_mape = es_mape

        # Compute weights from inverse-MAPE
        self._arima_weight, self._es_weight, self._model_name = self._compute_weights(
            arima_mape, es_mape, arima_ok, es_ok
        )

        # Refit both on the full series
        with ThreadPoolExecutor(max_workers=2) as pool:
            if arima_ok:
                pool.submit(self._fit_arima, series)
            if es_ok:
                pool.submit(self._fit_es, series)

        self._arima_ok = arima_ok
        self._es_ok = es_ok
        self._fitted = True

        log.info(
            "ensemble_weights",
            arima_weight=round(self._arima_weight, 3),
            es_weight=round(self._es_weight, 3),
            arima_mape=round(arima_mape, 2),
            es_mape=round(es_mape, 2),
            model=self._model_name,
        )
        return self

    @staticmethod
    def _compute_weights(
        arima_mape: float,
        es_mape: float,
        arima_ok: bool,
        es_ok: bool,
    ) -> tuple[float, float, str]:
        if not arima_ok and not es_ok:
            return 0.5, 0.5, "ensemble"
        if not arima_ok:
            return 0.0, 1.0, "exponential_smoothing"
        if not es_ok:
            return 1.0, 0.0, "arima"

        # Inverse-MAPE weighting; guard against division by zero
        eps = 1e-6
        inv_arima = 1.0 / (arima_mape + eps)
        inv_es = 1.0 / (es_mape + eps)
        total = inv_arima + inv_es
        return inv_arima / total, inv_es / total, "ensemble"

    def _fit_arima(self, series: pd.Series) -> None:
        self._arima.fit(series)

    def _fit_es(self, series: pd.Series) -> None:
        self._es.fit(series)

    def predict(
        self, horizon_days: int
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """
        Return weighted-average forecast and 80 % confidence bands.
        """
        if not self._fitted:
            raise RuntimeError("Call fit() before predict()")

        arima_f = arima_lo = arima_hi = None
        es_f = es_lo = es_hi = None

        if self._arima_ok:
            try:
                arima_f, arima_lo, arima_hi = self._arima.predict(horizon_days)
            except Exception as exc:
                log.warning("arima_predict_failed", error=str(exc))

        if self._es_ok:
            try:
                es_f, es_lo, es_hi = self._es.predict(horizon_days)
            except Exception as exc:
                log.warning("es_predict_failed", error=str(exc))

        w_a = self._arima_weight
        w_e = self._es_weight

        # Blend whichever succeeded
        if arima_f is not None and es_f is not None:
            forecast = w_a * arima_f + w_e * es_f
            lower_80 = w_a * arima_lo + w_e * es_lo
            upper_80 = w_a * arima_hi + w_e * es_hi
        elif arima_f is not None:
            forecast, lower_80, upper_80 = arima_f, arima_lo, arima_hi  # type: ignore[assignment]
        elif es_f is not None:
            forecast, lower_80, upper_80 = es_f, es_lo, es_hi  # type: ignore[assignment]
        else:
            # Both failed — return zeros
            forecast = np.zeros(horizon_days)
            lower_80 = np.zeros(horizon_days)
            upper_80 = np.zeros(horizon_days)

        return (
            _ensure_positive(forecast),
            _ensure_positive(lower_80),
            _ensure_positive(upper_80),
        )

    def mape(self, actual: np.ndarray, predicted: np.ndarray) -> float:
        return _mape(actual, predicted)

    @property
    def model_name(self) -> str:
        return self._model_name

    @property
    def validation_mape(self) -> float:
        """Weighted MAPE on the validation set."""
        return self._arima_weight * self._arima_mape + self._es_weight * self._es_mape
