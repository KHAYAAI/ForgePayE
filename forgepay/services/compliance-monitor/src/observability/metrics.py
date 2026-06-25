"""
Prometheus metrics for ForgePay Compliance Monitor.

Provides:
  - Standard HTTP metrics (request duration, request count)
  - Compliance-specific metrics (audit checks, violations, AML screening)
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
# Compliance Monitor Metrics
# ──────────────────────────────────────────────────────────────────────────────

audit_check_duration_seconds: Histogram = Histogram(
    "audit_check_duration_seconds",
    "Audit check operation duration in seconds",
    labelnames=["check_type"],
    registry=prometheus_registry,
)

compliance_violations_total: Counter = Counter(
    "compliance_violations_total",
    "Total compliance violations detected",
    labelnames=["violation_type"],
    registry=prometheus_registry,
)

aml_screening_duration_seconds: Histogram = Histogram(
    "aml_screening_duration_seconds",
    "AML screening operation duration in seconds",
    labelnames=["screening_type"],
    registry=prometheus_registry,
)
