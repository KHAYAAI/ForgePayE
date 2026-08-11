"""
Rate limiting helpers for Compliance Monitor.

Provides utility functions for per-endpoint rate limits via slowapi.
"""

import limits
from fastapi import Request
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from slowapi.wrappers import Limit


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

    `slowapi.Limiter` has no `.hit()` method — that call was always an
    `AttributeError`, 500ing every route that called this (every screening
    call, since screen_entity/screen_address both do). The actual counter
    lives on `limiter.limiter`, the underlying `limits` library object, whose
    `.hit()` takes a parsed `RateLimitItem` plus a per-caller identifier
    (without one, every caller shares one global bucket) and returns `False`
    on exceeding the limit rather than raising — this raises the same
    `RateLimitExceeded` the registered exception handler already expects.
    """
    limiter = request.app.state.limiter
    item = limits.parse(limit_string)
    identifier = get_remote_address(request)
    if not limiter.limiter.hit(item, identifier):
        raise RateLimitExceeded(
            Limit(
                limit=item,
                key_func=get_remote_address,
                scope=None,
                per_method=False,
                methods=None,
                error_message=None,
                exempt_when=None,
                cost=1,
                override_defaults=False,
            )
        )
