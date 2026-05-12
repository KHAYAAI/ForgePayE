"""
Configuration for the ForgePay Liquidity Forecaster.
All secrets and service URLs are injected via environment variables / K8s secrets.
"""

from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict

_DEV_JWT_SECRET = "dev-jwt-secret-change-me"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="LF_",
        env_file=".env",
        extra="ignore",
    )

    # Service identity
    environment: str = "development"
    log_level: str = "INFO"
    port: int = 8002

    # CORS — comma-separated list of allowed origins
    cors_origins: str = "http://localhost:3000,http://localhost:3001"

    # Upstream service URLs
    payment_engine_url: str = "http://payment-engine:8080"
    billing_engine_url: str = "http://billing-engine:8003"
    stablecoin_gateway_url: str = "http://stablecoin-gateway:3002"
    crypto_gateway_url: str = "http://crypto-gateway:3001"

    # Auth
    jwt_secret: str = _DEV_JWT_SECRET
    jwt_algorithm: str = "HS256"
    jwt_expire_mins: int = 60

    # Forecasting
    forecast_cache_ttl_hours: int = 6
    background_poll_interval_hours: int = 6

    # Alert thresholds
    low_balance_threshold_usd: float = 10_000.0
    runway_warning_days: int = 90

    def get_cors_origins(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    def model_post_init(self, __context: object) -> None:
        if self.environment != "development":
            errors: list[str] = []
            if self.jwt_secret == _DEV_JWT_SECRET:
                errors.append(
                    "LF_JWT_SECRET must be overridden in production "
                    "(current value is the insecure dev default)"
                )
            if errors:
                raise ValueError(
                    "Production startup aborted — required secrets are missing:\n"
                    + "\n".join(f"  - {e}" for e in errors)
                )


@lru_cache
def get_settings() -> Settings:
    return Settings()
