"""
Configuration for the ForgePay MoR Layer.
All secrets are injected via environment variables / K8s secrets.
"""

from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="MOR_", env_file=".env", extra="ignore")

    # Service
    environment:  str  = "development"
    log_level:    str  = "INFO"
    port:         int  = 8010
    debug:        bool = False

    # ── Hyperswitch (payment-engine) ──────────────────────────────────────
    # This replaces all Polar Stripe calls.
    hyperswitch_base_url:  str = "http://payment-engine:8080"
    hyperswitch_api_key:   str = ""           # injected from secret
    hyperswitch_publishable_key: str = ""     # for frontend checkout widget

    # Webhook secret shared between payment-engine and mor-layer
    hyperswitch_webhook_secret: str = ""

    # ── Unified Router ────────────────────────────────────────────────────
    unified_router_url: str = "http://unified-router:8000"
    internal_webhook_secret: str = ""

    # ── Database ──────────────────────────────────────────────────────────
    database_url: str = "postgresql+asyncpg://forgepay:devpassword@localhost:5432/forgepay_dev"

    # ── Redis ─────────────────────────────────────────────────────────────
    redis_url: str = "redis://localhost:6379/1"

    # ── Tax ───────────────────────────────────────────────────────────────
    tax_provider:       str  = "internal"    # "internal" | "avalara" | "taxjar"
    avalara_account_id: str  = ""
    avalara_license_key: str = ""
    taxjar_token:       str  = ""

    # ── Auth / JWT ────────────────────────────────────────────────────────
    # LAUNCH BLOCKER: jwt_secret is defined here but NO FastAPI middleware uses it.
    # All /v1/* routes are publicly accessible without any token.
    # To fix:
    #   1. pip install python-jose[cryptography] passlib[bcrypt]
    #   2. Create src/auth/dependencies.py:
    #        from fastapi.security import OAuth2PasswordBearer
    #        oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/v1/auth/token")
    #        async def get_current_merchant(token: str = Depends(oauth2_scheme)) -> Merchant: ...
    #   3. Add Depends(get_current_merchant) to every protected route handler.
    # See FastAPI security docs: https://fastapi.tiangolo.com/tutorial/security/
    jwt_secret:       str = "dev-jwt-secret-change-me"
    jwt_algorithm:    str = "HS256"
    jwt_expire_mins:  int = 60

    # ── Feature flags ─────────────────────────────────────────────────────
    enable_crypto_checkout: bool = True
    enable_stablecoin_checkout: bool = True


@lru_cache
def get_settings() -> Settings:
    return Settings()
