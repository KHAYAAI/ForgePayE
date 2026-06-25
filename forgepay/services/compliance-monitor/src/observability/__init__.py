"""
Observability package for ForgePay Compliance Monitor.
Exports metrics and middleware for Prometheus monitoring and structured logging.
"""

from __future__ import annotations

from src.observability.metrics import (
    aml_screening_duration_seconds,
    audit_check_duration_seconds,
    compliance_violations_total,
    http_request_duration_seconds,
    http_requests_total,
    prometheus_registry,
)
from src.observability.middleware import PrometheusMiddleware

__all__ = [
    "prometheus_registry",
    "http_request_duration_seconds",
    "http_requests_total",
    "audit_check_duration_seconds",
    "compliance_violations_total",
    "aml_screening_duration_seconds",
    "PrometheusMiddleware",
]
