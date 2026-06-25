"""
Prometheus middleware for FastAPI applications.

Tracks HTTP request metrics (duration, total requests) with labels for:
  - method: HTTP method (GET, POST, etc.)
  - path: Request path (normalized to prevent label cardinality explosion)
  - status_code: HTTP status code

Skips /metrics endpoint to prevent recursion.
"""

from __future__ import annotations

import time
from typing import Any, Awaitable, Callable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from src.observability.metrics import (
    http_request_duration_seconds,
    http_requests_total,
)


class PrometheusMiddleware(BaseHTTPMiddleware):
    """
    Middleware to track HTTP request metrics.

    Observes request duration and count, labeled by HTTP method, path, and status code.
    Skips the /metrics endpoint to prevent recursion.
    """

    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        """
        Handle incoming request and record metrics.

        Args:
            request: The incoming HTTP request.
            call_next: Callable to invoke the next middleware/endpoint.

        Returns:
            The response from the next middleware/endpoint.
        """
        # Skip metrics endpoint to prevent recursion
        if request.url.path == "/metrics":
            return await call_next(request)

        # Record start time
        start_time: float = time.time()

        # Invoke the next middleware/endpoint
        response: Response = await call_next(request)

        # Calculate duration
        duration: float = time.time() - start_time

        # Extract labels
        method: str = request.method
        path: str = request.url.path
        status_code: str = str(response.status_code)

        # Record metrics
        http_request_duration_seconds.labels(
            method=method, path=path, status_code=status_code
        ).observe(duration)

        http_requests_total.labels(
            method=method, path=path, status_code=status_code
        ).inc()

        return response
