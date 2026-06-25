"""
Rate limiting helpers for Compliance Monitor.

Provides utility functions for per-endpoint rate limits via slowapi.
"""

from fastapi import Request
from slowapi.errors import RateLimitExceeded


def check_rate_limit(request: Request, limit_string: str) -> None:
    """
    Check rate limit for the current request.

    Usage in endpoint:
        @router.post("/endpoint")
        async def my_endpoint(request: Request):
            check_rate_limit(request, "10/minute")
            # ... rest of endpoint

    Args:
        request: FastAPI request object
        limit_string: Rate limit string (e.g., "100/minute", "30/hour")

    Raises:
        RateLimitExceeded: If the limit is exceeded
    """
    limiter = request.app.state.limiter
    try:
        limiter.hit(limit_string)
    except RateLimitExceeded:
        raise
