"""
ForgePay MoR Layer — FastAPI application entry point.

This service is forked from polarsource/polar and modified to:
  - Route ALL payments through Hyperswitch (replacing Stripe)
  - Handle global tax calculation and collection
  - Manage checkout sessions, customers, and product fulfillment
  - Forward events to the unified-router

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
    # TODO: check DB + Redis + Hyperswitch connectivity
    return {"status": "ready"}
