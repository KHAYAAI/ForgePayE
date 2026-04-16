"""ForgePay SDK exception hierarchy."""

from __future__ import annotations


class ForgePayError(Exception):
    """Base class for all ForgePay SDK errors."""

    def __init__(self, message: str, *, status_code: int | None = None, body: object = None) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.body        = body

    def __repr__(self) -> str:
        return f"{type(self).__name__}(message={self!s!r}, status_code={self.status_code})"


class AuthenticationError(ForgePayError):
    """API key is missing, invalid, or revoked (HTTP 401 / 403)."""


class InvalidRequestError(ForgePayError):
    """The request payload was malformed or contained invalid parameters (HTTP 400 / 422)."""


class NotFoundError(ForgePayError):
    """The requested resource does not exist (HTTP 404)."""


class RateLimitError(ForgePayError):
    """Too many requests — back off and retry (HTTP 429)."""


class ServiceUnavailableError(ForgePayError):
    """The ForgePay API is temporarily unavailable (HTTP 5xx)."""


class WebhookSignatureError(ForgePayError):
    """Webhook signature verification failed."""


def raise_for_status(status_code: int, body: object, message: str | None = None) -> None:
    """Map HTTP status codes to typed SDK exceptions."""
    msg = message or f"HTTP {status_code}"
    if status_code in (401, 403):
        raise AuthenticationError(msg, status_code=status_code, body=body)
    if status_code == 404:
        raise NotFoundError(msg, status_code=status_code, body=body)
    if status_code == 422:
        raise InvalidRequestError(msg, status_code=status_code, body=body)
    if status_code == 429:
        raise RateLimitError(msg, status_code=status_code, body=body)
    if status_code >= 500:
        raise ServiceUnavailableError(msg, status_code=status_code, body=body)
    raise ForgePayError(msg, status_code=status_code, body=body)
