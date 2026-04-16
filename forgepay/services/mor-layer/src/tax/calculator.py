"""
ForgePay Tax Calculator

Supports three modes (configured via MOR_TAX_PROVIDER):
  - "internal"  : Built-in rules engine (good for MVP / sandbox)
  - "avalara"   : Avalara AvaTax API (recommended for production MoR)
  - "taxjar"    : TaxJar API

The internal engine covers the most common cases:
  - EU VAT (digital services — MOSS / OSS rules)
  - UK VAT
  - AU/NZ GST
  - CA GST/HST/QST
  - US sales tax (by state, simplified rates — upgrade to Avalara for exact)
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

from src.config import get_settings

logger = logging.getLogger(__name__)


@dataclass
class TaxResult:
    rate:          Decimal
    amount_cents:  int
    jurisdiction:  str
    tax_type:      str       # "VAT" | "GST" | "SALES_TAX"
    inclusive:     bool


# ── Internal rules engine ─────────────────────────────────────────────────────

# EU VAT rates for digital services (standard rates, 2025)
_EU_VAT_RATES: dict[str, Decimal] = {
    "AT": Decimal("0.20"), "BE": Decimal("0.21"), "BG": Decimal("0.20"),
    "CY": Decimal("0.19"), "CZ": Decimal("0.21"), "DE": Decimal("0.19"),
    "DK": Decimal("0.25"), "EE": Decimal("0.22"), "ES": Decimal("0.21"),
    "FI": Decimal("0.25.5"), "FR": Decimal("0.20"), "GR": Decimal("0.24"),
    "HR": Decimal("0.25"), "HU": Decimal("0.27"), "IE": Decimal("0.23"),
    "IT": Decimal("0.22"), "LT": Decimal("0.21"), "LU": Decimal("0.17"),
    "LV": Decimal("0.21"), "MT": Decimal("0.18"), "NL": Decimal("0.21"),
    "PL": Decimal("0.23"), "PT": Decimal("0.23"), "RO": Decimal("0.19"),
    "SE": Decimal("0.25"), "SI": Decimal("0.22"), "SK": Decimal("0.20"),
}

# Simplified US state sales tax rates (use Avalara/TaxJar for exact address-level)
_US_STATE_RATES: dict[str, Decimal] = {
    "AL": Decimal("0.04"), "AK": Decimal("0.00"), "AZ": Decimal("0.056"),
    "AR": Decimal("0.065"), "CA": Decimal("0.0725"), "CO": Decimal("0.029"),
    "CT": Decimal("0.0635"), "DE": Decimal("0.00"), "FL": Decimal("0.06"),
    "GA": Decimal("0.04"), "HI": Decimal("0.04"), "ID": Decimal("0.06"),
    "IL": Decimal("0.0625"), "IN": Decimal("0.07"), "IA": Decimal("0.06"),
    "KS": Decimal("0.065"), "KY": Decimal("0.06"), "LA": Decimal("0.0445"),
    "ME": Decimal("0.055"), "MD": Decimal("0.06"), "MA": Decimal("0.0625"),
    "MI": Decimal("0.06"), "MN": Decimal("0.06875"), "MS": Decimal("0.07"),
    "MO": Decimal("0.04225"), "MT": Decimal("0.00"), "NE": Decimal("0.055"),
    "NV": Decimal("0.0685"), "NH": Decimal("0.00"), "NJ": Decimal("0.06625"),
    "NM": Decimal("0.05125"), "NY": Decimal("0.04"), "NC": Decimal("0.0475"),
    "ND": Decimal("0.05"), "OH": Decimal("0.0575"), "OK": Decimal("0.045"),
    "OR": Decimal("0.00"), "PA": Decimal("0.06"), "RI": Decimal("0.07"),
    "SC": Decimal("0.06"), "SD": Decimal("0.045"), "TN": Decimal("0.07"),
    "TX": Decimal("0.0625"), "UT": Decimal("0.0485"), "VT": Decimal("0.06"),
    "VA": Decimal("0.053"), "WA": Decimal("0.065"), "WV": Decimal("0.06"),
    "WI": Decimal("0.05"), "WY": Decimal("0.04"),
}

_OTHER_RATES: dict[str, tuple[Decimal, str, str]] = {
    "GB": (Decimal("0.20"), "VAT", "GB VAT"),
    "AU": (Decimal("0.10"), "GST", "AU GST"),
    "NZ": (Decimal("0.15"), "GST", "NZ GST"),
    "SG": (Decimal("0.09"), "GST", "SG GST"),
    "NO": (Decimal("0.25"), "VAT", "NO VAT"),
    "CH": (Decimal("0.081"), "VAT", "CH VAT"),
    "IS": (Decimal("0.24"), "VAT", "IS VAT"),
    "JP": (Decimal("0.10"), "CT", "JP Consumption Tax"),
    "KR": (Decimal("0.10"), "VAT", "KR VAT"),
    "IN": (Decimal("0.18"), "GST", "IN GST (digital)"),
    "ZA": (Decimal("0.15"), "VAT", "ZA VAT"),
    "MX": (Decimal("0.16"), "VAT", "MX VAT"),
    "BR": (Decimal("0.0938"), "ISS/PIS/COFINS", "BR Digital Tax"),
    "CA": (Decimal("0.05"), "GST", "CA GST"),
}


class TaxCalculator:
    def __init__(self) -> None:
        self._settings = get_settings()

    async def calculate(
        self,
        amount_cents: int,
        country: str | None,
        state: str | None = None,
        postal_code: str | None = None,
        tax_code: str | None = None,
    ) -> TaxResult | None:
        """
        Calculate tax for a transaction.
        Returns None if the jurisdiction has no tax or cannot be determined.
        """
        if not country:
            return None

        country = country.upper().strip()

        if self._settings.tax_provider == "avalara":
            return await self._calculate_avalara(amount_cents, country, state, postal_code, tax_code)
        if self._settings.tax_provider == "taxjar":
            return await self._calculate_taxjar(amount_cents, country, state, postal_code)

        return self._calculate_internal(amount_cents, country, state)

    def _calculate_internal(
        self,
        amount_cents: int,
        country: str,
        state: str | None,
    ) -> TaxResult | None:
        # EU VAT
        if country in _EU_VAT_RATES:
            rate = _EU_VAT_RATES[country]
            tax_amount = self._apply_rate(amount_cents, rate)
            return TaxResult(
                rate=rate,
                amount_cents=tax_amount,
                jurisdiction=country,
                tax_type="VAT",
                inclusive=False,
            )

        # Other countries
        if country in _OTHER_RATES:
            rate, tax_type, jurisdiction = _OTHER_RATES[country]
            return TaxResult(
                rate=rate,
                amount_cents=self._apply_rate(amount_cents, rate),
                jurisdiction=jurisdiction,
                tax_type=tax_type,
                inclusive=False,
            )

        # US state sales tax
        if country == "US" and state:
            state = state.upper().strip()
            rate = _US_STATE_RATES.get(state, Decimal("0.00"))
            if rate == Decimal("0.00"):
                return None
            return TaxResult(
                rate=rate,
                amount_cents=self._apply_rate(amount_cents, rate),
                jurisdiction=f"US-{state}",
                tax_type="SALES_TAX",
                inclusive=False,
            )

        return None

    @staticmethod
    def _apply_rate(amount_cents: int, rate: Decimal) -> int:
        tax = Decimal(amount_cents) * rate
        return int(tax.quantize(Decimal("1"), rounding=ROUND_HALF_UP))

    async def _calculate_avalara(
        self,
        amount_cents: int,
        country: str,
        state: str | None,
        postal_code: str | None,
        tax_code: str | None,
    ) -> TaxResult | None:
        # TODO: implement Avalara AvaTax CreateTransaction API call
        # https://developer.avalara.com/api-reference/avatax/rest/v2/methods/Transactions/CreateTransaction/
        logger.warning("Avalara integration not yet implemented; falling back to internal engine")
        return self._calculate_internal(amount_cents, country, state)

    async def _calculate_taxjar(
        self,
        amount_cents: int,
        country: str,
        state: str | None,
        postal_code: str | None,
    ) -> TaxResult | None:
        # TODO: implement TaxJar TaxForOrder API call
        logger.warning("TaxJar integration not yet implemented; falling back to internal engine")
        return self._calculate_internal(amount_cents, country, state)
