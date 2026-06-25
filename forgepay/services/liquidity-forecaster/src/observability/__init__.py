"""
Observability package for ForgePay Liquidity Forecaster.
Exports metrics and middleware for Prometheus monitoring and structured logging.
"""

from __future__ import annotations

from src.observability.metrics import (
    forecast_accuracy_total,
    forecast_generation_duration_seconds,
    http_request_duration_seconds,
    http_requests_total,
    liquidity_predictions_total,
    prometheus_registry,
)
from src.observability.middleware import PrometheusMiddleware

__all__ = [
    "prometheus_registry",
    "http_request_duration_seconds",
    "http_requests_total",
    "forecast_generation_duration_seconds",
    "forecast_accuracy_total",
    "liquidity_predictions_total",
    "PrometheusMiddleware",
]
