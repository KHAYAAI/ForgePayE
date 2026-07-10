"""
ForgePay Liquidity Forecaster Service
──────────────────────────────────────────────────────────────────────────────
Role:
  Provides 7/30/90-day cash-flow forecasts, runway calculations, and
  real-time liquidity alerts for ForgePay merchants.

Data sources:
  payment-engine     :8080  — Hyperswitch (card payments, refunds, chargebacks)
  billing-engine     :8003  — Kill Bill (subscriptions, recurring billing)
  stablecoin-gateway :3002  — USDC/USDT settlement
  crypto-gateway     :3001  — On-chain payment receipts

Forecasting stack:
  ARIMA (auto p/d/q via AIC) + Holt-Winters Exponential Smoothing, combined
  as a weighted Ensemble by inverse-MAPE on a 30-day hold-out validation set.

Auth:
  JWT Bearer token (HS256) validated on every protected endpoint.
  Tokens must contain a ``sub`` claim equal to the merchant_id path parameter.

Background task:
  Every ``BACKGROUND_POLL_INTERVAL_HOURS`` (default 6) hours the service
  refreshes cached payment data for all merchants that have been seen since
  startup.  This keeps forecasts warm without waiting for user requests.

Ports:
  HTTP  :8002  (primary)
  Docs  :8002/docs  (disabled in production)
"""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from typing import AsyncGenerator

import structlog
from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest
from slowapi import Limiter
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from src.config import get_settings
from src.data.ingestor import _ingest_status, get_ingestor
from src.observability.metrics import prometheus_registry
from src.observability.middleware import PrometheusMiddleware
from src.routers import alerts, forecasts, ingest, runway

# ── Structured logging ────────────────────────────────────────────────────────

structlog.configure(
    processors=[
        structlog.stdlib.filter_by_level,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.stdlib.PositionalArgumentsFormatter(),
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
        structlog.processors.JSONRenderer(),
    ],
    wrapper_class=structlog.stdlib.BoundLogger,
    context_class=dict,
    logger_factory=structlog.stdlib.LoggerFactory(),
)

settings = get_settings()
logging.basicConfig(level=settings.log_level.upper())
log = structlog.get_logger(__name__)

# Rate limiter setup
limiter = Limiter(key_func=get_remote_address)

# Rate limit handler
async def _rate_limit_handler(request: Request, exc: RateLimitExceeded) -> JSONResponse:
    log.warning("rate_limit_exceeded", path=request.url.path, remote=get_remote_address(request))
    return JSONResponse(
        status_code=429,
        content={"detail": "Rate limit exceeded. Please retry after a delay."},
    )


# ── Background poll task ───────────────────────────────────────────────────────

_poll_task: asyncio.Task | None = None


async def _background_poll_loop() -> None:
    """
    Periodically refresh payment data for every merchant seen since startup.
    Runs every ``background_poll_interval_hours`` hours.
    """
    interval_seconds = settings.background_poll_interval_hours * 3600
    log.info(
        "background_poll_started",
        interval_hours=settings.background_poll_interval_hours,
    )
    while True:
        await asyncio.sleep(interval_seconds)
        merchant_ids = list(_ingest_status.keys())
        if not merchant_ids:
            log.debug("background_poll_no_merchants")
            continue

        log.info("background_poll_running", merchant_count=len(merchant_ids))
        ingestor = get_ingestor()
        results = await asyncio.gather(
            *[ingestor.refresh_merchant(mid) for mid in merchant_ids],
            return_exceptions=True,
        )
        for mid, result in zip(merchant_ids, results):
            if isinstance(result, Exception):
                log.error("background_poll_failed", merchant_id=mid, error=str(result))
            else:
                log.debug("background_poll_merchant_ok", merchant_id=mid)


# ── Lifespan ──────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    global _poll_task
    log.info(
        "service_starting",
        service="liquidity-forecaster",
        port=settings.port,
        environment=settings.environment,
    )
    _poll_task = asyncio.create_task(_background_poll_loop())
    try:
        yield
    finally:
        if _poll_task and not _poll_task.done():
            _poll_task.cancel()
            try:
                await _poll_task
            except asyncio.CancelledError:
                pass
        log.info("service_stopped", service="liquidity-forecaster")


# ── Application factory ───────────────────────────────────────────────────────

app = FastAPI(
    title="ForgePay Liquidity Forecaster",
    description=(
        "Cash-flow forecasting, runway calculator, and liquidity alerts "
        "for ForgePay merchants."
    ),
    version="0.1.0",
    lifespan=lifespan,
    docs_url="/docs"         if settings.environment != "production" else None,
    redoc_url="/redoc"       if settings.environment != "production" else None,
    openapi_url="/openapi.json" if settings.environment != "production" else None,
)

# Attach rate limiter to app state
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_handler)

# ── CORS ──────────────────────────────────────────────────────────────────────

cors_origins = settings.get_cors_origins()
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins if settings.environment != "development" else ["*"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
)

app.add_middleware(PrometheusMiddleware)

# ── Routers ───────────────────────────────────────────────────────────────────

app.include_router(forecasts.router)
app.include_router(runway.router)
app.include_router(alerts.router)
app.include_router(ingest.router)

# ── Exception handlers ────────────────────────────────────────────────────────

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    log.warning(
        "request_validation_error",
        path=request.url.path,
        errors=exc.errors(),
    )
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={
            "detail": exc.errors(),
            "message": "Request validation failed",
        },
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(
    request: Request, exc: Exception
) -> JSONResponse:
    log.error(
        "unhandled_exception",
        path=request.url.path,
        error=str(exc),
        exc_info=True,
    )
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": "Internal server error"},
    )


# ── Metrics endpoint ──────────────────────────────────────────────────────────

@app.get("/metrics", include_in_schema=False)
async def metrics() -> Response:
    """Prometheus scrape endpoint — text-exposition format."""
    return Response(content=generate_latest(prometheus_registry), media_type=CONTENT_TYPE_LATEST)


# ── Health endpoints ──────────────────────────────────────────────────────────

@app.get("/health", include_in_schema=False)
async def health() -> dict:
    """Liveness probe — always returns 200 if the process is alive."""
    return {"status": "ok", "service": "liquidity-forecaster", "version": "0.1.0"}


@app.get("/healthz", include_in_schema=False)
async def healthz() -> dict:
    """Alias for /health — compatible with both k8s naming conventions."""
    return {"status": "ok", "service": "liquidity-forecaster"}


@app.get("/readyz", include_in_schema=False)
async def readyz() -> JSONResponse:
    """
    Readiness probe — checks upstream service reachability.
    Returns 503 if the payment engine cannot be reached.
    """
    import httpx

    checks: dict[str, str] = {}

    async with httpx.AsyncClient(timeout=3.0) as client:
        for name, url in [
            ("payment_engine", f"{settings.payment_engine_url}/health"),
            ("billing_engine", f"{settings.billing_engine_url}/health"),
        ]:
            try:
                resp = await client.get(url)
                checks[name] = "ok" if resp.is_success else f"fail: {resp.status_code}"
            except Exception as exc:
                checks[name] = f"fail: {exc}"

    all_ok = all(v == "ok" for v in checks.values())
    http_status = 200 if all_ok else 503
    body: dict = {"status": "ready" if all_ok else "not_ready", "checks": checks}
    return JSONResponse(status_code=http_status, content=body)
