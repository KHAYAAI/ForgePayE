"""
Shared HTTP transport layer for both sync (httpx.Client) and async (httpx.AsyncClient).

Handles:
- API key injection
- Idempotency key header
- Automatic retry on 429 / 5xx (up to 3 attempts, exponential back-off)
- Typed error mapping via `errors.raise_for_status`
"""

from __future__ import annotations

import time
from typing import Any

import httpx

from forgepay.errors import raise_for_status

DEFAULT_BASE_URL   = "https://api.forgepay.io"
DEFAULT_TIMEOUT    = 30.0   # seconds
MAX_RETRIES        = 3
_RETRY_STATUS      = {429, 500, 502, 503, 504}
_BACKOFF_SECONDS   = [1.0, 2.0, 4.0]


def _build_headers(
    api_key:         str,
    idempotency_key: str | None = None,
    extra:           dict[str, str] | None = None,
) -> dict[str, str]:
    headers: dict[str, str] = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type":  "application/json",
        "User-Agent":    "forgepay-python/0.1.0",
        "ForgePay-Version": "2026-04",
    }
    if idempotency_key:
        headers["Idempotency-Key"] = idempotency_key
    if extra:
        headers.update(extra)
    return headers


def _extract_message(body: Any) -> str | None:
    if isinstance(body, dict):
        err = body.get("error")
        if isinstance(err, dict):
            return str(err.get("message", ""))
        return str(body.get("message", "")) or None
    return None


# ── Sync ──────────────────────────────────────────────────────────────────────

class SyncTransport:
    def __init__(self, api_key: str, base_url: str, timeout: float) -> None:
        self._api_key  = api_key
        self._base_url = base_url.rstrip("/")
        self._client   = httpx.Client(timeout=timeout)

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> "SyncTransport":
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def request(
        self,
        method:          str,
        path:            str,
        *,
        params:          dict[str, Any] | None = None,
        json:            dict[str, Any] | None = None,
        idempotency_key: str | None = None,
    ) -> Any:
        url     = f"{self._base_url}{path}"
        headers = _build_headers(self._api_key, idempotency_key)

        for attempt in range(MAX_RETRIES):
            res = self._client.request(method, url, headers=headers, params=params, json=json)
            if res.status_code not in _RETRY_STATUS or attempt == MAX_RETRIES - 1:
                break
            time.sleep(_BACKOFF_SECONDS[attempt])

        if res.status_code == 204:
            return None

        body: Any = None
        try:
            body = res.json()
        except Exception:
            body = res.text

        if not res.is_success:
            raise_for_status(res.status_code, body, _extract_message(body))

        return body


# ── Async ─────────────────────────────────────────────────────────────────────

class AsyncTransport:
    def __init__(self, api_key: str, base_url: str, timeout: float) -> None:
        self._api_key  = api_key
        self._base_url = base_url.rstrip("/")
        self._client   = httpx.AsyncClient(timeout=timeout)

    async def aclose(self) -> None:
        await self._client.aclose()

    async def __aenter__(self) -> "AsyncTransport":
        return self

    async def __aexit__(self, *_: object) -> None:
        await self.aclose()

    async def request(
        self,
        method:          str,
        path:            str,
        *,
        params:          dict[str, Any] | None = None,
        json:            dict[str, Any] | None = None,
        idempotency_key: str | None = None,
    ) -> Any:
        import asyncio

        url     = f"{self._base_url}{path}"
        headers = _build_headers(self._api_key, idempotency_key)

        for attempt in range(MAX_RETRIES):
            res = await self._client.request(method, url, headers=headers, params=params, json=json)
            if res.status_code not in _RETRY_STATUS or attempt == MAX_RETRIES - 1:
                break
            await asyncio.sleep(_BACKOFF_SECONDS[attempt])

        if res.status_code == 204:
            return None

        body: Any = None
        try:
            body = res.json()
        except Exception:
            body = res.text

        if not res.is_success:
            raise_for_status(res.status_code, body, _extract_message(body))

        return body
