"""
ARCH: ForgePay MoR Layer (Merchant of Record)
──────────────────────────────────────────────────────────────────────────────
Role: Handles checkout, tax calculation, and customer management.
Forked from polarsource/polar — all stripe.* calls replaced with HyperswitchClient.

Payment flow:
  Merchant frontend → POST /v1/checkout/sessions
    → sum line items
    → TaxCalculator (internal rules or Avalara/TaxJar)
    → HyperswitchClient.create_payment()   # payment-engine:8080
    → return client_secret for Hyperswitch.js

Webhook flow (inbound from payment-engine):
  POST /v1/webhooks/hyperswitch
    → verify HMAC-SHA256 signature
    → update checkout_sessions / trigger fulfillment  ← LAUNCH BLOCKER: stubbed
    → forward to unified-router:8000/webhooks/hyperswitch

Upstream services this calls:
  payment-engine  http://payment-engine:8080   (Hyperswitch REST API)
  unified-router  http://unified-router:8000   (event forwarding)

Ports:
  HTTP  :8010  (primary)
  Docs  :8010/docs  (disabled in production)

LAUNCH BLOCKER: JWT middleware is configured (see config.py) but NOT applied to any
  route. All endpoints are publicly accessible. Wire FastAPI's OAuth2PasswordBearer
  or add a custom dependency to protect /v1/* routes before production.

LAUNCH BLOCKER: Missing Alembic migrations for mor-layer database tables:
  checkout_sessions, customers, merchants, fulfillment_tasks.
  The events schema (001_forgepay_events.sql) is for unified-router's DB only.

Original Polar license: Apache 2.0
ForgePay modifications: Apache 2.0
"""

from __future__ import annotations

import logging

import structlog
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware

from src.api import checkout, customers, webhooks
from src.config import get_settings

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
logging.basicConfig(level=settings.log_level)

# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="ForgePay MoR Layer",
    description=(
        "Merchant of Record service. Handles checkout, tax, and fulfillment. "
        "All payments route through Hyperswitch (payment-engine)."
    ),
    version="0.1.0",
    docs_url="/docs" if settings.environment != "production" else None,
    redoc_url=None,
    openapi_url="/openapi.json" if settings.environment != "production" else None,
)

# ── Middleware ─────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if settings.environment == "development" else ["https://forgepay.io"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ────────────────────────────────────────────────────────────────────
app.include_router(checkout.router,  prefix="/v1")
app.include_router(customers.router, prefix="/v1")
app.include_router(webhooks.router,  prefix="/v1")


# ── Health check ──────────────────────────────────────────────────────────────
@app.get("/healthz", include_in_schema=False)
async def healthz() -> dict:
    return {"status": "ok", "service": "mor-layer"}


@app.get("/readyz", include_in_schema=False)
async def readyz() -> dict:
    # LAUNCH BLOCKER: this always returns 200 — it is not a real readiness check.
    # Before production, probe each dependency:
    #   1. asyncpg: SELECT 1 (database_url connection)
    #   2. Redis: PING (redis_url connection)
    #   3. Hyperswitch: GET /health (hyperswitch_base_url)
    # Return HTTP 503 if any check fails so Kubernetes stops routing traffic here.
    return {"status": "ready"}
