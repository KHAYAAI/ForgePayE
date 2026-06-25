"""
Prometheus metrics for MoR Layer.

Exports:
  - HTTP request duration and count
  - Checkout operation metrics
  - Webhook processing metrics
"""

from __future__ import annotations

from prometheus_client import (
    REGISTRY,
    Counter,
    Histogram,
    CollectorRegistry,
)

# Use the default registry
_REGISTRY: CollectorRegistry = REGISTRY

# HTTP metrics
http_request_duration_seconds = Histogram(
    name="http_request_duration_seconds",
    documentation="HTTP request duration in seconds",
    labelnames=["method", "path", "status_code"],
    buckets=[0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5],
    registry=_REGISTRY,
)

http_requests_total = Counter(
    name="http_requests_total",
    documentation="Total HTTP requests",
    labelnames=["method", "path", "status_code"],
    registry=_REGISTRY,
)

# Checkout metrics
checkout_duration_seconds = Histogram(
    name="checkout_duration_seconds",
    documentation="Checkout session creation duration in seconds",
    labelnames=["type", "status"],
    buckets=[0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10],
    registry=_REGISTRY,
)

checkout_errors_total = Counter(
    name="checkout_errors_total",
    documentation="Total checkout errors",
    labelnames=["type", "error_reason"],
    registry=_REGISTRY,
)

# Webhook metrics
webhook_processing_duration_seconds = Histogram(
    name="webhook_processing_duration_seconds",
    documentation="Webhook processing duration in seconds",
    labelnames=["event_type", "status"],
    buckets=[0.01, 0.05, 0.1, 0.5, 1, 2, 5],
    registry=_REGISTRY,
)

webhook_errors_total = Counter(
    name="webhook_errors_total",
    documentation="Total webhook processing errors",
    labelnames=["event_type", "error_reason"],
    registry=_REGISTRY,
)


def get_registry() -> CollectorRegistry:
    """Get the Prometheus registry."""
    return _REGISTRY
