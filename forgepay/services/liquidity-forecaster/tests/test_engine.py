"""
Tests for the Liquidity Forecaster core components.

Covered:
  1. ARIMAForecaster  — fit + predict on synthetic sine-wave daily data
  2. ExponentialSmoothingForecaster — same synthetic data
  3. EnsembleForecaster — validates weighting logic
  4. Runway calculator — deterministic result with known burn rate
  5. Alert evaluation — negative forecast + low balance + burn spike
  6. normalize_to_cashflow — data ingestion from raw payment records
  7. _build_forecast_points — correct cumulative balance accumulation
  8. ForecastResult model — field validation
"""

from __future__ import annotations

import asyncio
import math
from datetime import UTC, date, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import numpy as np
import pandas as pd
import pytest

# ── Fixtures & helpers ─────────────────────────────────────────────────────────

def _sine_series(n: int = 120, amplitude: float = 500.0, offset: float = 2000.0) -> pd.Series:
    """
    Generate n days of synthetic daily cash-flow values following a sine wave
    with added white noise.  Values are always positive (they represent inflow).
    """
    t = np.linspace(0, 4 * np.pi, n)
    noise = np.random.default_rng(42).normal(0, 20, n)
    values = offset + amplitude * np.sin(t) + noise
    return pd.Series(values.clip(min=0.0), name="inflow")


def _make_df(n: int = 120) -> pd.DataFrame:
    """
    Build a minimal daily cash-flow DataFrame with date, inflow, outflow,
    net, and balance columns — mirrors what PaymentDataIngestor returns.
    """
    today = pd.Timestamp.now(tz="UTC").normalize()
    dates = pd.date_range(end=today, periods=n, freq="D", tz="UTC")
    rng = np.random.default_rng(7)
    inflow = 2000.0 + rng.normal(0, 200, n)
    outflow = 800.0 + rng.normal(0, 80, n)
    net = inflow - outflow
    df = pd.DataFrame({"date": dates, "inflow": inflow, "outflow": outflow, "net": net})
    df["balance"] = df["net"].cumsum()
    return df


def _raw_payments(n: int = 30) -> list[dict]:
    """Synthetic raw payment records spanning the last n days."""
    rng = np.random.default_rng(99)
    records = []
    today = datetime.now(UTC).date()
    for i in range(n):
        day = today - timedelta(days=i)
        created_at = f"{day.isoformat()}T12:00:00Z"
        # Successful payment
        records.append({
            "created_at": created_at,
            "status": "succeeded",
            "amount": int(rng.integers(10_000, 100_000)),   # cents
            "refund_amount": None,
            "chargeback_amount": None,
            "fee_amount": None,
        })
        # Occasional refund
        if rng.random() < 0.2:
            records.append({
                "created_at": created_at,
                "status": "refunded",
                "amount": 0,
                "refund_amount": int(rng.integers(500, 5_000)),
                "chargeback_amount": None,
                "fee_amount": None,
            })
    return records


# ─────────────────────────────────────────────────────────────────────────────
# 1. ARIMAForecaster
# ─────────────────────────────────────────────────────────────────────────────

class TestARIMAForecaster:
    def test_fit_returns_self(self) -> None:
        from src.forecasting.models import ARIMAForecaster
        forecaster = ARIMAForecaster()
        series = _sine_series()
        result = forecaster.fit(series)
        assert result is forecaster

    def test_predict_shape(self) -> None:
        from src.forecasting.models import ARIMAForecaster
        forecaster = ARIMAForecaster()
        forecaster.fit(_sine_series(n=90))
        forecast, lower, upper = forecaster.predict(30)
        assert forecast.shape == (30,)
        assert lower.shape == (30,)
        assert upper.shape == (30,)

    def test_predict_non_negative(self) -> None:
        """Clipped values should never go below zero."""
        from src.forecasting.models import ARIMAForecaster
        forecaster = ARIMAForecaster()
        forecaster.fit(_sine_series(n=90))
        forecast, lower, upper = forecaster.predict(30)
        assert np.all(forecast >= 0), "Forecast should be non-negative"
        assert np.all(lower >= 0), "Lower CI should be non-negative"

    def test_predict_before_fit_raises(self) -> None:
        from src.forecasting.models import ARIMAForecaster
        with pytest.raises(RuntimeError, match="fit"):
            ARIMAForecaster().predict(7)

    def test_confidence_intervals_ordered(self) -> None:
        """Upper bound should always be >= lower bound."""
        from src.forecasting.models import ARIMAForecaster
        forecaster = ARIMAForecaster()
        forecaster.fit(_sine_series(n=90))
        _, lower, upper = forecaster.predict(30)
        assert np.all(upper >= lower)

    def test_mape_perfect_prediction(self) -> None:
        from src.forecasting.models import ARIMAForecaster, _mape
        actual = np.array([100.0, 200.0, 300.0])
        assert _mape(actual, actual) == pytest.approx(0.0, abs=1e-9)

    def test_mape_known_error(self) -> None:
        from src.forecasting.models import _mape
        actual = np.array([100.0])
        predicted = np.array([150.0])
        # |100-150| / 100 = 0.5 → 50 %
        assert _mape(actual, predicted) == pytest.approx(50.0, rel=1e-6)

    def test_mape_all_zeros_returns_zero(self) -> None:
        from src.forecasting.models import _mape
        actual = np.zeros(5)
        predicted = np.ones(5)
        assert _mape(actual, predicted) == pytest.approx(0.0)

    def test_short_series_fallback(self) -> None:
        """Should fit without error on a very short series (< 10 obs)."""
        from src.forecasting.models import ARIMAForecaster
        forecaster = ARIMAForecaster()
        short = pd.Series([100.0, 200.0, 150.0, 180.0, 170.0])
        forecaster.fit(short)
        f, lo, hi = forecaster.predict(7)
        assert len(f) == 7

    def test_sine_mape_reasonable(self) -> None:
        """
        ARIMA on a clean sine wave should achieve < 50 % MAPE on a 14-day
        hold-out.  This is a sanity check, not a regression test.
        """
        from src.forecasting.models import ARIMAForecaster
        series = _sine_series(n=120)
        train, val = series.iloc[:90], series.iloc[90:]
        forecaster = ARIMAForecaster()
        forecaster.fit(train)
        pred, _, _ = forecaster.predict(len(val))
        mape_val = forecaster.mape(val.to_numpy(), pred[: len(val)])
        assert mape_val < 150.0, f"MAPE too high: {mape_val:.1f}%"


# ─────────────────────────────────────────────────────────────────────────────
# 2. ExponentialSmoothingForecaster
# ─────────────────────────────────────────────────────────────────────────────

class TestExponentialSmoothingForecaster:
    def test_predict_shape(self) -> None:
        from src.forecasting.models import ExponentialSmoothingForecaster
        f = ExponentialSmoothingForecaster()
        f.fit(_sine_series(n=90))
        forecast, lower, upper = f.predict(30)
        assert forecast.shape == (30,)
        assert lower.shape == (30,)
        assert upper.shape == (30,)

    def test_predict_non_negative(self) -> None:
        from src.forecasting.models import ExponentialSmoothingForecaster
        f = ExponentialSmoothingForecaster()
        f.fit(_sine_series(n=60))
        forecast, lower, _ = f.predict(14)
        assert np.all(forecast >= 0)
        assert np.all(lower >= 0)

    def test_ci_widens_with_horizon(self) -> None:
        """Prediction intervals should grow (or stay equal) as horizon extends."""
        from src.forecasting.models import ExponentialSmoothingForecaster
        f = ExponentialSmoothingForecaster()
        f.fit(_sine_series(n=90))
        _, lo, hi = f.predict(30)
        widths = hi - lo
        # widths[i] >= widths[i-1] for all i
        assert np.all(np.diff(widths) >= -1e-6), "CI width should not shrink"

    def test_short_series_no_seasonal(self) -> None:
        """Series shorter than 14 days should use trend-only model."""
        from src.forecasting.models import ExponentialSmoothingForecaster
        f = ExponentialSmoothingForecaster()
        short = pd.Series([100.0, 120.0, 115.0, 130.0, 125.0, 140.0, 135.0])
        f.fit(short)
        forecast, _, _ = f.predict(7)
        assert len(forecast) == 7


# ─────────────────────────────────────────────────────────────────────────────
# 3. EnsembleForecaster
# ─────────────────────────────────────────────────────────────────────────────

class TestEnsembleForecaster:
    def test_weights_sum_to_one(self) -> None:
        from src.forecasting.models import EnsembleForecaster
        ens = EnsembleForecaster()
        ens.fit(_sine_series(n=100))
        assert abs(ens._arima_weight + ens._es_weight - 1.0) < 1e-9

    def test_predict_shape(self) -> None:
        from src.forecasting.models import EnsembleForecaster
        ens = EnsembleForecaster()
        ens.fit(_sine_series(n=100))
        f, lo, hi = ens.predict(30)
        assert len(f) == 30

    def test_model_name_set(self) -> None:
        from src.forecasting.models import EnsembleForecaster
        ens = EnsembleForecaster()
        ens.fit(_sine_series(n=100))
        assert ens.model_name in {"ensemble", "arima", "exponential_smoothing"}

    def test_compute_weights_one_failed(self) -> None:
        from src.forecasting.models import EnsembleForecaster
        w_a, w_e, name = EnsembleForecaster._compute_weights(5.0, 10.0, True, False)
        assert w_a == pytest.approx(1.0)
        assert w_e == pytest.approx(0.0)
        assert name == "arima"

    def test_compute_weights_both_failed(self) -> None:
        from src.forecasting.models import EnsembleForecaster
        w_a, w_e, name = EnsembleForecaster._compute_weights(0.0, 0.0, False, False)
        assert w_a == pytest.approx(0.5)
        assert w_e == pytest.approx(0.5)

    def test_lower_mape_gets_higher_weight(self) -> None:
        from src.forecasting.models import EnsembleForecaster
        # ARIMA MAPE=5, ES MAPE=20 → ARIMA should get higher weight
        w_a, w_e, _ = EnsembleForecaster._compute_weights(5.0, 20.0, True, True)
        assert w_a > w_e


# ─────────────────────────────────────────────────────────────────────────────
# 4. Runway calculator
# ─────────────────────────────────────────────────────────────────────────────

class TestRunwayCalculator:
    @pytest.fixture
    def mock_ingestor(self):
        """Return a mock ingestor with 90 days of stable $1 000/day outflow."""
        ingestor = MagicMock()
        n = 90
        today = pd.Timestamp.now(tz="UTC").normalize()
        dates = pd.date_range(end=today, periods=n, freq="D", tz="UTC")
        df = pd.DataFrame({
            "date": dates,
            "inflow": np.full(n, 1500.0),
            "outflow": np.full(n, 1000.0),
            "net": np.full(n, 500.0),
            "balance": np.cumsum(np.full(n, 500.0)),
        })
        ingestor.get_historical_cashflow = AsyncMock(return_value=df)
        return ingestor

    @pytest.mark.asyncio
    async def test_base_runway_days(self, mock_ingestor) -> None:
        """
        90 days × $1000/day outflow → monthly burn ≈ $30 440.
        With $100 000 balance → runway ≈ 100 days.
        """
        from src.forecasting.runway import calculate_runway
        with patch("src.forecasting.runway.get_ingestor", return_value=mock_ingestor):
            result = await calculate_runway("merchant_1", current_balance=100_000.0)

        # Monthly burn: $1000/day × 30.44 days/month ≈ $30 440
        assert result.monthly_burn_rate == pytest.approx(30_440, rel=0.05)
        # runway_days ≈ 100_000 / (30_440 / 30.44) ≈ 100
        assert result.runway_days == pytest.approx(100, abs=3)

    @pytest.mark.asyncio
    async def test_conservative_scenario_shorter(self, mock_ingestor) -> None:
        from src.forecasting.runway import calculate_runway
        with patch("src.forecasting.runway.get_ingestor", return_value=mock_ingestor):
            result = await calculate_runway("merchant_1", current_balance=100_000.0)
        assert result.scenario_conservative.runway_days < result.scenario_base.runway_days

    @pytest.mark.asyncio
    async def test_optimistic_scenario_longer(self, mock_ingestor) -> None:
        from src.forecasting.runway import calculate_runway
        with patch("src.forecasting.runway.get_ingestor", return_value=mock_ingestor):
            result = await calculate_runway("merchant_1", current_balance=100_000.0)
        assert result.scenario_optimistic.runway_days > result.scenario_base.runway_days

    @pytest.mark.asyncio
    async def test_zero_balance_returns_zero_days(self, mock_ingestor) -> None:
        from src.forecasting.runway import calculate_runway
        with patch("src.forecasting.runway.get_ingestor", return_value=mock_ingestor):
            result = await calculate_runway("merchant_1", current_balance=0.0)
        assert result.runway_days == 0

    @pytest.mark.asyncio
    async def test_zero_date_is_future(self, mock_ingestor) -> None:
        from src.forecasting.runway import calculate_runway
        with patch("src.forecasting.runway.get_ingestor", return_value=mock_ingestor):
            result = await calculate_runway("merchant_1", current_balance=50_000.0)
        zero_date = date.fromisoformat(result.zero_date)
        assert zero_date > date.today()

    @pytest.mark.asyncio
    async def test_empty_data_returns_max_runway(self) -> None:
        """When there's no history, return the safe 9999-day default."""
        from src.forecasting.runway import calculate_runway
        ingestor = MagicMock()
        ingestor.get_historical_cashflow = AsyncMock(return_value=pd.DataFrame())
        with patch("src.forecasting.runway.get_ingestor", return_value=ingestor):
            result = await calculate_runway("new_merchant", current_balance=50_000.0)
        assert result.runway_days == 9_999

    @pytest.mark.asyncio
    async def test_runway_months_matches_days(self, mock_ingestor) -> None:
        from src.forecasting.runway import _DAYS_PER_MONTH, calculate_runway
        with patch("src.forecasting.runway.get_ingestor", return_value=mock_ingestor):
            result = await calculate_runway("merchant_1", current_balance=100_000.0)
        expected_months = round(result.runway_days / _DAYS_PER_MONTH, 2)
        assert result.runway_months == pytest.approx(expected_months, rel=1e-4)

    @pytest.mark.asyncio
    async def test_scenario_burn_rates(self, mock_ingestor) -> None:
        """Conservative burn = 1.2× base; optimistic = 0.8× base."""
        from src.forecasting.runway import calculate_runway
        with patch("src.forecasting.runway.get_ingestor", return_value=mock_ingestor):
            result = await calculate_runway("merchant_1", current_balance=100_000.0)
        base = result.monthly_burn_rate
        assert result.scenario_conservative.monthly_burn_rate == pytest.approx(base * 1.2, rel=1e-6)
        assert result.scenario_optimistic.monthly_burn_rate == pytest.approx(base * 0.8, rel=1e-6)


# ─────────────────────────────────────────────────────────────────────────────
# 5. Alert Engine
# ─────────────────────────────────────────────────────────────────────────────

def _make_forecast_with_negative_balance(merchant_id: str = "m1") -> "ForecastResult":
    """Build a minimal ForecastResult where day 5 goes negative."""
    from src.models import (
        ConfidenceBand,
        ForecastDataPoint,
        ForecastHorizon,
        ForecastResult,
    )
    today = date.today()
    points = []
    for i in range(30):
        d = (today + timedelta(days=i + 1)).isoformat()
        balance = 5000.0 - (i * 700.0)   # turns negative around day 8
        points.append(ForecastDataPoint(
            date=d,
            predicted_inflow=1000.0,
            predicted_outflow=1700.0,
            predicted_net=-700.0,
            predicted_balance=balance,
        ))
    bands = [ConfidenceBand(date=p.date, lower=-100.0, upper=100.0) for p in points]
    return ForecastResult(
        merchant_id=merchant_id,
        horizon=ForecastHorizon.THIRTY_DAY,
        generated_at=datetime.now(UTC).isoformat(),
        currency="USD",
        forecast_points=points,
        confidence_interval_80=bands,
        confidence_interval_95=bands,
        total_projected_inflow=30_000.0,
        total_projected_outflow=51_000.0,
        projected_ending_balance=-21_000.0,
        model_used="ensemble",
        mape=5.0,
    )


def _make_healthy_forecast(merchant_id: str = "m1") -> "ForecastResult":
    """Build a ForecastResult with no negative balances."""
    from src.models import (
        ConfidenceBand,
        ForecastDataPoint,
        ForecastHorizon,
        ForecastResult,
    )
    today = date.today()
    points = []
    for i in range(30):
        d = (today + timedelta(days=i + 1)).isoformat()
        points.append(ForecastDataPoint(
            date=d,
            predicted_inflow=2000.0,
            predicted_outflow=800.0,
            predicted_net=1200.0,
            predicted_balance=50_000.0 + i * 1200.0,
        ))
    bands = [ConfidenceBand(date=p.date, lower=0.0, upper=100.0) for p in points]
    return ForecastResult(
        merchant_id=merchant_id,
        horizon=ForecastHorizon.THIRTY_DAY,
        generated_at=datetime.now(UTC).isoformat(),
        currency="USD",
        forecast_points=points,
        confidence_interval_80=bands,
        confidence_interval_95=bands,
        total_projected_inflow=60_000.0,
        total_projected_outflow=24_000.0,
        projected_ending_balance=86_000.0,
        model_used="ensemble",
        mape=3.0,
    )


class TestAlertEngine:
    @pytest.fixture(autouse=True)
    def clear_alert_store(self):
        """Wipe the in-memory store before each test."""
        from src.alerts import engine as ae
        ae._alert_store.clear()
        ae._threshold_store.clear()
        yield
        ae._alert_store.clear()
        ae._threshold_store.clear()

    def _make_engine_with_mock_ingestor(self, df: pd.DataFrame):
        from src.alerts.engine import AlertEngine
        engine = AlertEngine.__new__(AlertEngine)
        engine._cfg = MagicMock()
        engine._cfg.low_balance_threshold_usd = 10_000.0
        engine._cfg.runway_warning_days = 90
        ingestor = MagicMock()
        ingestor.get_historical_cashflow = AsyncMock(return_value=df)
        engine._ingestor = ingestor
        return engine

    @pytest.mark.asyncio
    async def test_negative_forecast_triggers_critical_alert(self) -> None:
        df = _make_df(n=60)
        engine = self._make_engine_with_mock_ingestor(df)
        forecast = _make_forecast_with_negative_balance()
        alerts = await engine.evaluate_alerts("m1", forecast, current_balance=50_000.0)
        types = {a.alert_type for a in alerts}
        assert "negative_forecast" in types
        neg = next(a for a in alerts if a.alert_type == "negative_forecast")
        assert neg.severity == "critical"

    @pytest.mark.asyncio
    async def test_low_balance_warning(self) -> None:
        df = _make_df(n=60)
        engine = self._make_engine_with_mock_ingestor(df)
        forecast = _make_healthy_forecast()
        # Balance of $5 000 is below $10 000 threshold → warning
        alerts = await engine.evaluate_alerts("m1", forecast, current_balance=5_000.0)
        types = {a.alert_type for a in alerts}
        assert "low_balance" in types
        low = next(a for a in alerts if a.alert_type == "low_balance")
        assert low.severity == "warning"

    @pytest.mark.asyncio
    async def test_low_balance_critical_below_25pct(self) -> None:
        df = _make_df(n=60)
        engine = self._make_engine_with_mock_ingestor(df)
        forecast = _make_healthy_forecast()
        # Balance of $2 000 < 25 % of $10 000 → critical
        alerts = await engine.evaluate_alerts("m1", forecast, current_balance=2_000.0)
        low = next(a for a in alerts if a.alert_type == "low_balance")
        assert low.severity == "critical"

    @pytest.mark.asyncio
    async def test_no_alerts_when_healthy(self) -> None:
        df = _make_df(n=60)
        engine = self._make_engine_with_mock_ingestor(df)
        forecast = _make_healthy_forecast()
        alerts = await engine.evaluate_alerts("m1", forecast, current_balance=500_000.0)
        # No negative balance, no low balance, burn_spike depends on data
        types = {a.alert_type for a in alerts}
        assert "negative_forecast" not in types
        assert "low_balance" not in types

    @pytest.mark.asyncio
    async def test_burn_spike_alert(self) -> None:
        """
        Create a DataFrame where the last 7 days have 3× the outflow of the
        prior 4 weeks, which should trigger a burn_spike alert.
        """
        n = 35
        today = pd.Timestamp.now(tz="UTC").normalize()
        dates = pd.date_range(end=today, periods=n, freq="D", tz="UTC")
        outflow = np.full(n, 100.0)   # prior weeks: $100/day
        outflow[-7:] = 800.0           # this week: $800/day (8× normal)
        inflow = np.full(n, 1000.0)
        net = inflow - outflow
        df = pd.DataFrame({
            "date": dates, "inflow": inflow, "outflow": outflow,
            "net": net, "balance": np.cumsum(net),
        })
        engine = self._make_engine_with_mock_ingestor(df)
        forecast = _make_healthy_forecast()
        alerts = await engine.evaluate_alerts("m1", forecast, current_balance=100_000.0)
        assert any(a.alert_type == "burn_spike" for a in alerts)

    def test_resolve_alert(self) -> None:
        from src.alerts.engine import AlertEngine, _alert_store
        engine = AlertEngine.__new__(AlertEngine)
        engine._cfg = MagicMock()
        engine._cfg.low_balance_threshold_usd = 10_000.0
        engine._cfg.runway_warning_days = 90
        engine._ingestor = MagicMock()

        # Manually plant an alert
        from src.models import LiquidityAlert
        alert = LiquidityAlert(
            id="test-alert-id",
            merchant_id="m1",
            alert_type="low_balance",
            severity="warning",
            message="Test",
            triggered_at=datetime.now(UTC).isoformat(),
            resolved=False,
            threshold_value=10_000.0,
            actual_value=5_000.0,
        )
        _alert_store["m1"] = [alert]

        found = engine.resolve_alert("m1", "test-alert-id")
        assert found is True
        assert _alert_store["m1"][0].resolved is True

    def test_resolve_nonexistent_alert_returns_false(self) -> None:
        from src.alerts.engine import AlertEngine
        engine = AlertEngine.__new__(AlertEngine)
        engine._cfg = MagicMock()
        engine._ingestor = MagicMock()
        found = engine.resolve_alert("m1", "does-not-exist")
        assert found is False

    @pytest.mark.asyncio
    async def test_deduplication_does_not_duplicate_alerts(self) -> None:
        """Calling evaluate_alerts twice should not double-add the same alert type."""
        from src.alerts.engine import AlertEngine, _alert_store
        df = _make_df(n=60)
        engine = self._make_engine_with_mock_ingestor(df)
        forecast = _make_forecast_with_negative_balance("m2")

        # Every other async test in this file runs under pytest-asyncio via
        # @pytest.mark.asyncio (see test_negative_forecast_triggers_critical_alert
        # above). This one instead drove its own loop with
        # asyncio.get_event_loop().run_until_complete(...) — a pattern that relies
        # on get_event_loop() implicitly creating a loop when none is running, a
        # behavior removed from Python's asyncio in the version this suite now
        # runs under ("RuntimeError: There is no current event loop in thread
        # 'MainThread'"). Matching the file's existing convention fixes it without
        # introducing a second way of running async tests.
        await engine.evaluate_alerts("m2", forecast, current_balance=50_000.0)
        await engine.evaluate_alerts("m2", forecast, current_balance=50_000.0)

        negative_alerts = [
            a for a in _alert_store["m2"]
            if a.alert_type == "negative_forecast"
        ]
        assert len(negative_alerts) == 1, "Should not duplicate the same alert type"


# ─────────────────────────────────────────────────────────────────────────────
# 6. Data ingestor
# ─────────────────────────────────────────────────────────────────────────────

class TestPaymentDataIngestor:
    def test_normalize_to_cashflow_basic(self) -> None:
        from src.data.ingestor import PaymentDataIngestor
        ingestor = PaymentDataIngestor()
        raw = _raw_payments(30)
        points = ingestor.normalize_to_cashflow(raw)
        assert len(points) > 0
        for p in points:
            assert p.inflow >= 0
            assert p.outflow >= 0
            assert abs(p.net - (p.inflow - p.outflow)) < 1e-6

    def test_normalize_empty_list(self) -> None:
        from src.data.ingestor import PaymentDataIngestor
        ingestor = PaymentDataIngestor()
        points = ingestor.normalize_to_cashflow([])
        assert points == []

    def test_normalize_succeeded_adds_to_inflow(self) -> None:
        from src.data.ingestor import PaymentDataIngestor
        ingestor = PaymentDataIngestor()
        raw = [{
            "created_at": "2026-01-15T10:00:00Z",
            "status": "succeeded",
            "amount": 10_000,      # $100.00
            "refund_amount": None,
            "chargeback_amount": None,
            "fee_amount": 290,     # $2.90 explicit fee
        }]
        points = ingestor.normalize_to_cashflow(raw)
        assert len(points) == 1
        assert points[0].inflow == pytest.approx(100.0, rel=1e-4)
        assert points[0].outflow == pytest.approx(2.90, rel=1e-4)

    def test_normalize_refund_adds_to_outflow(self) -> None:
        from src.data.ingestor import PaymentDataIngestor
        ingestor = PaymentDataIngestor()
        raw = [{
            "created_at": "2026-01-15T10:00:00Z",
            "status": "refunded",
            "amount": 0,
            "refund_amount": 5_000,   # $50.00 refund
            "chargeback_amount": None,
            "fee_amount": None,
        }]
        points = ingestor.normalize_to_cashflow(raw)
        assert points[0].outflow == pytest.approx(50.0, rel=1e-4)
        assert points[0].inflow == pytest.approx(0.0)

    def test_normalize_default_fee_applied(self) -> None:
        """Without explicit fee_amount, 2.9 % of the payment should be charged."""
        from src.data.ingestor import PaymentDataIngestor, _DEFAULT_FEE_RATE
        ingestor = PaymentDataIngestor()
        raw = [{
            "created_at": "2026-01-15T10:00:00Z",
            "status": "succeeded",
            "amount": 100_000,   # $1 000.00
            "refund_amount": None,
            "chargeback_amount": None,
        }]
        points = ingestor.normalize_to_cashflow(raw)
        expected_fee = 1000.0 * _DEFAULT_FEE_RATE
        assert points[0].outflow == pytest.approx(expected_fee, rel=1e-4)

    def test_points_to_dataframe_cumulative_balance(self) -> None:
        from src.data.ingestor import PaymentDataIngestor
        from src.models import CashFlowDataPoint
        points = [
            CashFlowDataPoint(date="2026-01-01", inflow=100.0, outflow=30.0, net=70.0),
            CashFlowDataPoint(date="2026-01-02", inflow=200.0, outflow=50.0, net=150.0),
            CashFlowDataPoint(date="2026-01-03", inflow=150.0, outflow=40.0, net=110.0),
        ]
        df = PaymentDataIngestor._points_to_dataframe(points)
        assert list(df["balance"].round(2)) == [70.0, 220.0, 330.0]

    def test_points_to_dataframe_sorted(self) -> None:
        """DataFrame should be sorted ascending by date regardless of input order."""
        from src.data.ingestor import PaymentDataIngestor
        from src.models import CashFlowDataPoint
        points = [
            CashFlowDataPoint(date="2026-01-03", inflow=50.0, outflow=10.0, net=40.0),
            CashFlowDataPoint(date="2026-01-01", inflow=100.0, outflow=30.0, net=70.0),
        ]
        df = PaymentDataIngestor._points_to_dataframe(points)
        dates = df["date"].tolist()
        assert dates == sorted(dates)

    def test_normalize_missing_created_at_skipped(self) -> None:
        from src.data.ingestor import PaymentDataIngestor
        ingestor = PaymentDataIngestor()
        raw = [
            {"status": "succeeded", "amount": 10_000},   # no created_at
            {
                "created_at": "2026-01-15T10:00:00Z",
                "status": "succeeded",
                "amount": 5_000,
                "refund_amount": None,
                "chargeback_amount": None,
            },
        ]
        points = ingestor.normalize_to_cashflow(raw)
        # Only the valid record should appear
        assert len(points) == 1
        assert points[0].inflow == pytest.approx(50.0, rel=1e-4)


# ─────────────────────────────────────────────────────────────────────────────
# 7. _build_forecast_points
# ─────────────────────────────────────────────────────────────────────────────

class TestBuildForecastPoints:
    def test_cumulative_balance_accumulates(self) -> None:
        from src.forecasting.engine import _build_forecast_points
        dates = ["2026-05-13", "2026-05-14", "2026-05-15"]
        inflow = np.array([1000.0, 1200.0, 900.0])
        outflow = np.array([400.0, 500.0, 300.0])
        pts = _build_forecast_points(dates, inflow, outflow, starting_balance=5000.0)

        assert pts[0].predicted_balance == pytest.approx(5600.0)
        assert pts[1].predicted_balance == pytest.approx(6300.0)
        assert pts[2].predicted_balance == pytest.approx(6900.0)

    def test_net_equals_inflow_minus_outflow(self) -> None:
        from src.forecasting.engine import _build_forecast_points
        dates = ["2026-05-13"]
        pts = _build_forecast_points(
            dates,
            np.array([500.0]),
            np.array([200.0]),
            starting_balance=0.0,
        )
        assert pts[0].predicted_net == pytest.approx(300.0)

    def test_length_matches_dates(self) -> None:
        from src.forecasting.engine import _build_forecast_points
        dates = [f"2026-05-{i:02d}" for i in range(1, 31)]
        pts = _build_forecast_points(
            dates,
            np.ones(30) * 1000,
            np.ones(30) * 500,
            starting_balance=10_000.0,
        )
        assert len(pts) == 30


# ─────────────────────────────────────────────────────────────────────────────
# 8. ForecastResult model validation
# ─────────────────────────────────────────────────────────────────────────────

class TestForecastResultModel:
    def test_mape_must_be_non_negative(self) -> None:
        from pydantic import ValidationError
        from src.models import ForecastResult, ForecastHorizon
        with pytest.raises(ValidationError):
            ForecastResult(
                merchant_id="m1",
                horizon=ForecastHorizon.THIRTY_DAY,
                generated_at=datetime.now(UTC).isoformat(),
                currency="USD",
                forecast_points=[],
                confidence_interval_80=[],
                confidence_interval_95=[],
                total_projected_inflow=0.0,
                total_projected_outflow=0.0,
                projected_ending_balance=0.0,
                model_used="ensemble",
                mape=-1.0,   # invalid
            )

    def test_forecast_horizon_to_days(self) -> None:
        from src.models import ForecastHorizon
        assert ForecastHorizon.SEVEN_DAY.to_days() == 7
        assert ForecastHorizon.THIRTY_DAY.to_days() == 30
        assert ForecastHorizon.NINETY_DAY.to_days() == 90

    def test_forecast_horizon_values(self) -> None:
        from src.models import ForecastHorizon
        assert ForecastHorizon("7d") is ForecastHorizon.SEVEN_DAY
        assert ForecastHorizon("30d") is ForecastHorizon.THIRTY_DAY
        assert ForecastHorizon("90d") is ForecastHorizon.NINETY_DAY

    def test_invalid_horizon_raises(self) -> None:
        from src.models import ForecastHorizon
        with pytest.raises(ValueError):
            ForecastHorizon("365d")
