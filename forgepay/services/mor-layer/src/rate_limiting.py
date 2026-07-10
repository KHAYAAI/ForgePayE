"""
Rate limiting helpers for MoR Layer.

Provides utility functions for per-endpoint rate limits via slowapi.
"""

from fastapi import Request
from limits import parse
from slowapi.errors import RateLimitExceeded
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
    """
    limiter = request.app.state.limiter
    item = parse(limit_string)
    limit_key = limiter._key_func(request)
    limit_scope = request.url.path

    # NOTE: slowapi's Limiter does not expose a `.hit(limit_string)` method —
    # that API belongs to Flask-Limiter. slowapi wraps the `limits` package;
    # the underlying rate limiter's `hit()` takes a parsed RateLimitItem plus
    # identifier(s), and returns True/False rather than raising. This mirrors
    # what slowapi's own request middleware does internally
    # (see slowapi.extension.Limiter.__evaluate_limits).
    if not limiter.limiter.hit(item, limit_key, limit_scope):
        limit = Limit(
            limit=item,
            key_func=limiter._key_func,
            scope=limit_scope,
            per_method=False,
            methods=None,
            error_message=None,
            exempt_when=None,
            cost=1,
            override_defaults=False,
        )
        raise RateLimitExceeded(limit)
