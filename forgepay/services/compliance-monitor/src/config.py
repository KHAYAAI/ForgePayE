"""
Application settings loaded from environment / .env file.
Uses pydantic-settings for type-safe config with validation.
"""

from __future__ import annotations

from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── Server ────────────────────────────────────────────────────────────────
    port: int = Field(default=8003, alias="PORT")
    environment: str = Field(default="development", alias="ENVIRONMENT")
    log_level: str = Field(default="INFO", alias="LOG_LEVEL")

    # ── Auth ──────────────────────────────────────────────────────────────────
    jwt_secret: str = Field(default="change-me-in-production", alias="JWT_SECRET")
    internal_service_secret: str = Field(default="", alias="INTERNAL_SERVICE_SECRET")
    api_key_header: str = Field(default="X-Compliance-API-Key", alias="API_KEY_HEADER")

    # ── Upstream services ─────────────────────────────────────────────────────
    payment_engine_url: str = Field(
        default="http://localhost:8080", alias="PAYMENT_ENGINE_URL"
    )
    redis_url: str = Field(default="redis://localhost:6379/2", alias="REDIS_URL")

    # ── Sanctions list URLs ───────────────────────────────────────────────────
    ofac_sdn_url: str = Field(
        default="https://www.treasury.gov/ofac/downloads/sdn.xml",
        alias="OFAC_SDN_URL",
    )
    eu_sanctions_url: str = Field(
        default="https://webgate.ec.europa.eu/fsd/fsf/public/files/xmlFullSanctionsList_1_1/content",
        alias="EU_SANCTIONS_URL",
    )

    # ── Refresh schedules ─────────────────────────────────────────────────────
    ofac_refresh_cron: str = Field(default="0 2 * * *", alias="OFAC_REFRESH_CRON")
    eu_sanctions_refresh_cron: str = Field(
        default="0 3 * * *", alias="EU_SANCTIONS_REFRESH_CRON"
    )

    # ── AML thresholds ────────────────────────────────────────────────────────
    high_risk_countries: str = Field(
        default="IR,KP,SY,CU,RU,BY,MM,SD,YE", alias="HIGH_RISK_COUNTRIES"
    )
    structuring_threshold_usd: float = Field(
        default=10_000.0, alias="STRUCTURING_THRESHOLD_USD"
    )
    large_transaction_threshold_usd: float = Field(
        default=50_000.0, alias="LARGE_TRANSACTION_THRESHOLD_USD"
    )
    sar_auto_threshold_score: int = Field(default=50, alias="SAR_AUTO_THRESHOLD_SCORE")
    fuzzy_match_threshold: float = Field(default=0.85, alias="FUZZY_MATCH_THRESHOLD")

    # ── Third-party KYT providers ─────────────────────────────────────────────
    chainalysis_api_key: str = Field(default="", alias="CHAINALYSIS_API_KEY")
    elliptic_api_key: str = Field(default="", alias="ELLIPTIC_API_KEY")

    # ── CORS ──────────────────────────────────────────────────────────────────
    cors_origins: str = Field(
        default="http://localhost:3000,http://localhost:3001",
        alias="CORS_ORIGINS",
    )

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def high_risk_countries_set(self) -> set[str]:
        return {c.strip().upper() for c in self.high_risk_countries.split(",") if c.strip()}


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
