"""
Pydantic domain models for the Liquidity Forecaster service.
All monetary values are in the merchant's settlement currency (default USD).
"""

from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, Field


# ── Enumerations ──────────────────────────────────────────────────────────────

class ForecastHorizon(str, Enum):
    SEVEN_DAY = "7d"
    THIRTY_DAY = "30d"
    NINETY_DAY = "90d"

    def to_days(self) -> int:
        return {"7d": 7, "30d": 30, "90d": 90}[self.value]


# ── Cash-flow primitives ──────────────────────────────────────────────────────

class CashFlowDataPoint(BaseModel):
    date: str          # ISO-8601 date string, e.g. "2026-05-12"
    inflow: float      # gross receipts (successful payments)
    outflow: float     # refunds + chargebacks + ForgePay fees
    net: float         # inflow − outflow
    currency: str = "USD"


# ── Forecast output ───────────────────────────────────────────────────────────

class ForecastDataPoint(BaseModel):
    date: str
    predicted_inflow: float
    predicted_outflow: float
    predicted_net: float
    predicted_balance: float  # cumulative from starting balance


class ConfidenceBand(BaseModel):
    date: str
    lower: float
    upper: float


class ForecastResult(BaseModel):
    merchant_id: str
    horizon: ForecastHorizon
    generated_at: str  # ISO-8601 datetime
    currency: str = "USD"

    forecast_points: list[ForecastDataPoint]
    confidence_interval_80: list[ConfidenceBand]
    confidence_interval_95: list[ConfidenceBand]

    total_projected_inflow: float
    total_projected_outflow: float
    projected_ending_balance: float

    # "arima" | "exponential_smoothing" | "ensemble"
    model_used: str

    # Mean Absolute Percentage Error on the 30-day hold-out validation set
    mape: float = Field(ge=0.0)


# ── Runway calculator ─────────────────────────────────────────────────────────

class RunwayScenario(BaseModel):
    label: str
    monthly_burn_rate: float   # USD / month (adjusted by scenario factor)
    runway_days: int
    zero_date: str             # ISO date when balance reaches zero


class RunwayResult(BaseModel):
    merchant_id: str
    current_balance_usd: float
    monthly_burn_rate: float   # baseline (no adjustment)
    runway_days: int
    runway_months: float
    zero_date: str             # ISO date when balance hits zero

    scenario_conservative: RunwayScenario   # 20 % revenue decline → higher burn
    scenario_base: RunwayScenario
    scenario_optimistic: RunwayScenario     # 20 % revenue increase → lower net burn


# ── Alerts ────────────────────────────────────────────────────────────────────

class LiquidityAlert(BaseModel):
    id: str
    merchant_id: str

    # "low_balance" | "negative_forecast" | "burn_spike" | "runway_warning"
    alert_type: str

    # "info" | "warning" | "critical"
    severity: str

    message: str
    triggered_at: str   # ISO-8601 datetime
    resolved: bool = False
    threshold_value: float
    actual_value: float


class AlertThresholds(BaseModel):
    low_balance_usd: float = 10_000.0
    runway_warning_days: int = 90
    burn_spike_multiplier: float = 2.0


# ── Ingest status ─────────────────────────────────────────────────────────────

class IngestStatus(BaseModel):
    merchant_id: str
    last_ingested_at: str | None   # ISO-8601 datetime or None if never run
    row_count: int
    source: str = "payment-engine"
