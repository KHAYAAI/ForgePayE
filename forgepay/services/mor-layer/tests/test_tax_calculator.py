"""
Tests for the internal tax calculation engine.

Verifies every major tax jurisdiction against known rates.
These tests are the authoritative source of truth for tax correctness —
any tax rate change must be reflected here first.
"""

from decimal import Decimal

import pytest

from src.tax.calculator import TaxCalculator


@pytest.fixture
def calc() -> TaxCalculator:
    return TaxCalculator()


# ── EU VAT ────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
@pytest.mark.parametrize("country,expected_rate,tax_type", [
    ("DE", Decimal("0.19"), "VAT"),   # Germany
    ("FR", Decimal("0.20"), "VAT"),   # France
    ("GB", Decimal("0.20"), "VAT"),   # UK (not EU but same engine)
    ("NL", Decimal("0.21"), "VAT"),   # Netherlands
    ("IT", Decimal("0.22"), "VAT"),   # Italy
    ("SE", Decimal("0.25"), "VAT"),   # Sweden (highest in EU)
    ("LU", Decimal("0.17"), "VAT"),   # Luxembourg (lowest in EU)
    ("IE", Decimal("0.23"), "VAT"),   # Ireland
])
async def test_eu_vat_rates(calc: TaxCalculator, country: str, expected_rate: Decimal, tax_type: str):
    result = await calc.calculate(amount_cents=10000, country=country)
    assert result is not None, f"Expected tax result for {country}"
    assert result.rate == expected_rate, f"{country}: expected {expected_rate}, got {result.rate}"
    assert result.tax_type == tax_type
    assert result.inclusive is False


@pytest.mark.asyncio
async def test_german_vat_amount():
    """19% of $100.00 (10000 cents) = $19.00 (1900 cents)."""
    calc = TaxCalculator()
    result = await calc.calculate(amount_cents=10000, country="DE")
    assert result is not None
    assert result.amount_cents == 1900


@pytest.mark.asyncio
async def test_vat_rounding():
    """Tax rounding uses ROUND_HALF_UP. €49.00 * 20% = €9.80."""
    calc = TaxCalculator()
    result = await calc.calculate(amount_cents=4900, country="FR")
    assert result is not None
    assert result.amount_cents == 980


# ── Other jurisdictions ───────────────────────────────────────────────────────

@pytest.mark.asyncio
@pytest.mark.parametrize("country,expected_rate,tax_type", [
    ("AU", Decimal("0.10"), "GST"),
    ("NZ", Decimal("0.15"), "GST"),
    ("SG", Decimal("0.09"), "GST"),
    ("NO", Decimal("0.25"), "VAT"),
    ("CH", Decimal("0.081"), "VAT"),
    ("JP", Decimal("0.10"), "CT"),
    ("IN", Decimal("0.18"), "GST"),
    ("ZA", Decimal("0.15"), "VAT"),
    ("MX", Decimal("0.16"), "VAT"),
    ("CA", Decimal("0.05"), "GST"),   # Federal GST only (provincial not yet modeled)
])
async def test_non_eu_tax_rates(calc: TaxCalculator, country: str, expected_rate: Decimal, tax_type: str):
    result = await calc.calculate(amount_cents=10000, country=country)
    assert result is not None
    assert result.rate == expected_rate
    assert result.tax_type == tax_type


# ── US state sales tax ────────────────────────────────────────────────────────

@pytest.mark.asyncio
@pytest.mark.parametrize("state,expected_rate", [
    ("CA", Decimal("0.0725")),
    ("NY", Decimal("0.04")),
    ("TX", Decimal("0.0625")),
    ("FL", Decimal("0.06")),
    ("WA", Decimal("0.065")),
])
async def test_us_state_tax(calc: TaxCalculator, state: str, expected_rate: Decimal):
    result = await calc.calculate(amount_cents=10000, country="US", state=state)
    assert result is not None
    assert result.rate == expected_rate
    assert result.tax_type == "SALES_TAX"
    assert result.jurisdiction == f"US-{state}"


@pytest.mark.asyncio
@pytest.mark.parametrize("state", ["OR", "NH", "MT", "DE", "AK"])
async def test_us_no_sales_tax_states(calc: TaxCalculator, state: str):
    """Five US states have no sales tax — must return None."""
    result = await calc.calculate(amount_cents=10000, country="US", state=state)
    assert result is None, f"{state} should have no sales tax"


@pytest.mark.asyncio
async def test_us_without_state_returns_none(calc: TaxCalculator):
    """US without a state → cannot determine tax → return None."""
    result = await calc.calculate(amount_cents=10000, country="US")
    assert result is None


# ── Edge cases ────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_unknown_country_returns_none(calc: TaxCalculator):
    """Unknown country codes should return None (no tax, don't crash)."""
    result = await calc.calculate(amount_cents=10000, country="XX")
    assert result is None


@pytest.mark.asyncio
async def test_none_country_returns_none(calc: TaxCalculator):
    result = await calc.calculate(amount_cents=10000, country=None)
    assert result is None


@pytest.mark.asyncio
async def test_country_case_insensitive(calc: TaxCalculator):
    """Country codes should be normalised to uppercase."""
    result_upper = await calc.calculate(amount_cents=10000, country="DE")
    result_lower = await calc.calculate(amount_cents=10000, country="de")
    assert result_upper is not None
    assert result_lower is not None
    assert result_upper.rate == result_lower.rate
