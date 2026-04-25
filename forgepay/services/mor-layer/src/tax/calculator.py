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
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

import httpx

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

# NOTE: EU VAT — OSS (One Stop Shop) rules since July 2021.
# For digital services sold B2C across EU borders, you charge the buyer's country
# rate (not your home country's) once you exceed €10,000/yr in cross-border sales.
# The rates below are the standard rates for digital services (2025).
# Reduced rates exist for some categories (e.g. e-books in many countries) — use
# Avalara/TaxJar if your product catalog needs reduced-rate rules.
# Reference: https://taxation-customs.ec.europa.eu/vies-vat-information-exchange-system-en
_EU_VAT_RATES: dict[str, Decimal] = {
    "AT": Decimal("0.20"), "BE": Decimal("0.21"), "BG": Decimal("0.20"),
    "CY": Decimal("0.19"), "CZ": Decimal("0.21"), "DE": Decimal("0.19"),
    "DK": Decimal("0.25"), "EE": Decimal("0.22"), "ES": Decimal("0.21"),
    "FI": Decimal("0.255"), "FR": Decimal("0.20"), "GR": Decimal("0.24"),
    "HR": Decimal("0.25"), "HU": Decimal("0.27"), "IE": Decimal("0.23"),
    "IT": Decimal("0.22"), "LT": Decimal("0.21"), "LU": Decimal("0.17"),
    "LV": Decimal("0.21"), "MT": Decimal("0.18"), "NL": Decimal("0.21"),
    "PL": Decimal("0.23"), "PT": Decimal("0.23"), "RO": Decimal("0.19"),
    "SE": Decimal("0.25"), "SI": Decimal("0.22"), "SK": Decimal("0.20"),
}

# NOTE: US sales tax — economic nexus rules (post South Dakota v. Wayfair 2018).
# Once you exceed $100,000 in sales OR 200 transactions in a state you have nexus
# and must collect sales tax there. The rates below are state-level base rates only —
# many states have county and city surcharges on top (e.g. California base is 7.25%
# but LA county adds 2.25%). Use Avalara or TaxJar for address-level accuracy.
# States with 0% rate (AK, DE, MT, NH, OR) have no state sales tax.
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
        if not self._settings.avalara_account_id or not self._settings.avalara_license_key:
            logger.warning("Avalara credentials not configured; falling back to internal engine")
            return self._calculate_internal(amount_cents, country, state)

        try:
            amount = amount_cents / 100
            payload = {
                "type": "SalesOrder",
                "companyCode": "DEFAULT",
                "date": date.today().isoformat(),
                "lines": [{"amount": amount}],
                "addresses": {
                    "shipTo": {
                        "country": country,
                        "region": state or "",
                        "postalCode": postal_code or "",
                    }
                },
            }
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.post(
                    "https://rest.avatax.com/api/v2/transactions/create",
                    json=payload,
                    auth=(self._settings.avalara_account_id, self._settings.avalara_license_key),
                )
                response.raise_for_status()

            data = response.json()
            total_tax: float = data.get("totalTax", 0.0)
            rate = Decimal(str(total_tax / amount)) if amount else Decimal("0")
            tax_cents = int(Decimal(str(total_tax * 100)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
            return TaxResult(
                rate=rate,
                amount_cents=tax_cents,
                jurisdiction=country,
                tax_type="VAT",
                inclusive=False,
            )
        except Exception as exc:
            logger.warning("Avalara API call failed (%s); falling back to internal engine", exc)
            return self._calculate_internal(amount_cents, country, state)

    async def _calculate_taxjar(
        self,
        amount_cents: int,
        country: str,
        state: str | None,
        postal_code: str | None,
    ) -> TaxResult | None:
        if not self._settings.taxjar_token:
            logger.warning("TaxJar token not configured; falling back to internal engine")
            return self._calculate_internal(amount_cents, country, state)

        try:
            headers = {"Authorization": f"Token {self._settings.taxjar_token}"}
            amount = amount_cents / 100

            # Try GET rates endpoint first (quick rate lookup by postal code)
            if postal_code:
                async with httpx.AsyncClient(timeout=10.0) as client:
                    response = await client.get(
                        f"https://api.taxjar.com/v2/rates/{postal_code}",
                        headers=headers,
                        params={"country": country, "state": state or ""},
                    )
                    response.raise_for_status()

                rate_data = response.json().get("rate", {})
                combined_rate_str: str = rate_data.get("combined_rate", "0")
                rate = Decimal(combined_rate_str)
                tax_cents = self._apply_rate(amount_cents, rate)
                return TaxResult(
                    rate=rate,
                    amount_cents=tax_cents,
                    jurisdiction=country if not state else f"{country}-{state}",
                    tax_type="SALES_TAX" if country == "US" else "VAT",
                    inclusive=False,
                )

            # Fall back to POST /taxes for full calculation when no postal code
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.post(
                    "https://api.taxjar.com/v2/taxes",
                    headers=headers,
                    json={
                        "from_country": country,
                        "to_country": country,
                        "to_state": state or "",
                        "to_zip": postal_code or "",
                        "amount": amount,
                        "shipping": 0,
                    },
                )
                response.raise_for_status()

            tax_data = response.json().get("tax", {})
            amount_to_collect: float = tax_data.get("amount_to_collect", 0.0)
            rate_val: float = tax_data.get("rate", 0.0)
            tax_cents = int(Decimal(str(amount_to_collect * 100)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
            return TaxResult(
                rate=Decimal(str(rate_val)),
                amount_cents=tax_cents,
                jurisdiction=country if not state else f"{country}-{state}",
                tax_type="SALES_TAX" if country == "US" else "VAT",
                inclusive=False,
            )
        except Exception as exc:
            logger.warning("TaxJar API call failed (%s); falling back to internal engine", exc)
            return self._calculate_internal(amount_cents, country, state)
