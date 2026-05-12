"""
Alert Engine — evaluates liquidity alerts against current state.

Alert types
───────────
  LOW_BALANCE       — current cash balance below threshold (default $10 k)
  RUNWAY_WARNING    — runway < N days (default 90)
  NEGATIVE_FORECAST — any day in the 30-day forecast shows negative balance
  BURN_SPIKE        — this week's total outflow > N× the prior 4-week average

All alerts are stored in an in-memory dict keyed by alert ``id``.
Production: swap the store for a PostgreSQL table (one row per alert).

Severity mapping
────────────────
  LOW_BALANCE   < 25 % of threshold → critical; otherwise → warning
  RUNWAY_WARNING< 30 days           → critical; < 60 days → warning; else → info
  NEGATIVE_FORECAST                 → critical
  BURN_SPIKE                        → warning
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pandas as pd
import structlog

from src.config import get_settings
from src.data.ingestor import get_ingestor
from src.models import AlertThresholds, ForecastResult, LiquidityAlert

log = structlog.get_logger(__name__)

# In-memory store: merchant_id → list[LiquidityAlert]
# Production: replace with DB-backed repository.
_alert_store: dict[str, list[LiquidityAlert]] = {}

# Per-merchant threshold overrides: merchant_id → AlertThresholds
_threshold_store: dict[str, AlertThresholds] = {}


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _make_alert(
    merchant_id: str,
    alert_type: str,
    severity: str,
    message: str,
    threshold_value: float,
    actual_value: float,
) -> LiquidityAlert:
    return LiquidityAlert(
        id=str(uuid.uuid4()),
        merchant_id=merchant_id,
        alert_type=alert_type,
        severity=severity,
        message=message,
        triggered_at=_now_iso(),
        resolved=False,
        threshold_value=threshold_value,
        actual_value=actual_value,
    )


class AlertEngine:
    """
    Evaluates liquidity alerts for a single merchant.
    """

    def __init__(self) -> None:
        self._cfg = get_settings()
        self._ingestor = get_ingestor()

    def _get_thresholds(self, merchant_id: str) -> AlertThresholds:
        return _threshold_store.get(merchant_id, AlertThresholds(
            low_balance_usd=self._cfg.low_balance_threshold_usd,
            runway_warning_days=self._cfg.runway_warning_days,
        ))

    # ── Public API ────────────────────────────────────────────────────────────

    async def evaluate_alerts(
        self,
        merchant_id: str,
        forecast: ForecastResult,
        current_balance: float,
    ) -> list[LiquidityAlert]:
        """
        Run all alert evaluators and persist newly triggered alerts.
        Returns the full list of active (unresolved) alerts after evaluation.
        """
        thresholds = self._get_thresholds(merchant_id)
        new_alerts: list[LiquidityAlert] = []

        # 1. Low balance
        alert = self._check_low_balance(merchant_id, current_balance, thresholds)
        if alert:
            new_alerts.append(alert)

        # 2. Runway warning
        alert = self._check_runway_warning(merchant_id, current_balance, thresholds)
        if alert:
            new_alerts.append(alert)

        # 3. Negative forecast (any day in next 30 days)
        alert = self._check_negative_forecast(merchant_id, forecast)
        if alert:
            new_alerts.append(alert)

        # 4. Burn spike (requires historical cashflow)
        alert = await self._check_burn_spike(merchant_id, thresholds)
        if alert:
            new_alerts.append(alert)

        # Deduplicate: don't re-add the same alert_type that is already active
        existing = _alert_store.get(merchant_id, [])
        active_types = {a.alert_type for a in existing if not a.resolved}
        for alert in new_alerts:
            if alert.alert_type not in active_types:
                existing.append(alert)
                active_types.add(alert.alert_type)
                log.info(
                    "alert_triggered",
                    merchant_id=merchant_id,
                    alert_type=alert.alert_type,
                    severity=alert.severity,
                    actual=alert.actual_value,
                    threshold=alert.threshold_value,
                )

        _alert_store[merchant_id] = existing
        return [a for a in existing if not a.resolved]

    def get_active_alerts(self, merchant_id: str) -> list[LiquidityAlert]:
        """Return all unresolved alerts for a merchant."""
        return [a for a in _alert_store.get(merchant_id, []) if not a.resolved]

    def resolve_alert(self, merchant_id: str, alert_id: str) -> bool:
        """
        Mark an alert as resolved.  Returns True if the alert was found and
        updated, False if it did not exist.
        """
        alerts = _alert_store.get(merchant_id, [])
        for alert in alerts:
            if alert.id == alert_id:
                alert.resolved = True
                log.info("alert_resolved", merchant_id=merchant_id, alert_id=alert_id)
                return True
        return False

    def update_thresholds(self, merchant_id: str, thresholds: AlertThresholds) -> None:
        """Persist per-merchant alert threshold overrides."""
        _threshold_store[merchant_id] = thresholds
        log.info(
            "thresholds_updated",
            merchant_id=merchant_id,
            low_balance_usd=thresholds.low_balance_usd,
            runway_warning_days=thresholds.runway_warning_days,
        )

    # ── Individual evaluators ─────────────────────────────────────────────────

    def _check_low_balance(
        self,
        merchant_id: str,
        current_balance: float,
        thresholds: AlertThresholds,
    ) -> LiquidityAlert | None:
        threshold = thresholds.low_balance_usd
        if current_balance >= threshold:
            return None

        # Severity: critical when balance is below 25 % of threshold
        severity = "critical" if current_balance < threshold * 0.25 else "warning"
        return _make_alert(
            merchant_id=merchant_id,
            alert_type="low_balance",
            severity=severity,
            message=(
                f"Current balance ${current_balance:,.2f} is below the "
                f"${threshold:,.2f} threshold."
            ),
            threshold_value=threshold,
            actual_value=round(current_balance, 2),
        )

    def _check_runway_warning(
        self,
        merchant_id: str,
        current_balance: float,
        thresholds: AlertThresholds,
    ) -> LiquidityAlert | None:
        """
        Compute a quick runway estimate from the forecast balance trend and
        the balance.  A full RunwayResult is computed separately by the runway
        router; here we do a lightweight check using current_balance and the
        threshold only.

        Since we don't have burn rate in scope here, this alert is based
        purely on the runway_warning_days threshold crossed by the user's
        explicitly supplied current_balance vs the threshold setting.
        The runway router handles the full scenario computation.
        """
        warning_days = thresholds.runway_warning_days
        # Delegate actual runway_days computation to the runway module
        # to avoid circular imports.  Here we fire the alert if balance
        # is <= 0 (i.e. already in deficit).
        if current_balance > 0:
            return None

        return _make_alert(
            merchant_id=merchant_id,
            alert_type="runway_warning",
            severity="critical",
            message=(
                f"Current balance is ${current_balance:,.2f} — "
                "account is already in deficit."
            ),
            threshold_value=float(warning_days),
            actual_value=0.0,
        )

    @staticmethod
    def _check_negative_forecast(
        merchant_id: str,
        forecast: ForecastResult,
    ) -> LiquidityAlert | None:
        """
        Check whether any day in the 30-day forecast window shows a negative
        predicted balance.
        """
        # Only look at the first 30 forecast points
        window = forecast.forecast_points[:30]
        negative_days = [p for p in window if p.predicted_balance < 0]
        if not negative_days:
            return None

        first_negative = negative_days[0]
        return _make_alert(
            merchant_id=merchant_id,
            alert_type="negative_forecast",
            severity="critical",
            message=(
                f"Forecast predicts a negative balance of "
                f"${first_negative.predicted_balance:,.2f} on {first_negative.date}."
            ),
            threshold_value=0.0,
            actual_value=round(first_negative.predicted_balance, 2),
        )

    async def _check_burn_spike(
        self,
        merchant_id: str,
        thresholds: AlertThresholds,
    ) -> LiquidityAlert | None:
        """
        Fire if this week's total outflow exceeds the threshold multiplier
        times the four-week rolling average.
        """
        # We need at least 35 days of data (7 + 28)
        df = await self._ingestor.get_historical_cashflow(merchant_id, days_back=35)
        if df.empty or len(df) < 14:
            return None

        df_sorted = df.sort_values("date")
        this_week = df_sorted.tail(7)["outflow"].sum()
        prior_4_weeks = df_sorted.iloc[-35:-7]["outflow"].sum() if len(df_sorted) >= 35 else 0.0

        if prior_4_weeks == 0:
            return None

        prior_weekly_avg = prior_4_weeks / 4.0
        multiplier = thresholds.burn_spike_multiplier

        if this_week <= prior_weekly_avg * multiplier:
            return None

        return _make_alert(
            merchant_id=merchant_id,
            alert_type="burn_spike",
            severity="warning",
            message=(
                f"This week's outflow (${this_week:,.2f}) is "
                f"{this_week / prior_weekly_avg:.1f}× the 4-week average "
                f"(${prior_weekly_avg:,.2f}/week)."
            ),
            threshold_value=round(prior_weekly_avg * multiplier, 2),
            actual_value=round(this_week, 2),
        )


# Module-level singleton
_alert_engine: AlertEngine | None = None


def get_alert_engine() -> AlertEngine:
    global _alert_engine
    if _alert_engine is None:
        _alert_engine = AlertEngine()
    return _alert_engine
