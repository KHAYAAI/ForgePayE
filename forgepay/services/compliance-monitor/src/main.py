"""
ForgePay Compliance Monitor
────────────────────────────────────────────────────────────────────────────
Role: Continuous OFAC/KYC-AML screening and transaction monitoring service.

Responsibilities:
  • Sanctions screening (OFAC SDN, EU Consolidated) with fuzzy name matching
  • Transaction monitoring with 8 AML rules (structuring, velocity, layering…)
  • KYC record management and expiry tracking
  • SAR (Suspicious Activity Report) and CTR lifecycle management
  • Inbound webhook ingestion from Chainalysis KYT and Elliptic

Scheduler (APScheduler):
  • OFAC SDN list refresh: daily at 02:00 UTC
  • EU Consolidated refresh: daily at 03:00 UTC
  • Monitoring cycle: every 5 minutes (evaluates last 5 min of transactions)

Auth:
  All /api/v1/* routes require either:
    Bearer JWT (HS256, signed with JWT_SECRET)
    X-Compliance-API-Key header (sha256-hashed in memory store)

Ports:
  HTTP  :8003
  Docs  :8003/docs  (disabled in production)

Upstream services:
  payment-engine  http://payment-engine:8080  (Hyperswitch)
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import AsyncGenerator

import structlog
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest
from slowapi import Limiter
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from src.config import get_settings
from src.kyc.manager import KycManager
from src.monitoring.engine import TransactionMonitoringEngine
from src.observability.metrics import prometheus_registry
from src.observability.middleware import PrometheusMiddleware
from src.ofac.feed import ListType, OfacFeedManager
from src.reporting.sar import SarManager
from src.routers import monitoring, reporting, sanctions, screening, webhooks, ofac_screening
from src.sanctions.eu_list import EuSanctionsManager
from src.sanctions.ofac import OfacListManager
from src.sanctions.screening import TransactionScreeningEngine
from src.screening.engine import ScreeningEngine

# ---------------------------------------------------------------------------
# Structured logging setup (mirrors mor-layer pattern)
# ---------------------------------------------------------------------------
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
logger = structlog.get_logger(__name__)

# Rate limiter setup
limiter = Limiter(key_func=get_remote_address)

# Rate limit handler
async def _rate_limit_handler(request: Request, exc: RateLimitExceeded) -> JSONResponse:
    logger.warning("rate_limit_exceeded", path=request.url.path, remote=get_remote_address(request))
    return JSONResponse(
        status_code=429,
        content={"detail": "Rate limit exceeded. Please retry after a delay."},
    )


# ---------------------------------------------------------------------------
# Lifespan: initialise singletons, start scheduler, begin background tasks
# ---------------------------------------------------------------------------


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """
    FastAPI lifespan context manager.

    Startup:
      1. Instantiate all domain managers and attach to app.state.
      2. Attempt initial sanctions list loads (failures are non-fatal
         so the service can start even when Treasury.gov is unreachable).
      3. Schedule recurring jobs:
           OFAC refresh       — daily at 02:00 UTC
           EU refresh         — daily at 03:00 UTC
           Monitoring cycle   — every 5 minutes

    Shutdown:
      4. Stop the scheduler cleanly.
    """
    logger.info("compliance_monitor.startup", port=settings.port)

    # ── Redis client (for OFAC feed caching) ──────────────────────────────────
    import redis.asyncio as redis
    try:
        redis_client = await redis.from_url(settings.redis_url, decode_responses=False)
        await redis_client.ping()
        logger.info("redis.connected", url=settings.redis_url)
    except Exception as exc:
        logger.warning("redis.connection_failed", error=str(exc))
        redis_client = None

    # ── Singletons ────────────────────────────────────────────────────────────
    ofac_manager = OfacListManager(sdn_url=settings.ofac_sdn_url)
    eu_manager = EuSanctionsManager(list_url=settings.eu_sanctions_url)
    screening_engine = ScreeningEngine(
        ofac=ofac_manager,
        eu=eu_manager,
        threshold=settings.fuzzy_match_threshold,
    )
    monitoring_engine = TransactionMonitoringEngine()
    kyc_manager = KycManager()
    sar_manager = SarManager()

    # ── OFAC real-time feed manager (for CSV-based screening) ──────────────────
    ofac_feed_manager = None
    if redis_client:
        try:
            ofac_feed_manager = OfacFeedManager(
                redis_client=redis_client,
                feed_base_url=settings.ofac_feed_url,
                cache_ttl_seconds=settings.ofac_cache_ttl,
            )
            logger.info("ofac_feed_manager.initialized")
        except Exception as exc:
            logger.warning("ofac_feed_manager.init_failed", error=str(exc))
    else:
        logger.warning("ofac_feed_manager.skipped", reason="redis not available")

    # ── Transaction screening engine (real-time OFAC checks) ───────────────────
    transaction_screening_engine = None
    if ofac_feed_manager:
        transaction_screening_engine = TransactionScreeningEngine(
            ofac_manager=ofac_feed_manager,
            audit_service_url=settings.audit_service_url,
            fuzzy_threshold=settings.fuzzy_match_threshold,
        )
        logger.info("transaction_screening_engine.initialized")

    # Attach to app state so routers can access via request.app.state
    app.state.ofac_manager = ofac_manager
    app.state.eu_manager = eu_manager
    app.state.screening_engine = screening_engine
    app.state.monitoring_engine = monitoring_engine
    app.state.kyc_manager = kyc_manager
    app.state.sar_manager = sar_manager
    app.state.ofac_feed_manager = ofac_feed_manager
    app.state.screening_engine = transaction_screening_engine
    app.state.redis_client = redis_client

    # ── Initial list load (best-effort) ───────────────────────────────────────
    try:
        await ofac_manager.refresh_list()
    except Exception as exc:
        logger.warning("startup.ofac_initial_load_failed", error=str(exc))

    try:
        await eu_manager.refresh_list()
    except Exception as exc:
        logger.warning("startup.eu_initial_load_failed", error=str(exc))

    # Refresh OFAC CSV feeds if available
    if ofac_feed_manager:
        try:
            await ofac_feed_manager.refresh_all_feeds()
        except Exception as exc:
            logger.warning("startup.ofac_feed_initial_load_failed", error=str(exc))

    # ── Scheduler ─────────────────────────────────────────────────────────────
    scheduler = AsyncIOScheduler(timezone="UTC")

    # OFAC refresh — daily at 02:00 UTC
    scheduler.add_job(
        ofac_manager.refresh_list,
        trigger="cron",
        hour=2,
        minute=0,
        id="ofac_refresh",
        name="OFAC SDN List Refresh",
        max_instances=1,
        coalesce=True,
    )

    # EU refresh — daily at 03:00 UTC
    scheduler.add_job(
        eu_manager.refresh_list,
        trigger="cron",
        hour=3,
        minute=0,
        id="eu_refresh",
        name="EU Consolidated Sanctions Refresh",
        max_instances=1,
        coalesce=True,
    )

    # Monitoring cycle — every 5 minutes
    scheduler.add_job(
        monitoring_engine.run_monitoring_cycle,
        trigger="interval",
        minutes=5,
        id="monitoring_cycle",
        name="AML Transaction Monitoring Cycle",
        max_instances=1,
        coalesce=True,
    )

    # OFAC CSV feeds refresh — daily at 02:30 UTC (after XML refresh)
    if ofac_feed_manager:
        scheduler.add_job(
            ofac_feed_manager.refresh_all_feeds,
            trigger="cron",
            hour=2,
            minute=30,
            id="ofac_csv_refresh",
            name="OFAC CSV Feeds Refresh (SDN, DPL, EEL)",
            max_instances=1,
            coalesce=True,
        )

    scheduler.start()
    app.state.scheduler = scheduler
    logger.info("compliance_monitor.scheduler_started", jobs=len(scheduler.get_jobs()))

    yield

    # ── Shutdown ──────────────────────────────────────────────────────────────
    logger.info("compliance_monitor.shutdown")
    scheduler.shutdown(wait=False)


# ---------------------------------------------------------------------------
# FastAPI application
# ---------------------------------------------------------------------------

app = FastAPI(
    title="ForgePay Compliance Monitor",
    description=(
        "Continuous OFAC/KYC-AML screening and transaction monitoring service. "
        "Screens entities against OFAC SDN + EU Consolidated lists, evaluates "
        "transactions against 8 AML rules, manages SARs and CTRs."
    ),
    version="0.1.0",
    lifespan=lifespan,
    docs_url="/docs" if settings.environment != "production" else None,
    redoc_url=None,
    openapi_url="/openapi.json" if settings.environment != "production" else None,
)

# Attach rate limiter to app state
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_handler)

# ---------------------------------------------------------------------------
# CORS
# ---------------------------------------------------------------------------
app.add_middleware(
    CORSMiddleware,
    allow_origins=(
        ["*"] if settings.environment == "development" else settings.cors_origins_list
    ),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_middleware(PrometheusMiddleware)

# ---------------------------------------------------------------------------
# Routers
# ---------------------------------------------------------------------------
app.include_router(screening.router)
app.include_router(ofac_screening.router)
app.include_router(monitoring.router)
app.include_router(sanctions.router)
app.include_router(reporting.router)
app.include_router(webhooks.router)


# ---------------------------------------------------------------------------
# Metrics endpoint
# ---------------------------------------------------------------------------


@app.get("/metrics", include_in_schema=False)
async def metrics() -> Response:
    """Prometheus scrape endpoint — text-exposition format."""
    return Response(
        content=generate_latest(prometheus_registry),
        media_type=CONTENT_TYPE_LATEST,
    )


# ---------------------------------------------------------------------------
# Health endpoint
# ---------------------------------------------------------------------------


@app.get("/health", include_in_schema=False)
async def health() -> dict:
    """
    Liveness health check.

    Returns:
        status: "ok"
        ofac_list_age_hours: hours since last OFAC SDN refresh (inf = never loaded)
        eu_list_age_hours: hours since last EU list refresh
        monitored_entities: count of entities in the screening result cache
    """
    ofac: OfacListManager = app.state.ofac_manager
    eu: EuSanctionsManager = app.state.eu_manager
    screening: ScreeningEngine = app.state.screening_engine

    return {
        "status": "ok",
        "service": "compliance-monitor",
        "ofac_list_age_hours": round(ofac.get_list_age_hours(), 2),
        "eu_list_age_hours": round(eu.get_list_age_hours(), 2),
        "ofac_entry_count": ofac.entry_count(),
        "eu_entry_count": eu.entry_count(),
        "monitored_entities": len(screening._cache),
    }


@app.get("/readyz", include_in_schema=False)
async def readyz() -> dict:
    """
    Readiness probe — considers service ready once at least one sanctions
    list has been loaded (age < 25h to allow for daily refresh lag).
    """
    ofac: OfacListManager = app.state.ofac_manager
    ofac_ok = ofac.get_list_age_hours() < 25.0

    if not ofac_ok:
        from fastapi import Response
        import json

        return Response(
            content=json.dumps(
                {
                    "status": "not_ready",
                    "reason": "OFAC list not yet loaded",
                    "ofac_age_hours": ofac.get_list_age_hours(),
                }
            ),
            status_code=503,
            media_type="application/json",
        )

    return {"status": "ready"}
