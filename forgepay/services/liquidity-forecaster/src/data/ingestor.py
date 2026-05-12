"""
Payment Data Ingestor for the Liquidity Forecaster.

Fetches raw payment records from the Hyperswitch payment engine and the Kill
Bill billing engine, then normalises them into a daily cash-flow DataFrame
suitable for time-series modelling.

Cash-flow definitions
─────────────────────
  inflow  — gross amount of every successful (captured) payment
  outflow — refund amounts + chargeback amounts + ForgePay processing fees
  net     — inflow − outflow
  balance — cumulative net from the earliest record

Payment engine contract (Hyperswitch REST API):
  GET /api/payments?merchant_id=<id>&limit=<n>&created_after=<iso-date>
  Response body: { "data": [ <PaymentRecord>, ... ] }

  PaymentRecord fields used:
    amount           — integer cents
    currency         — "USD" | "EUR" | …
    status           — "succeeded" | "failed" | "refunded" | "charged_back" | …
    created_at       — ISO-8601 datetime string
    refund_amount    — integer cents (may be absent / null)
    chargeback_amount— integer cents (may be absent / null)
    fee_amount       — integer cents (ForgePay processing fee; may be absent / null)

Billing engine contract (Kill Bill REST API):
  GET /1.0/kb/subscriptions?merchant_id=<id>
  Response body: list of subscription objects with `next_billing_date` and
  `amount` fields.  These are treated as future scheduled outflows.

All amounts are converted from integer cents to decimal USD.
"""

from __future__ import annotations

import asyncio
from datetime import UTC, date, datetime, timedelta
from typing import Any

import httpx
import pandas as pd
import structlog
from tenacity import retry, stop_after_attempt, wait_exponential

from src.config import get_settings
from src.models import CashFlowDataPoint, IngestStatus

log = structlog.get_logger(__name__)

# In-memory ingest status store  {merchant_id: IngestStatus}
# Production: replace with PostgreSQL / Redis.
_ingest_status: dict[str, IngestStatus] = {}

# In-memory cashflow cache  {merchant_id: pd.DataFrame}
_cashflow_cache: dict[str, pd.DataFrame] = {}

# How many cents per dollar
_CENTS = 100.0

# ForgePay processing fee rate when not explicitly provided by the engine
_DEFAULT_FEE_RATE = 0.029  # 2.9 %


def _cents_to_usd(cents: int | float | None) -> float:
    if cents is None:
        return 0.0
    return float(cents) / _CENTS


def _parse_date(dt_str: str) -> date:
    """Parse ISO-8601 datetime or date string → Python date."""
    return datetime.fromisoformat(dt_str.replace("Z", "+00:00")).date()


class PaymentDataIngestor:
    """
    Fetches, normalises, and caches payment history for a single merchant.
    All network calls are async; use ``await`` when calling public methods.
    """

    def __init__(self) -> None:
        self._cfg = get_settings()

    # ── Public API ────────────────────────────────────────────────────────────

    async def get_historical_cashflow(
        self,
        merchant_id: str,
        days_back: int = 365,
    ) -> pd.DataFrame:
        """
        Return a DataFrame with columns:
            date (pd.Timestamp), inflow, outflow, net, balance (all float).

        If cached data is fresh (from a previous ingest in this process run),
        returns the cached DataFrame; otherwise fetches from upstream.
        """
        if merchant_id not in _cashflow_cache:
            await self._refresh(merchant_id, days_back)
        df = _cashflow_cache.get(merchant_id, pd.DataFrame())
        if df.empty:
            return df
        # Filter to requested window
        cutoff = pd.Timestamp.now(tz="UTC").normalize() - pd.Timedelta(days=days_back)
        mask = df["date"] >= cutoff
        return df.loc[mask].copy()

    async def refresh_merchant(self, merchant_id: str, days_back: int = 365) -> IngestStatus:
        """Force a full re-fetch from upstream and update the ingest status."""
        await self._refresh(merchant_id, days_back)
        return _ingest_status[merchant_id]

    def get_ingest_status(self, merchant_id: str) -> IngestStatus:
        """Return the last-known ingest metadata (never raises)."""
        return _ingest_status.get(
            merchant_id,
            IngestStatus(merchant_id=merchant_id, last_ingested_at=None, row_count=0),
        )

    # ── Internal helpers ──────────────────────────────────────────────────────

    async def _refresh(self, merchant_id: str, days_back: int) -> None:
        raw = await self.fetch_payment_history(merchant_id, days_back)
        points = self.normalize_to_cashflow(raw)
        df = self._points_to_dataframe(points)
        _cashflow_cache[merchant_id] = df
        _ingest_status[merchant_id] = IngestStatus(
            merchant_id=merchant_id,
            last_ingested_at=datetime.now(UTC).isoformat(),
            row_count=len(df),
        )
        log.info(
            "ingest_complete",
            merchant_id=merchant_id,
            rows=len(df),
            days_back=days_back,
        )

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=1, max=10),
        reraise=True,
    )
    async def fetch_payment_history(
        self,
        merchant_id: str,
        days_back: int = 365,
    ) -> list[dict[str, Any]]:
        """
        Fetch up to 5 000 payment records from the Hyperswitch payment engine.
        Returns the raw list of payment record dicts.
        """
        since = (datetime.now(UTC) - timedelta(days=days_back)).date().isoformat()
        url = f"{self._cfg.payment_engine_url}/api/payments"
        params = {
            "merchant_id": merchant_id,
            "limit": 5000,
            "created_after": since,
        }
        async with httpx.AsyncClient(timeout=30.0) as client:
            try:
                resp = await client.get(url, params=params)
                resp.raise_for_status()
                body = resp.json()
                records: list[dict[str, Any]] = body.get("data", body) if isinstance(body, dict) else body
                log.info(
                    "fetched_payments",
                    merchant_id=merchant_id,
                    count=len(records),
                )
                return records
            except httpx.HTTPStatusError as exc:
                log.error(
                    "payment_engine_http_error",
                    status=exc.response.status_code,
                    merchant_id=merchant_id,
                )
                raise
            except httpx.RequestError as exc:
                log.error(
                    "payment_engine_connection_error",
                    error=str(exc),
                    merchant_id=merchant_id,
                )
                raise

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=1, max=10),
        reraise=True,
    )
    async def fetch_subscription_schedule(
        self,
        merchant_id: str,
    ) -> list[dict[str, Any]]:
        """
        Fetch upcoming recurring charges from Kill Bill billing engine.
        Returns a list of subscription objects with at least:
          { "next_billing_date": "2026-06-01", "amount": 4999 }
        """
        url = f"{self._cfg.billing_engine_url}/1.0/kb/subscriptions"
        params = {"merchant_id": merchant_id}
        async with httpx.AsyncClient(timeout=15.0) as client:
            try:
                resp = await client.get(url, params=params)
                resp.raise_for_status()
                body = resp.json()
                subscriptions: list[dict[str, Any]] = body if isinstance(body, list) else body.get("data", [])
                log.info(
                    "fetched_subscriptions",
                    merchant_id=merchant_id,
                    count=len(subscriptions),
                )
                return subscriptions
            except httpx.HTTPStatusError as exc:
                log.warning(
                    "billing_engine_http_error",
                    status=exc.response.status_code,
                    merchant_id=merchant_id,
                )
                return []
            except httpx.RequestError as exc:
                log.warning(
                    "billing_engine_connection_error",
                    error=str(exc),
                    merchant_id=merchant_id,
                )
                return []

    def normalize_to_cashflow(
        self, raw_payments: list[dict[str, Any]]
    ) -> list[CashFlowDataPoint]:
        """
        Convert a list of raw payment records (from the payment engine) into
        daily CashFlowDataPoint objects.

        Rules:
          * inflow  = sum of ``amount`` for status == "succeeded"
          * outflow = sum of (refund_amount + chargeback_amount + fee_amount)
                      across all records on that day, where missing amounts
                      are 0 and fee_amount falls back to amount * DEFAULT_FEE_RATE
                      for succeeded payments without an explicit fee.
        """
        # Bucket by date
        daily: dict[date, dict[str, float]] = {}

        for record in raw_payments:
            try:
                day = _parse_date(record["created_at"])
            except (KeyError, ValueError):
                continue

            if day not in daily:
                daily[day] = {"inflow": 0.0, "outflow": 0.0}

            status = record.get("status", "")
            amount_usd = _cents_to_usd(record.get("amount", 0))
            refund_usd = _cents_to_usd(record.get("refund_amount"))
            chargeback_usd = _cents_to_usd(record.get("chargeback_amount"))

            # Fee: use explicit value from engine, else estimate for succeeded txns
            if "fee_amount" in record and record["fee_amount"] is not None:
                fee_usd = _cents_to_usd(record["fee_amount"])
            elif status == "succeeded":
                fee_usd = amount_usd * _DEFAULT_FEE_RATE
            else:
                fee_usd = 0.0

            if status == "succeeded":
                daily[day]["inflow"] += amount_usd

            daily[day]["outflow"] += refund_usd + chargeback_usd + fee_usd

        # Build sorted list
        points: list[CashFlowDataPoint] = []
        for day in sorted(daily):
            inflow = daily[day]["inflow"]
            outflow = daily[day]["outflow"]
            points.append(
                CashFlowDataPoint(
                    date=day.isoformat(),
                    inflow=round(inflow, 2),
                    outflow=round(outflow, 2),
                    net=round(inflow - outflow, 2),
                )
            )
        return points

    @staticmethod
    def _points_to_dataframe(points: list[CashFlowDataPoint]) -> pd.DataFrame:
        """Convert CashFlowDataPoint list → tidy DataFrame with a running balance."""
        if not points:
            return pd.DataFrame(columns=["date", "inflow", "outflow", "net", "balance"])

        rows = [
            {
                "date": pd.Timestamp(p.date, tz="UTC"),
                "inflow": p.inflow,
                "outflow": p.outflow,
                "net": p.net,
            }
            for p in points
        ]
        df = pd.DataFrame(rows).sort_values("date").reset_index(drop=True)
        df["balance"] = df["net"].cumsum()
        return df


# ── Module-level singleton ─────────────────────────────────────────────────────

_ingestor: PaymentDataIngestor | None = None


def get_ingestor() -> PaymentDataIngestor:
    global _ingestor
    if _ingestor is None:
        _ingestor = PaymentDataIngestor()
    return _ingestor


async def poll_all_merchants(merchant_ids: list[str]) -> None:
    """
    Background task: refresh payment data for every known merchant.
    Called by the lifespan poll loop every ``BACKGROUND_POLL_INTERVAL_HOURS``.
    """
    ingestor = get_ingestor()
    tasks = [ingestor.refresh_merchant(mid) for mid in merchant_ids]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    for mid, result in zip(merchant_ids, results):
        if isinstance(result, Exception):
            log.error("background_poll_failed", merchant_id=mid, error=str(result))
