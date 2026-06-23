"""
ARCH: ForgePay MoR Layer (Merchant of Record)
──────────────────────────────────────────────────────────────────────────────
Role: Handles checkout, tax calculation, customer management, and merchant auth.
Forked from polarsource/polar — all stripe.* calls replaced with HyperswitchClient.

Payment flow:
  Merchant frontend → POST /v1/checkout/sessions
    → sum line items
    → TaxCalculator (internal rules or Avalara/TaxJar)
    → HyperswitchClient.create_payment()   # payment-engine:8080
    → store session in Redis + Postgres
    → return client_secret for Hyperswitch.js

Webhook flow (inbound from payment-engine):
  POST /v1/webhooks/hyperswitch
    → verify HMAC-SHA256 signature
    → update checkout_sessions (completed / failed)
    → forward to unified-router:8000/webhooks/hyperswitch

Auth:
  POST /v1/merchants         → register merchant (returns api_key)
  POST /v1/auth/token        → OAuth2 password flow, returns JWT
  All /v1/checkout/* and /v1/customers/* require Bearer JWT via
  get_current_merchant dependency.

Upstream services this calls:
  payment-engine  http://payment-engine:8080   (Hyperswitch REST API)
  unified-router  http://unified-router:8000   (event forwarding)

Ports:
  HTTP  :8010  (primary)
  Docs  :8010/docs  (disabled in production)
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

import httpx
import structlog
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.api import checkout, customers, webhooks
from src.api.auditor import router as auditor_router
from src.api.merchants import auth_router, router as merchants_router
from src.api.tax_filing_routes import router as tax_filing_router
from src.bootstrap.mor_account import ensure_mor_operating_account
from src.config import get_settings

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
logging.basicConfig(level=settings.log_level)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    _settings = get_settings()
    await ensure_mor_operating_account(
        _settings.bank_connectivity_url,
        _settings.mor_internal_secret,
    )
    yield
    # Shutdown — nothing to clean up


app = FastAPI(
    title="ForgePay MoR Layer",
    description="Merchant of Record service. Handles checkout, tax, and fulfillment.",
    version="0.1.0",
    lifespan=lifespan,
    docs_url="/docs"      if settings.environment != "production" else None,
    redoc_url=None,
    openapi_url="/openapi.json" if settings.environment != "production" else None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if settings.environment == "development" else ["https://forgepay.io"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Public routes (no auth required)
app.include_router(merchants_router, prefix="/v1")
app.include_router(auth_router,      prefix="/v1")
app.include_router(webhooks.router,  prefix="/v1")   # HMAC auth via signature header

# Protected routes (JWT Bearer token required — dependency in each route handler)
app.include_router(checkout.router,  prefix="/v1")
app.include_router(customers.router, prefix="/v1")

# Internal routes (restricted to cluster network + X-Internal-Secret header)
app.include_router(auditor_router)   # prefix already set in auditor.py (/v1/auditor)

# Tax filing routes (JWT Bearer token required — dependency in each route handler)
app.include_router(tax_filing_router)


@app.get("/healthz", include_in_schema=False)
async def healthz() -> dict:
    return {"status": "ok", "service": "mor-layer"}


@app.get("/readyz", include_in_schema=False)
async def readyz() -> dict:
    """
    Real readiness probe — checks all three upstream dependencies.
    Returns 503 if any check fails so Kubernetes stops routing traffic here.
    """
    checks: dict[str, str] = {}

    # 1. Database probe
    try:
        from src.db.session import get_engine
        async with get_engine().connect() as conn:
            await conn.execute(__import__("sqlalchemy").text("SELECT 1"))
        checks["db"] = "ok"
    except Exception as exc:
        checks["db"] = f"fail: {exc}"

    # 2. Redis probe
    try:
        import redis.asyncio as aioredis
        r = aioredis.from_url(settings.redis_url)
        await r.ping()
        await r.aclose()
        checks["redis"] = "ok"
    except Exception as exc:
        checks["redis"] = f"fail: {exc}"

    # 3. Hyperswitch health probe
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            resp = await client.get(f"{settings.hyperswitch_base_url}/health")
            checks["hyperswitch"] = "ok" if resp.is_success else f"fail: {resp.status_code}"
    except Exception as exc:
        checks["hyperswitch"] = f"fail: {exc}"

    all_ok = all(v == "ok" for v in checks.values())
    if not all_ok:
        from fastapi import Response
        return Response(
            content=__import__("json").dumps({"status": "not ready", "checks": checks}),
            status_code=503,
            media_type="application/json",
        )

    return {"status": "ready", "checks": checks}
