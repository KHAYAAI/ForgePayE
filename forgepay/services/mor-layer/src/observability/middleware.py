"""
Starlette middleware for Prometheus metrics collection.

Tracks:
  - Request start time
  - HTTP metrics on response
  - Request path (not full URL to prevent cardinality explosion)
"""

from __future__ import annotations

import time
from typing import Awaitable, Callable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from src.observability.metrics import http_request_duration_seconds, http_requests_total


class PrometheusMiddleware(BaseHTTPMiddleware):
    """Middleware to track HTTP request metrics."""

    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        """
        Process request and record metrics.

        Args:
            request: The incoming HTTP request.
            call_next: The next middleware or route handler.

        Returns:
            The HTTP response.
        """
        # Record start time
        start_time: float = time.time()

        # Extract method and path (not full URL to avoid cardinality explosion)
        method: str = request.method
        path: str = request.url.path

        # Skip metrics endpoint to avoid recursion
        if path == "/metrics":
            return await call_next(request)

        # Call next middleware/handler
        response: Response = await call_next(request)

        # Calculate elapsed time
        elapsed_time: float = time.time() - start_time
        status_code: str = str(response.status_code)

        # Record metrics
        http_request_duration_seconds.labels(
            method=method,
            path=path,
            status_code=status_code,
        ).observe(elapsed_time)

        http_requests_total.labels(
            method=method,
            path=path,
            status_code=status_code,
        ).inc()

        return response
