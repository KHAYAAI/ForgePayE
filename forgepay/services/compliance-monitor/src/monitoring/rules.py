"""
AML transaction monitoring rules.

Each Rule has an `evaluate(transaction, merchant_history) -> MonitoringRule | None` method.
Rules return None when the transaction does not trigger the rule.

Transaction dict schema (as received from the payment engine):
    {
        "id": str,
        "merchant_id": str,
        "amount_usd": float,          # already converted to USD equivalent
        "amount": float,              # original amount
        "currency": str,              # ISO-4217
        "payment_method": str,        # "card" | "bank" | "crypto"
        "payer_country": str,         # ISO-3166 alpha-2
        "payer_ip_country": str,      # ISO-3166 alpha-2 (GeoIP)
        "created_at": str,            # ISO-8601 UTC
        "metadata": dict,
    }

merchant_history is a list of the same transaction dicts, sorted
descending by created_at (most recent first).  The evaluating engine
always prepends the current transaction so rules can count it.
"""

from __future__ import annotations

import abc
from datetime import datetime, timedelta, timezone
from typing import Any

from src.models import MonitoringRule

# ---------------------------------------------------------------------------
# High-risk country lists
# ---------------------------------------------------------------------------
_HIGH_RISK_COUNTRIES: frozenset[str] = frozenset(
    {"IR", "KP", "SY", "CU", "RU", "BY", "MM", "SD", "YE"}
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _parse_ts(ts: str) -> datetime:
    """Parse ISO-8601 UTC timestamp string to aware datetime."""
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except ValueError:
        return datetime.now(timezone.utc)


def _txns_in_window(
    history: list[dict[str, Any]],
    anchor: datetime,
    hours: float,
) -> list[dict[str, Any]]:
    """Return transactions within `hours` before `anchor`."""
    cutoff = anchor - timedelta(hours=hours)
    return [t for t in history if cutoff <= _parse_ts(t["created_at"]) <= anchor]


def _txns_in_minutes(
    history: list[dict[str, Any]],
    anchor: datetime,
    minutes: float,
) -> list[dict[str, Any]]:
    return _txns_in_window(history, anchor, hours=minutes / 60.0)


# ---------------------------------------------------------------------------
# Abstract base
# ---------------------------------------------------------------------------


class Rule(abc.ABC):
    rule_id: str
    rule_name: str
    category: str
    severity: str
    enabled: bool = True

    @abc.abstractmethod
    def evaluate(
        self,
        transaction: dict[str, Any],
        merchant_history: list[dict[str, Any]],
    ) -> MonitoringRule | None:
        ...


# ---------------------------------------------------------------------------
# Rule implementations
# ---------------------------------------------------------------------------


class StructuringRule(Rule):
    """
    STRUCTURING — transactions just below the $10,000 cash-reporting threshold.

    Detects when the current transaction falls in the $9,900–$9,999 (exclusive)
    band AND there is at least one other transaction in the same band within
    the past 24 hours.  A single below-threshold transaction is suspicious;
    multiple in 24h strongly suggests structured placement.
    """

    rule_id = "AML-001"
    rule_name = "Structuring Detection"
    category = "structuring"
    severity = "high"

    def __init__(self, threshold_usd: float = 10_000.0) -> None:
        self._threshold = threshold_usd
        self._lower = threshold_usd * 0.99    # 9,900 for default 10k threshold
        self._upper = threshold_usd * 0.9999  # 9,999.9

    def evaluate(
        self,
        transaction: dict[str, Any],
        merchant_history: list[dict[str, Any]],
    ) -> MonitoringRule | None:
        amount = float(transaction.get("amount_usd", 0))
        if not (self._lower <= amount < self._upper):
            return None

        anchor = _parse_ts(transaction["created_at"])
        # Include current txn in the 24h window count
        all_recent = _txns_in_window(merchant_history, anchor, hours=24)
        structured = [
            t for t in all_recent
            if self._lower <= float(t.get("amount_usd", 0)) < self._upper
        ]

        if len(structured) < 2:
            return None

        return MonitoringRule(
            rule_id=self.rule_id,
            rule_name=self.rule_name,
            category=self.category,
            severity=self.severity,
            description=(
                f"Transaction amount ${amount:,.2f} falls just below the "
                f"${self._threshold:,.0f} reporting threshold. "
                f"{len(structured)} such transactions detected in the past 24 hours."
            ),
            triggered_values={
                "amount_usd": amount,
                "threshold_usd": self._threshold,
                "transactions_in_24h": len(structured),
                "lower_band": self._lower,
                "upper_band": self._upper,
            },
        )


class VelocitySpikeRule(Rule):
    """
    VELOCITY_SPIKE — transaction count in last 1h > 3× the 30-day hourly average.
    """

    rule_id = "AML-002"
    rule_name = "Transaction Velocity Spike"
    category = "velocity"
    severity = "medium"

    def evaluate(
        self,
        transaction: dict[str, Any],
        merchant_history: list[dict[str, Any]],
    ) -> MonitoringRule | None:
        anchor = _parse_ts(transaction["created_at"])

        last_1h = _txns_in_window(merchant_history, anchor, hours=1)
        count_1h = len(last_1h)

        last_30d = _txns_in_window(merchant_history, anchor, hours=720)
        # 30 days = 720 hours; avoid div-by-zero
        avg_hourly = len(last_30d) / 720.0

        if avg_hourly < 0.1:
            # Fewer than 0.1 txns/h baseline — spike rule doesn't apply
            return None

        spike_ratio = count_1h / avg_hourly
        if spike_ratio <= 3.0:
            return None

        return MonitoringRule(
            rule_id=self.rule_id,
            rule_name=self.rule_name,
            category=self.category,
            severity=self.severity,
            description=(
                f"Transaction velocity spiked to {count_1h} in the last hour, "
                f"{spike_ratio:.1f}× the 30-day hourly average of {avg_hourly:.1f}."
            ),
            triggered_values={
                "count_last_1h": count_1h,
                "avg_hourly_30d": round(avg_hourly, 2),
                "spike_ratio": round(spike_ratio, 2),
            },
        )


class HighRiskJurisdictionRule(Rule):
    """
    HIGH_RISK_JURISDICTION — payer IP or bank country is on the OFAC/US embargo list.
    """

    rule_id = "AML-003"
    rule_name = "High Risk Jurisdiction"
    category = "high_risk_jurisdiction"
    severity = "critical"

    def __init__(self, high_risk_countries: frozenset[str] | None = None) -> None:
        self._countries = high_risk_countries or _HIGH_RISK_COUNTRIES

    def evaluate(
        self,
        transaction: dict[str, Any],
        merchant_history: list[dict[str, Any]],
    ) -> MonitoringRule | None:
        payer_country = (transaction.get("payer_country") or "").strip().upper()
        ip_country = (transaction.get("payer_ip_country") or "").strip().upper()

        triggered: list[str] = []
        for cc in (payer_country, ip_country):
            if cc and cc in self._countries:
                triggered.append(cc)

        if not triggered:
            return None

        return MonitoringRule(
            rule_id=self.rule_id,
            rule_name=self.rule_name,
            category=self.category,
            severity=self.severity,
            description=(
                f"Transaction involves high-risk jurisdiction(s): {', '.join(set(triggered))}. "
                "These countries are subject to comprehensive OFAC sanctions programs."
            ),
            triggered_values={
                "payer_country": payer_country,
                "ip_country": ip_country,
                "high_risk_countries_matched": list(set(triggered)),
            },
        )


class LargeSingleTransactionRule(Rule):
    """
    LARGE_SINGLE_TRANSACTION — single transaction > $50,000 USD equivalent.
    """

    rule_id = "AML-004"
    rule_name = "Large Single Transaction"
    category = "unusual_pattern"
    severity = "high"

    def __init__(self, threshold_usd: float = 50_000.0) -> None:
        self._threshold = threshold_usd

    def evaluate(
        self,
        transaction: dict[str, Any],
        merchant_history: list[dict[str, Any]],
    ) -> MonitoringRule | None:
        amount = float(transaction.get("amount_usd", 0))
        if amount <= self._threshold:
            return None

        return MonitoringRule(
            rule_id=self.rule_id,
            rule_name=self.rule_name,
            category=self.category,
            severity=self.severity,
            description=(
                f"Single transaction of ${amount:,.2f} exceeds the "
                f"${self._threshold:,.0f} large-transaction threshold."
            ),
            triggered_values={
                "amount_usd": amount,
                "threshold_usd": self._threshold,
                "excess_usd": round(amount - self._threshold, 2),
            },
        )


class RapidSuccessionRule(Rule):
    """
    RAPID_SUCCESSION — same amount sent/received 3+ times within 10 minutes.
    """

    rule_id = "AML-005"
    rule_name = "Rapid Succession Same Amount"
    category = "unusual_pattern"
    severity = "high"

    def evaluate(
        self,
        transaction: dict[str, Any],
        merchant_history: list[dict[str, Any]],
    ) -> MonitoringRule | None:
        amount = float(transaction.get("amount_usd", 0))
        anchor = _parse_ts(transaction["created_at"])

        recent_10m = _txns_in_minutes(merchant_history, anchor, minutes=10)
        # Match within $0.01 of the triggering transaction amount
        same_amount = [
            t for t in recent_10m
            if abs(float(t.get("amount_usd", 0)) - amount) < 0.01
        ]

        if len(same_amount) < 3:
            return None

        return MonitoringRule(
            rule_id=self.rule_id,
            rule_name=self.rule_name,
            category=self.category,
            severity=self.severity,
            description=(
                f"Amount ${amount:,.2f} appeared {len(same_amount)} times within 10 minutes. "
                "Possible automated layering or testing activity."
            ),
            triggered_values={
                "amount_usd": amount,
                "repetition_count": len(same_amount),
                "window_minutes": 10,
            },
        )


class DormantAccountSpikeRule(Rule):
    """
    DORMANT_ACCOUNT_SPIKE — account inactive >30 days suddenly processes >$5,000.
    """

    rule_id = "AML-006"
    rule_name = "Dormant Account Spike"
    category = "unusual_pattern"
    severity = "medium"

    _DORMANCY_DAYS = 30
    _SPIKE_THRESHOLD_USD = 5_000.0

    def evaluate(
        self,
        transaction: dict[str, Any],
        merchant_history: list[dict[str, Any]],
    ) -> MonitoringRule | None:
        amount = float(transaction.get("amount_usd", 0))
        if amount < self._SPIKE_THRESHOLD_USD:
            return None

        anchor = _parse_ts(transaction["created_at"])
        cutoff = anchor - timedelta(days=self._DORMANCY_DAYS)

        # Exclude the current transaction from the history check
        prior = [
            t for t in merchant_history
            if t.get("id") != transaction.get("id")
        ]

        # Check if any transaction exists in the last 30 days (excluding current)
        recent_prior = [t for t in prior if _parse_ts(t["created_at"]) >= cutoff]
        if recent_prior:
            return None  # Account was active — not dormant

        # Confirm account has historical activity (not brand new)
        if not prior:
            return None

        last_txn_ts = max(_parse_ts(t["created_at"]) for t in prior)
        dormant_days = (anchor - last_txn_ts).days

        return MonitoringRule(
            rule_id=self.rule_id,
            rule_name=self.rule_name,
            category=self.category,
            severity=self.severity,
            description=(
                f"Account was dormant for {dormant_days} days and suddenly processed "
                f"${amount:,.2f}. Last activity: {last_txn_ts.date().isoformat()}."
            ),
            triggered_values={
                "amount_usd": amount,
                "dormant_days": dormant_days,
                "last_activity": last_txn_ts.isoformat(),
                "spike_threshold_usd": self._SPIKE_THRESHOLD_USD,
            },
        )


class CryptoLayeringRule(Rule):
    """
    CRYPTO_LAYERING — multiple small crypto transactions followed by a large fiat
    withdrawal within 48 hours.

    Heuristic:
      - 3+ crypto transactions, each < $3,000, in past 48h
      - Followed by a fiat transaction > 70% of their aggregate sum
    """

    rule_id = "AML-007"
    rule_name = "Crypto Layering Pattern"
    category = "layering"
    severity = "critical"

    _MIN_CRYPTO_COUNT = 3
    _MAX_CRYPTO_AMOUNT_USD = 3_000.0
    _FIAT_FRACTION = 0.70
    _WINDOW_HOURS = 48

    def evaluate(
        self,
        transaction: dict[str, Any],
        merchant_history: list[dict[str, Any]],
    ) -> MonitoringRule | None:
        # Current transaction must be a large fiat withdrawal
        payment_method = (transaction.get("payment_method") or "").lower()
        if payment_method not in ("bank", "card", "fiat"):
            return None

        fiat_amount = float(transaction.get("amount_usd", 0))
        anchor = _parse_ts(transaction["created_at"])

        window = _txns_in_window(merchant_history, anchor, hours=self._WINDOW_HOURS)
        crypto_txns = [
            t for t in window
            if (t.get("payment_method") or "").lower() == "crypto"
            and float(t.get("amount_usd", 0)) < self._MAX_CRYPTO_AMOUNT_USD
            and t.get("id") != transaction.get("id")
        ]

        if len(crypto_txns) < self._MIN_CRYPTO_COUNT:
            return None

        crypto_total = sum(float(t.get("amount_usd", 0)) for t in crypto_txns)
        if fiat_amount < crypto_total * self._FIAT_FRACTION:
            return None

        return MonitoringRule(
            rule_id=self.rule_id,
            rule_name=self.rule_name,
            category=self.category,
            severity=self.severity,
            description=(
                f"{len(crypto_txns)} small crypto transactions (total ${crypto_total:,.2f}) "
                f"followed by ${fiat_amount:,.2f} fiat withdrawal within {self._WINDOW_HOURS}h. "
                "Classic crypto layering pattern."
            ),
            triggered_values={
                "fiat_amount_usd": fiat_amount,
                "crypto_transaction_count": len(crypto_txns),
                "crypto_total_usd": round(crypto_total, 2),
                "window_hours": self._WINDOW_HOURS,
            },
        )


class RoundAmountPatternRule(Rule):
    """
    ROUND_AMOUNT_PATTERN — 5+ consecutive round-number transactions ($100, $500, $1000 exact).

    "Round" = amount in USD is divisible by 100 with no remainder.
    """

    rule_id = "AML-008"
    rule_name = "Round Amount Pattern"
    category = "unusual_pattern"
    severity = "medium"

    _MIN_COUNT = 5
    _ROUND_DIVISOR = 100.0
    _WINDOW_HOURS = 72  # Look back 3 days

    def evaluate(
        self,
        transaction: dict[str, Any],
        merchant_history: list[dict[str, Any]],
    ) -> MonitoringRule | None:
        amount = float(transaction.get("amount_usd", 0))
        if amount % self._ROUND_DIVISOR != 0:
            return None  # Current transaction is not round

        anchor = _parse_ts(transaction["created_at"])
        window = _txns_in_window(merchant_history, anchor, hours=self._WINDOW_HOURS)
        round_txns = [
            t for t in window
            if float(t.get("amount_usd", 0)) % self._ROUND_DIVISOR == 0
        ]

        if len(round_txns) < self._MIN_COUNT:
            return None

        amounts = [float(t.get("amount_usd", 0)) for t in round_txns]
        return MonitoringRule(
            rule_id=self.rule_id,
            rule_name=self.rule_name,
            category=self.category,
            severity=self.severity,
            description=(
                f"{len(round_txns)} round-number transactions detected in the past "
                f"{self._WINDOW_HOURS}h. Amounts: {sorted(set(amounts))}."
            ),
            triggered_values={
                "current_amount_usd": amount,
                "round_transaction_count": len(round_txns),
                "window_hours": self._WINDOW_HOURS,
                "unique_amounts": sorted(set(amounts)),
            },
        )


# ---------------------------------------------------------------------------
# Rule registry
# ---------------------------------------------------------------------------

def build_default_ruleset(
    structuring_threshold: float = 10_000.0,
    large_txn_threshold: float = 50_000.0,
    high_risk_countries: frozenset[str] | None = None,
) -> list[Rule]:
    """Build the default list of AML monitoring rules."""
    return [
        StructuringRule(threshold_usd=structuring_threshold),
        VelocitySpikeRule(),
        HighRiskJurisdictionRule(high_risk_countries=high_risk_countries),
        LargeSingleTransactionRule(threshold_usd=large_txn_threshold),
        RapidSuccessionRule(),
        DormantAccountSpikeRule(),
        CryptoLayeringRule(),
        RoundAmountPatternRule(),
    ]
