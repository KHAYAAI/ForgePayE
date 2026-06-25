"""
Prometheus metrics for ForgePay Liquidity Forecaster.

Provides:
  - Standard HTTP metrics (request duration, request count)
  - Forecasting-specific metrics (generation duration, accuracy, predictions)
"""

from __future__ import annotations

from prometheus_client import Counter, Gauge, Histogram, REGISTRY, CollectorRegistry

# ──────────────────────────────────────────────────────────────────────────────
# Registry
# ──────────────────────────────────────────────────────────────────────────────

prometheus_registry: CollectorRegistry = REGISTRY

# ──────────────────────────────────────────────────────────────────────────────
# HTTP Metrics (standard across all services)
# ──────────────────────────────────────────────────────────────────────────────

http_request_duration_seconds: Histogram = Histogram(
    "http_request_duration_seconds",
    "HTTP request duration in seconds",
    labelnames=["method", "path", "status_code"],
    registry=prometheus_registry,
)

http_requests_total: Counter = Counter(
    "http_requests_total",
    "Total HTTP requests",
    labelnames=["method", "path", "status_code"],
    registry=prometheus_registry,
)

# ──────────────────────────────────────────────────────────────────────────────
# Liquidity Forecaster Metrics
# ──────────────────────────────────────────────────────────────────────────────

forecast_generation_duration_seconds: Histogram = Histogram(
    "forecast_generation_duration_seconds",
    "Forecast generation operation duration in seconds",
    labelnames=["horizon"],
    registry=prometheus_registry,
)

forecast_accuracy_total: Counter = Counter(
    "forecast_accuracy_total",
    "Total forecast accuracy measurements (MAPE scores)",
    labelnames=["model_type"],
    registry=prometheus_registry,
)

liquidity_predictions_total: Counter = Counter(
    "liquidity_predictions_total",
    "Total liquidity predictions generated",
    labelnames=["horizon"],
    registry=prometheus_registry,
)
