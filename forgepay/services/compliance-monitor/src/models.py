"""
Pydantic domain models for ForgePay Compliance Monitor.

All timestamps are ISO-8601 UTC strings so they serialise cleanly to JSON
without custom encoders.  Numeric identifiers use str so they round-trip
safely through JSON without precision loss.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Sanctions / screening
# ---------------------------------------------------------------------------

class SanctionsMatch(BaseModel):
    """A single hit against a sanctions / watch-list entry."""

    list_name: str = Field(
        description='Source list: "OFAC_SDN" | "EU_CONSOLIDATED" | "UN_CONSOLIDATED" | "FBI_WANTED"'
    )
    matched_name: str = Field(description="The name string that triggered the match")
    similarity_score: float = Field(ge=0.0, le=1.0, description="Fuzzy similarity 0.0–1.0")
    entry_id: str = Field(description="Unique ID within the source list")
    entry_type: str = Field(description="individual | entity | vessel | aircraft")
    programs: list[str] = Field(
        default_factory=list,
        description='Sanctions programs, e.g. ["IRAN", "CYBER"]',
    )
    additional_info: dict[str, Any] = Field(default_factory=dict)


class ScreeningResult(BaseModel):
    """Result of screening an entity (person, business, address, …) against all active lists."""

    entity_id: str
    entity_type: str = Field(
        description='"person" | "business" | "crypto_address" | "bank_account"'
    )
    name: str
    screened_at: str = Field(description="ISO-8601 UTC timestamp")
    result: str = Field(
        description='"clear" | "potential_match" | "confirmed_match" | "error"'
    )
    matches: list[SanctionsMatch] = Field(default_factory=list)
    risk_score: int = Field(ge=0, le=100)
    recommended_action: str = Field(description='"allow" | "review" | "block"')


# ---------------------------------------------------------------------------
# Transaction monitoring
# ---------------------------------------------------------------------------

class MonitoringRule(BaseModel):
    """A single AML rule that was triggered by the transaction under evaluation."""

    rule_id: str
    rule_name: str
    category: str = Field(
        description='"structuring" | "velocity" | "high_risk_jurisdiction" | "layering" | "unusual_pattern"'
    )
    severity: str = Field(description='"low" | "medium" | "high" | "critical"')
    description: str
    triggered_values: dict[str, Any] = Field(
        default_factory=dict,
        description="The concrete values that caused this rule to fire",
    )


class TransactionMonitoringResult(BaseModel):
    """Outcome of evaluating a payment transaction against all AML monitoring rules."""

    transaction_id: str
    merchant_id: str
    amount: float
    currency: str
    evaluated_at: str = Field(description="ISO-8601 UTC timestamp")
    rules_triggered: list[MonitoringRule] = Field(default_factory=list)
    risk_score: int = Field(ge=0, le=100)
    decision: str = Field(description='"allow" | "review" | "block"')
    requires_sar: bool


# ---------------------------------------------------------------------------
# KYC
# ---------------------------------------------------------------------------

class KycRecord(BaseModel):
    """KYC / CDD record for a merchant or end-customer entity."""

    entity_id: str
    entity_type: str = Field(description='"person" | "business"')
    status: str = Field(
        description='"pending" | "approved" | "rejected" | "expired" | "requires_review"'
    )
    risk_level: str = Field(description='"low" | "medium" | "high" | "very_high"')
    verified_at: str | None = Field(default=None, description="ISO-8601 UTC timestamp")
    expires_at: str | None = Field(default=None, description="ISO-8601 UTC timestamp")
    documents_provided: list[str] = Field(default_factory=list)
    aml_risk_factors: list[str] = Field(default_factory=list)
    last_reviewed_at: str = Field(description="ISO-8601 UTC timestamp")
    reviewer_notes: str | None = None


# ---------------------------------------------------------------------------
# SAR / CTR reporting
# ---------------------------------------------------------------------------

class SarReport(BaseModel):
    """Suspicious Activity Report record."""

    id: str
    merchant_id: str
    transaction_ids: list[str] = Field(default_factory=list)
    filing_type: str = Field(description='"initial" | "supplemental"')
    status: str = Field(description='"draft" | "submitted" | "acknowledged"')
    activity_description: str
    suspicious_activity_type: list[str] = Field(default_factory=list)
    total_amount: float
    activity_start_date: str = Field(description="ISO-8601 date string")
    activity_end_date: str = Field(description="ISO-8601 date string")
    created_at: str = Field(description="ISO-8601 UTC timestamp")
    submitted_at: str | None = None


class CtrReport(BaseModel):
    """Currency Transaction Report (cash transactions > $10,000)."""

    id: str
    merchant_id: str
    transaction_id: str
    amount: float
    currency: str
    transaction_date: str
    filing_status: str = Field(description='"pending" | "filed" | "exempt"')
    created_at: str


# ---------------------------------------------------------------------------
# Request / response schemas used by routers
# ---------------------------------------------------------------------------

class ScreenEntityRequest(BaseModel):
    entity_id: str
    entity_type: str = Field(description='"person" | "business" | "crypto_address" | "bank_account"')
    name: str
    crypto_addresses: list[str] = Field(default_factory=list)
    bank_accounts: list[str] = Field(default_factory=list)


class ScreenAddressRequest(BaseModel):
    address: str
    chain: str = Field(default="ETH", description='"ETH" | "BTC" | "SOL"')


class BatchScreenRequest(BaseModel):
    entities: list[ScreenEntityRequest]


class EvaluateTransactionRequest(BaseModel):
    transaction_id: str
    merchant_id: str
    amount: float
    currency: str
    payer_country: str = Field(default="", description="ISO-3166 alpha-2 country code of payer")
    payer_ip_country: str = Field(default="")
    payment_method: str = Field(default="card", description='"card" | "bank" | "crypto"')
    metadata: dict[str, Any] = Field(default_factory=dict)


class CreateSarRequest(BaseModel):
    merchant_id: str
    transaction_ids: list[str]
    activity_description: str
    suspicious_activity_types: list[str]
    filing_type: str = Field(default="initial")
    activity_start_date: str
    activity_end_date: str
    total_amount: float


class UpdateKycRequest(BaseModel):
    status: str
    risk_level: str
    reviewer_notes: str | None = None
    documents_provided: list[str] = Field(default_factory=list)
    aml_risk_factors: list[str] = Field(default_factory=list)


class WebhookChainalysisAlert(BaseModel):
    """Incoming KYT alert payload from Chainalysis."""

    alert_id: str
    asset: str
    network: str
    address: str
    transfer_reference: str | None = None
    alert_type: str
    alert_level: str  # "SEVERE" | "HIGH" | "MEDIUM" | "LOW"
    exposure_type: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class WebhookEllipticAlert(BaseModel):
    """Incoming transaction alert payload from Elliptic."""

    id: str
    blockchain: str
    hash: str
    risk_score: float
    risk_rules: list[dict[str, Any]] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
