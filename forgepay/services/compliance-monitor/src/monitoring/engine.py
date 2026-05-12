"""
Transaction monitoring engine.

Evaluates individual transactions against all active AML rules and computes
a risk decision.  Also provides a cron-callable `run_monitoring_cycle()` that
fetches unscreened transactions from the payment engine and evaluates each.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import httpx
import structlog

from src.config import get_settings
from src.models import MonitoringRule, TransactionMonitoringResult
from src.monitoring.rules import Rule, build_default_ruleset

logger = structlog.get_logger(__name__)
settings = get_settings()

# ---------------------------------------------------------------------------
# Severity → numeric weight
# ---------------------------------------------------------------------------
_SEVERITY_WEIGHTS: dict[str, int] = {
    "low": 5,
    "medium": 15,
    "high": 30,
    "critical": 50,
}


def _compute_risk_score(triggered_rules: list[MonitoringRule]) -> int:
    total = sum(_SEVERITY_WEIGHTS.get(r.severity, 0) for r in triggered_rules)
    return min(total, 100)


def _decide(risk_score: int) -> str:
    if risk_score >= 70:
        return "block"
    if risk_score >= 30:
        return "review"
    return "allow"


def _requires_sar(
    risk_score: int,
    triggered_rules: list[MonitoringRule],
    sar_threshold: int,
) -> bool:
    if risk_score >= sar_threshold:
        return True
    return any(r.severity == "critical" for r in triggered_rules)


# ---------------------------------------------------------------------------
# Engine
# ---------------------------------------------------------------------------


class TransactionMonitoringEngine:
    """
    Evaluates payment transactions against the AML rule set.

    The engine maintains an in-memory set of already-evaluated transaction IDs
    to avoid double-processing during the monitoring cycle.
    """

    def __init__(
        self,
        rules: list[Rule] | None = None,
        payment_engine_url: str | None = None,
        sar_threshold: int | None = None,
    ) -> None:
        self._rules: list[Rule] = rules or build_default_ruleset(
            structuring_threshold=settings.structuring_threshold_usd,
            large_txn_threshold=settings.large_transaction_threshold_usd,
            high_risk_countries=settings.high_risk_countries_set,
        )
        self._payment_engine_url = payment_engine_url or settings.payment_engine_url
        self._sar_threshold = sar_threshold or settings.sar_auto_threshold_score
        self._evaluated_ids: set[str] = set()
        # In-memory alert store: merchant_id → list[TransactionMonitoringResult]
        self._alerts: dict[str, list[TransactionMonitoringResult]] = {}

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def evaluate_transaction(
        self, transaction: dict[str, Any]
    ) -> TransactionMonitoringResult:
        """
        Evaluate a single transaction against all AML rules.

        Steps:
          1. Fetch merchant's 90-day transaction history from payment engine.
          2. Run all enabled rules against transaction + history.
          3. Compute risk score and decision.
          4. Determine if SAR is required.
          5. Cache result.
        """
        txn_id = transaction.get("id", "unknown")
        merchant_id = transaction.get("merchant_id", "")

        logger.info("monitoring.evaluate", transaction_id=txn_id, merchant_id=merchant_id)

        history = await self._fetch_history(merchant_id)
        # Prepend current transaction so rules can count it in time windows
        full_history = [transaction] + [
            t for t in history if t.get("id") != txn_id
        ]

        triggered: list[MonitoringRule] = []
        for rule in self._rules:
            if not rule.enabled:
                continue
            try:
                fired = rule.evaluate(transaction, full_history)
                if fired is not None:
                    triggered.append(fired)
                    logger.info(
                        "monitoring.rule_fired",
                        transaction_id=txn_id,
                        rule_id=rule.rule_id,
                        severity=rule.severity,
                    )
            except Exception as exc:
                logger.exception(
                    "monitoring.rule_error",
                    rule_id=rule.rule_id,
                    error=str(exc),
                )

        risk_score = _compute_risk_score(triggered)
        decision = _decide(risk_score)
        sar_needed = _requires_sar(risk_score, triggered, self._sar_threshold)

        result = TransactionMonitoringResult(
            transaction_id=txn_id,
            merchant_id=merchant_id,
            amount=float(transaction.get("amount", 0)),
            currency=transaction.get("currency", "USD"),
            evaluated_at=datetime.now(timezone.utc).isoformat(),
            rules_triggered=triggered,
            risk_score=risk_score,
            decision=decision,
            requires_sar=sar_needed,
        )

        self._evaluated_ids.add(txn_id)

        if triggered or risk_score >= 30:
            self._alerts.setdefault(merchant_id, []).append(result)

        logger.info(
            "monitoring.evaluated",
            transaction_id=txn_id,
            risk_score=risk_score,
            decision=decision,
            requires_sar=sar_needed,
        )
        return result

    async def run_monitoring_cycle(self) -> None:
        """
        Cron job: fetch transactions from the last 5 minutes from the payment
        engine and evaluate any not yet seen.
        """
        logger.info("monitoring.cycle.start")
        try:
            recent = await self._fetch_recent_transactions(minutes=5)
            new_txns = [t for t in recent if t.get("id") not in self._evaluated_ids]
            logger.info("monitoring.cycle.new_transactions", count=len(new_txns))
            for txn in new_txns:
                try:
                    await self.evaluate_transaction(txn)
                except Exception as exc:
                    logger.exception(
                        "monitoring.cycle.eval_error",
                        transaction_id=txn.get("id"),
                        error=str(exc),
                    )
        except Exception as exc:
            logger.exception("monitoring.cycle.error", error=str(exc))
        logger.info("monitoring.cycle.done")

    def get_alerts(
        self, merchant_id: str | None = None
    ) -> list[TransactionMonitoringResult]:
        """Return active monitoring alerts, optionally filtered by merchant."""
        if merchant_id:
            return list(self._alerts.get(merchant_id, []))
        return [r for results in self._alerts.values() for r in results]

    def list_rules(self) -> list[dict[str, Any]]:
        return [
            {
                "rule_id": r.rule_id,
                "rule_name": r.rule_name,
                "category": r.category,
                "severity": r.severity,
                "enabled": r.enabled,
            }
            for r in self._rules
        ]

    def toggle_rule(self, rule_id: str, enabled: bool) -> bool:
        """Enable or disable a rule by its rule_id.  Returns True if found."""
        for rule in self._rules:
            if rule.rule_id == rule_id:
                rule.enabled = enabled
                logger.info(
                    "monitoring.rule_toggled",
                    rule_id=rule_id,
                    enabled=enabled,
                )
                return True
        return False

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    async def _fetch_history(self, merchant_id: str) -> list[dict[str, Any]]:
        """
        Fetch the last 90 days of transaction history for a merchant from
        the payment engine (Hyperswitch REST API).
        """
        if not merchant_id:
            return []
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(
                    f"{self._payment_engine_url}/v1/payments",
                    params={
                        "merchant_id": merchant_id,
                        "limit": 1000,
                        "created_gte": _days_ago_iso(90),
                    },
                )
                if resp.is_success:
                    data = resp.json()
                    # Hyperswitch returns {"data": [...], "total_count": N}
                    txns = data if isinstance(data, list) else data.get("data", [])
                    return _normalise_txns(txns)
        except Exception as exc:
            logger.warning("monitoring.history_fetch_failed", merchant_id=merchant_id, error=str(exc))
        return []

    async def _fetch_recent_transactions(self, minutes: int = 5) -> list[dict[str, Any]]:
        """Fetch transactions created in the last `minutes` minutes across all merchants."""
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(
                    f"{self._payment_engine_url}/v1/payments",
                    params={
                        "limit": 500,
                        "created_gte": _minutes_ago_iso(minutes),
                    },
                )
                if resp.is_success:
                    data = resp.json()
                    txns = data if isinstance(data, list) else data.get("data", [])
                    return _normalise_txns(txns)
        except Exception as exc:
            logger.warning("monitoring.recent_fetch_failed", error=str(exc))
        return []


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _days_ago_iso(days: int) -> str:
    from datetime import timedelta

    dt = datetime.now(timezone.utc) - timedelta(days=days)
    return dt.isoformat()


def _minutes_ago_iso(minutes: int) -> str:
    from datetime import timedelta

    dt = datetime.now(timezone.utc) - timedelta(minutes=minutes)
    return dt.isoformat()


def _normalise_txns(raw: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    Ensure every transaction dict has the keys expected by the rule engine.

    Hyperswitch uses amount in minor units (cents); convert to USD float.
    """
    out: list[dict[str, Any]] = []
    for t in raw:
        try:
            # Hyperswitch stores amounts as integers in minor currency units
            raw_amount = t.get("amount", 0)
            currency = (t.get("currency") or "USD").upper()
            # Approximate: divide by 100 for all currencies (real impl: use fx rates)
            amount_usd = float(raw_amount) / 100.0

            out.append(
                {
                    "id": t.get("payment_id") or t.get("id", ""),
                    "merchant_id": t.get("merchant_id", ""),
                    "amount": float(raw_amount) / 100.0,
                    "amount_usd": amount_usd,
                    "currency": currency,
                    "payment_method": _map_payment_method(t),
                    "payer_country": t.get("billing", {}).get("address", {}).get("country", ""),
                    "payer_ip_country": t.get("browser_info", {}).get("ip_country", ""),
                    "created_at": t.get("created") or t.get("created_at", ""),
                    "metadata": t.get("metadata", {}),
                }
            )
        except Exception:
            pass
    return out


def _map_payment_method(t: dict[str, Any]) -> str:
    pm = (t.get("payment_method") or "").lower()
    if pm == "bank_transfer":
        return "bank"
    if pm in ("card", "credit_card", "debit_card"):
        return "card"
    if pm in ("crypto", "wallet") or "crypto" in pm:
        return "crypto"
    return pm or "card"
