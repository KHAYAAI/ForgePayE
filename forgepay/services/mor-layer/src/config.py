"""
Configuration for the ForgePay MoR Layer.
All secrets are injected via environment variables / K8s secrets.
"""

from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict

_DEV_JWT_SECRET = "dev-jwt-secret-change-me"


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
    # JWT auth is implemented in src/auth/ (dependencies.py + jwt.py).
    # Protected routes use Depends(get_current_merchant) via OAuth2PasswordBearer.
    # Token endpoint: POST /v1/auth/token (OAuth2 password flow).
    # NOTE: override jwt_secret via MOR_JWT_SECRET env var in production —
    #   never use the default value outside of local dev.
    jwt_secret:       str = _DEV_JWT_SECRET
    jwt_algorithm:    str = "HS256"
    jwt_expire_mins:  int = 60

    # ── Auditor ───────────────────────────────────────────────────────────
    # Hex-encoded 64-byte seed for AuditorClient. Loaded from K8s Secret
    # MOR_AUDITOR_SEED_HEX. Required in production.
    auditor_seed_hex: str = ""  # required in production; loaded from K8s Secret MOR_AUDITOR_SEED_HEX

    # ── Kill Bill (billing-engine) ────────────────────────────────────────────
    killbill_base_url:   str = "http://billing-engine:8020"
    killbill_api_key:    str = "forgepay"          # Kill Bill tenant API key
    killbill_api_secret: str = ""                  # injected from MOR_KILLBILL_API_SECRET

    # ── Feature flags ─────────────────────────────────────────────────────
    enable_crypto_checkout: bool = True
    enable_stablecoin_checkout: bool = True

    def model_post_init(self, __context: object) -> None:
        if self.environment != "development":
            errors: list[str] = []
            if self.jwt_secret == _DEV_JWT_SECRET:
                errors.append(
                    "MOR_JWT_SECRET must be overridden in production "
                    "(current value is the insecure dev default)"
                )
            if not self.hyperswitch_webhook_secret:
                errors.append("MOR_HYPERSWITCH_WEBHOOK_SECRET must be set in production")
            if not self.internal_webhook_secret:
                errors.append("MOR_INTERNAL_WEBHOOK_SECRET must be set in production")
            if not self.auditor_seed_hex:
                errors.append("MOR_AUDITOR_SEED_HEX must be set in production")
            if errors:
                raise ValueError(
                    "Production startup aborted — required secrets are missing:\n"
                    + "\n".join(f"  - {e}" for e in errors)
                )


@lru_cache
def get_settings() -> Settings:
    return Settings()
